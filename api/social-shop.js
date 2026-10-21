// GET /api/social-shop?playerId=... — đọc ảnh chụp tiệm của 1 người chơi để vẽ màn hình thăm tiệm.
// Ai cũng đọc được (dữ liệu trưng bày công khai), không trả mã bí mật.
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SOCIAL_SUPABASE_URL,
  process.env.SOCIAL_SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const playerId = req.query.playerId;
  if (!playerId || typeof playerId !== 'string' || playerId.length > 64) {
    return res.status(400).json({ ok: false, error: 'bad id' });
  }

  const { data, error } = await supabase
    .from('social_shops')
    .select('player_id,studio_name,owner_name,avatar,level,revenue,rating,shop_tier,plots,hearts_total,flowers_total,updated_at')
    .eq('player_id', playerId)
    .maybeSingle();

  if (error) return res.status(500).json({ ok: false });
  if (!data) return res.status(200).json({ ok: false, error: 'no snapshot' });

  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=20');
  return res.status(200).json({ ok: true, shop: data });
}
