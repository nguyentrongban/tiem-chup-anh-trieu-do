// GET /api/social-stats?playerId=...&secret=... — chủ tiệm xem ai đã ghé thăm tiệm mình.
// Cần mã bí mật mảng xã hội của chính chủ tiệm. Trả: hôm nay (lượt ghé/tim/hoa),
// tổng tim/hoa từ trước tới nay, và 8 lượt ghé gần nhất (kèm tên + avatar người ghé).
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SOCIAL_SUPABASE_URL,
  process.env.SOCIAL_SUPABASE_SERVICE_KEY
);

function vnDayKey() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { playerId, secret } = req.query;
  if (!playerId || typeof playerId !== 'string' || playerId.length > 64) {
    return res.status(400).json({ ok: false, error: 'bad id' });
  }

  const { data: me } = await supabase
    .from('social_shops')
    .select('secret, hearts_total, flowers_total')
    .eq('player_id', playerId)
    .maybeSingle();
  if (!me) return res.status(200).json({ ok: false, error: 'no snapshot' });
  if (me.secret && me.secret !== secret) {
    return res.status(403).json({ ok: false, error: 'not yours' });
  }

  const day = vnDayKey();
  const { data: todayRows } = await supabase
    .from('social_visits')
    .select('visitor_id, heart, flower')
    .eq('owner_id', playerId)
    .eq('day_key', day);
  const rows = todayRows || [];
  const today = {
    visits: rows.length,
    hearts: rows.filter(r => r.heart).length,
    flowers: rows.filter(r => r.flower).length,
  };

  const { data: recentRows } = await supabase
    .from('social_visits')
    .select('visitor_id, heart, flower, day_key, created_at')
    .eq('owner_id', playerId)
    .order('created_at', { ascending: false })
    .limit(8);

  let recent = [];
  if (recentRows && recentRows.length) {
    const ids = [...new Set(recentRows.map(r => r.visitor_id))];
    const { data: shops } = await supabase
      .from('social_shops')
      .select('player_id, studio_name, owner_name, avatar')
      .in('player_id', ids);
    const byId = Object.fromEntries((shops || []).map(s => [s.player_id, s]));
    recent = recentRows.map(r => ({
      visitorId: r.visitor_id,
      studioName: byId[r.visitor_id]?.studio_name || 'Tiệm ảnh',
      ownerName: byId[r.visitor_id]?.owner_name || 'Chủ tiệm',
      avatar: byId[r.visitor_id]?.avatar || 'nu-aodai-hong',
      heart: r.heart,
      flower: r.flower,
      dayKey: r.day_key,
      at: r.created_at,
    }));
  }

  return res.status(200).json({
    ok: true,
    today,
    totals: { hearts: Number(me.hearts_total), flowers: Number(me.flowers_total) },
    recent,
  });
}
