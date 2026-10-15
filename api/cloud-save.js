// POST /api/cloud-save — lưu bản save lên mây, nhận mã 6 ký tự.
//   Mỗi người chơi giữ đúng 1 bản trên mây; lưu lại thì ghi đè + cấp mã mới
//   (mã cũ hết hiệu lực). Bản lưu giữ vĩnh viễn cho tới khi bị ghi đè.
// GET /api/cloud-save?code=XXXXXX — khôi phục bản save bằng mã (kèm playerId + secret
//   để trình duyệt mới giữ đúng danh tính BXH).
//
// LƯU Ý: cloud-save dùng project Supabase RIÊNG, tách khỏi BXH/tên
// (score.js và leaderboard.js vẫn dùng SUPABASE_URL / SUPABASE_SERVICE_KEY cũ).
// Cần 2 biến môi trường riêng trên Vercel:
//   CLOUD_SUPABASE_URL, CLOUD_SUPABASE_SERVICE_KEY (service_role của project mới)
// Key nằm trong biến môi trường của Vercel, KHÔNG bao giờ lộ ra trình duyệt.
import { createClient } from '@supabase/supabase-js';

// Tạo client cho project mây riêng; thiếu biến môi trường → null để báo lỗi gọn
function cloudDb() {
  const url = process.env.CLOUD_SUPABASE_URL;
  const key = process.env.CLOUD_SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

const CODE_LEN = 6;
// Bảng chữ không gây nhầm (bỏ 0/O, 1/I/L) để đọc mã cho dễ
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_SAVE_BYTES = 500000;

// Chống spam thô: mỗi IP tối đa 10 lần/phút cho mỗi thao tác
const hits = new Map();
function throttled(ip, action) {
  const now = Date.now();
  const key = ip + ':' + action;
  const arr = (hits.get(key) || []).filter((t) => now - t < 60000);
  arr.push(now);
  hits.set(key, arr);
  return arr.length > 10;
}

function genCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LEN));
  let s = '';
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s;
}

