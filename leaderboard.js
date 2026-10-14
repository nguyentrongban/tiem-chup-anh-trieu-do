// GET /api/leaderboard?by=level|revenue|rating — trả về top 100, ai cũng đọc được.
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const COLS = { level: 'level', revenue: 'revenue', rating: 'rating' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const by = COLS[req.query.by] || 'level';
  const { data, error } = await supabase
    .from('leaderboard')
    .select('player_id,studio_name,owner_name,level,revenue,rating,updated_at')
    .order(by, { ascending: false })
    .limit(100);

  if (error) return res.status(500).json({ ok: false, rows: [] });
  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=20');
  return res.status(200).json({ ok: true, rows: data });
}
