// POST /api/score — game gửi điểm lên, server kiểm tra rồi mới ghi vào Supabase.
// Key Supabase nằm trong biến môi trường của Vercel, KHÔNG bao giờ lộ ra trình duyệt.
// Chống ghi đè điểm của người khác: mỗi người chơi có 1 mã bí mật (secret) riêng,
// cấp lần đầu gửi điểm, game lưu lại và gửi kèm mỗi lần sau. Không có mã đúng thì
// không sửa được dòng của người khác — dù biết player_id của họ.
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const { playerId, secret, studioName, ownerName, level, revenue, rating } = req.body || {};

  // --- kiểm tra đầu vào ---
  if (!playerId || typeof playerId !== 'string' || playerId.length > 64) {
    return res.status(400).json({ ok: false, error: 'bad id' });
  }
  const lv = Number(level), rev = Number(revenue), rat = Number(rating);
  if (!Number.isFinite(lv) || lv < 1 || lv > 200) return res.status(400).json({ ok: false, error: 'bad level' });
  if (!Number.isFinite(rev) || rev < 0 || rev > 999999999999) return res.status(400).json({ ok: false, error: 'bad revenue' });
  if (!Number.isFinite(rat) || rat < 0 || rat > 5) return res.status(400).json({ ok: false, error: 'bad rating' });

  const clean = (s, d) => String(s ?? d).slice(0, 20);
  const row = {
    player_id: playerId,
    studio_name: clean(studioName, 'Tiệm ảnh'),
    owner_name: clean(ownerName, 'Chủ tiệm'),
    level: Math.floor(lv),
    revenue: Math.floor(rev),
    rating: rat,
    updated_at: new Date().toISOString(),
  };

  const { data: old } = await supabase
    .from('leaderboard')
    .select('updated_at, secret')
    .eq('player_id', playerId)
    .maybeSingle();

  // Lần đầu gửi điểm: tạo mã bí mật riêng, trả về cho game lưu lại (localStorage)
  if (!old) {
    const token = crypto.randomUUID();
    const { error } = await supabase.from('leaderboard').insert({ ...row, secret: token });
    if (error) return res.status(500).json({ ok: false });
    return res.status(200).json({ ok: true, secret: token });
  }

  // Hàng đã tồn tại: mã gửi lên phải trùng mã đã lưu — không thì từ chối
  // (hàng tạo trước bản này chưa có mã: cấp cho người đầu tiên gửi đúng playerId)
  let token = secret;
  if (old.secret) {
    if (!token || token !== old.secret) {
      return res.status(403).json({ ok: false, error: 'not yours' });
    }
  } else {
    token = crypto.randomUUID();
  }

  // --- chống spam: mỗi người 60 giây mới được gửi 1 lần ---
  if (Date.now() - new Date(old.updated_at).getTime() < 60000) {
    return res.status(429).json({ ok: false, error: 'slow down' });
  }

  const { error } = await supabase
    .from('leaderboard')
    .upsert({ ...row, secret: token }, { onConflict: 'player_id' });

  if (error) return res.status(500).json({ ok: false });
  return res.status(200).json({ ok: true, secret: token });
}