const cleanCode = (c) =>
  String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const supabase = cloudDb();
  if (!supabase) {
    return res.status(500).json({ ok: false, error: 'cloud not configured' });
  }
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';

  // ---------------- LƯU: POST ----------------
  if (req.method === 'POST') {
    if (throttled(ip, 'save')) return res.status(429).json({ ok: false, error: 'slow down' });
    const { playerId, secret, saveData, saveAt, force } = req.body || {};

    if (!playerId || typeof playerId !== 'string' || playerId.length > 64) {
      return res.status(400).json({ ok: false, error: 'bad id' });
    }
    if (typeof saveData !== 'string' || saveData.length < 10 || saveData.length > MAX_SAVE_BYTES) {
      return res.status(400).json({ ok: false, error: 'bad save' });
    }
    // Bản nén gzip (base64, tiền tố "gz:"): chỉ kiểm tra định dạng base64, nội dung
    // do game tự validate chữ ký khi khôi phục (server không bao giờ giải nén).
    // Bản thô: phải là JSON object như trước.
    if (saveData.startsWith('gz:')) {
      if (!/^[A-Za-z0-9+/=]+$/.test(saveData.slice(3))) {
        return res.status(400).json({ ok: false, error: 'bad save' });
      }
    } else {
      let parsed;
      try {
        parsed = JSON.parse(saveData);
      } catch {
        return res.status(400).json({ ok: false, error: 'bad save' });
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return res.status(400).json({ ok: false, error: 'bad save' });
      }
    }

    // Xác thực: secret phải trùng mã của player trong bảng leaderboard.
    // Chưa có hàng (chơi ngày 1 chưa gửi điểm lần nào): tạo hàng + cấp secret luôn.
    const { data: old } = await supabase
      .from('leaderboard')
      .select('secret')
      .eq('player_id', playerId)
      .maybeSingle();

    let token = secret;
    if (!old) {
      token = crypto.randomUUID();
      const { error } = await supabase.from('leaderboard').insert({
        player_id: playerId,
        secret: token,
        studio_name: 'Tiệm ảnh',
        owner_name: 'Chủ tiệm',
        level: 1,
        revenue: 0,
        rating: 0,
        updated_at: new Date().toISOString(),
      });
      if (error) {
      // Kho đầy: báo cho game hiện "Cloud quá tải"
      if (/disk full/i.test(error.message || '')) {
        return res.status(507).json({ ok: false, error: 'storage_full' });
      }
      return res.status(500).json({ ok: false });
    }
    } else if (old.secret) {
      if (!token || token !== old.secret) {
        return res.status(403).json({ ok: false, error: 'not yours' });
      }
    } else {
      // Hàng cũ chưa có secret: cấp cho người đầu tiên gửi đúng playerId
      token = crypto.randomUUID();
      await supabase.from('leaderboard').update({ secret: token }).eq('player_id', playerId);
    }

    // Chống ghi đè bản mây MỚI HƠN bằng bản cũ hơn: nếu trên mây đã có bản lưu
    // mới hơn bản đang up lên (so theo thời điểm lưu, trừ hao 60s lệch đồng hồ)
    // thì từ chối để game hỏi người chơi có chắc ghi đè không (force:true để ép).
    const { data: existing } = await supabase
      .from('cloud_saves')
      .select('save_code, updated_at')
      .eq('player_id', playerId)
      .maybeSingle();
    if (existing && !force) {
      const incomingAt = Number(saveAt);
      if (
        Number.isFinite(incomingAt) &&
        new Date(existing.updated_at).getTime() > incomingAt + 60000
      ) {
        return res
          .status(409)
          .json({ ok: false, error: 'cloud_newer', cloudAt: existing.updated_at });
      }
    }

    // Tạo mã 6 ký tự duy nhất (thử tối đa 5 lần tránh trùng)
    let code = null;
    for (let i = 0; i < 5 && !code; i++) {
      const c = genCode();
      const { data: dup } = await supabase
        .from('cloud_saves')
        .select('player_id')
        .eq('save_code', c)
        .maybeSingle();
      if (!dup) code = c;
    }
    if (!code) return res.status(500).json({ ok: false });

    const { error } = await supabase.from('cloud_saves').upsert(
      {
        player_id: playerId,
        save_code: code,
        save_data: saveData,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'player_id' }
    );
    if (error) {
      // Kho đầy: báo cho game hiện "Cloud quá tải"
      if (/disk full/i.test(error.message || '')) {
        return res.status(507).json({ ok: false, error: 'storage_full' });
      }
      return res.status(500).json({ ok: false });
    }
    // Trả kèm secret để game lưu lại nếu chưa có
    return res.status(200).json({ ok: true, code, secret: token });
  }

  // ---------------- KHÔI PHỤC: GET ?code= ----------------
  if (req.method === 'GET') {
    if (throttled(ip, 'load')) return res.status(429).json({ ok: false, error: 'slow down' });
    const code = cleanCode(req.query.code);
    if (code.length !== CODE_LEN) {
      return res.status(400).json({ ok: false, error: 'bad code' });
    }
    const { data } = await supabase
      .from('cloud_saves')
      .select('player_id, save_data, updated_at')
      .eq('save_code', code)
      .maybeSingle();
    if (!data) return res.status(404).json({ ok: false, error: 'not found' });
    // Trả kèm playerId + secret để trình duyệt mới giữ đúng 1 danh tính BXH
    // (người có mã chính là chủ bản lưu nên được phép nhận lại secret của mình)
    const { data: lb } = await supabase
      .from('leaderboard')
      .select('secret')
      .eq('player_id', data.player_id)
      .maybeSingle();
    return res.status(200).json({
      ok: true,
      saveData: data.save_data,
      updatedAt: data.updated_at,
      playerId: data.player_id,
      secret: (lb && lb.secret) || null,
    });
  }

  return res.status(405).json({ ok: false });
}
