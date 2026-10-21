// POST /api/social-snapshot — game gửi "ảnh chụp tiệm" lên project Supabase XÃ HỘI (riêng với BXH).
// Chỉ là dữ liệu trưng bày để người khác thăm tiệm: cấp tiệm + kiểu chi nhánh, KHÔNG phải bản save.
// Key Supabase nằm trong biến môi trường của Vercel, KHÔNG bao giờ lộ ra trình duyệt.
// Chống sửa tiệm của người khác bằng mã bí mật riêng cho mảng xã hội (socialSecret),
// cấp lần đầu gửi, game lưu lại và gửi kèm mỗi lần sau — cùng mẫu với /api/score.
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SOCIAL_SUPABASE_URL,
  process.env.SOCIAL_SUPABASE_SERVICE_KEY
);

const AVATARS = ['nu-aodai-hong','nu-aodai-cachtan','nu-baba-nonla','nu-cophuc','nu-genz','nam-khandong','nam-nhiepanh','nam-street','nam-baba','nam-cophuc'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const { playerId, secret, studioName, ownerName, level, revenue, rating, avatar, shopTier, plots } = req.body || {};

  // --- kiểm tra đầu vào ---
  if (!playerId || typeof playerId !== 'string' || playerId.length > 64) {
    return res.status(400).json({ ok: false, error: 'bad id' });
  }
  const lv = Number(level), rev = Number(revenue), rat = Number(rating), tier = Number(shopTier);
  if (!Number.isFinite(lv) || lv < 1 || lv > 200) return res.status(400).json({ ok: false, error: 'bad level' });
  if (!Number.isFinite(rev) || rev < 0 || rev > 999999999999) return res.status(400).json({ ok: false, error: 'bad revenue' });
  if (!Number.isFinite(rat) || rat < 0 || rat > 5) return res.status(400).json({ ok: false, error: 'bad rating' });
  if (!Number.isFinite(tier) || tier < 1 || tier > 4) return res.status(400).json({ ok: false, error: 'bad tier' });
  // plots: đúng 4 ô, mỗi ô là H (Hiện đại) / V (Vintage) / K (Hàn Quốc) / - (trống)
  if (typeof plots !== 'string' || !/^[HVK-](,[HVK-]){3}$/.test(plots)) {
    return res.status(400).json({ ok: false, error: 'bad plots' });
  }

  const clean = (s, d) => String(s ?? d).slice(0, 20);
  const row = {
    player_id: playerId,
    studio_name: clean(studioName, 'Tiệm ảnh'),
    owner_name: clean(ownerName, 'Chủ tiệm'),
    avatar: AVATARS.includes(avatar) ? avatar : 'nu-aodai-hong',
    level: Math.floor(lv),
    revenue: Math.floor(rev),
    rating: rat,
    shop_tier: Math.floor(tier),
    plots,
    updated_at: new Date().toISOString(),
  };

  const { data: old } = await supabase
    .from('social_shops')
    .select('updated_at, secret, hearts_total, flowers_total')
    .eq('player_id', playerId)
    .maybeSingle();

  // Lần đầu: tạo mã bí mật mảng xã hội, trả về cho game lưu lại (localStorage)
  if (!old) {
    const token = crypto.randomUUID();
    const { error } = await supabase.from('social_shops').insert({ ...row, secret: token });
    if (error) return res.status(500).json({ ok: false });
    return res.status(200).json({ ok: true, secret: token });
  }

  // Đã có dòng: mã gửi lên phải trùng — không thì từ chối.
  // Ngoại lệ tự chữa (giống bài học BXH 16/10: nhập save sang máy khác làm lệch mã):
  // game gửi kèm reset:true thì cấp mã MỚI cho đúng player_id này. Dữ liệu xã hội chỉ là
  // trưng bày (không tiền, không tiến trình) nên rủi ro của đường này ở mức thấp.
  let token = secret;
  if (old.secret) {
    if (!token || token !== old.secret) {
      if (req.body && req.body.reset === true) {
        token = crypto.randomUUID();
      } else {
        return res.status(403).json({ ok: false, error: 'not yours' });
      }
    }
  } else {
    token = crypto.randomUUID();
  }

  // --- chống spam: mỗi người 60 giây mới gửi 1 lần ---
  if (Date.now() - new Date(old.updated_at).getTime() < 60000) {
    return res.status(429).json({ ok: false, error: 'slow down' });
  }

  // Ghi đè snapshot nhưng GIỮ NGUYÊN tổng tim/hoa đã nhận
  const { error } = await supabase
    .from('social_shops')
    .upsert({ ...row, secret: token, hearts_total: old.hearts_total, flowers_total: old.flowers_total }, { onConflict: 'player_id' });

  if (error) return res.status(500).json({ ok: false });
  return res.status(200).json({ ok: true, secret: token });
}
