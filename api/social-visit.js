// POST /api/social-visit — ghi 1 lượt ghé thăm tiệm: thả tim và/hoặc tặng hoa.
// Body: { visitorId, secret, ownerId, heart: true/false, flower: true/false }
// Luật chống cày (server giữ, game không tự quyết):
//  - Tối đa 1 dòng (người thăm, chủ tiệm, ngày) → tim/hoa không thả trùng trong ngày được.
//  - Mỗi người thăm tặng tối đa 3 hoa/ngày (tổng mọi tiệm), tối đa 1 hoa cho 1 tiệm/ngày.
//  - Thưởng tiền thăm chỉ tính cho 5 lượt ghé ĐẦU TIÊN tới 5 tiệm khác nhau trong ngày
//    (server trả firstVisitToday + distinctVisitsToday, game căn cứ đó mà cộng tiền).
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SOCIAL_SUPABASE_URL,
  process.env.SOCIAL_SUPABASE_SERVICE_KEY
);

const FLOWERS_PER_DAY = 3;
const REWARDED_VISITS_PER_DAY = 5;

function vnDayKey() {
  // Ngày theo giờ Việt Nam, dạng YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const { visitorId, secret, ownerId, heart, flower } = req.body || {};
  if (!visitorId || typeof visitorId !== 'string' || visitorId.length > 64) {
    return res.status(400).json({ ok: false, error: 'bad visitor' });
  }
  if (!ownerId || typeof ownerId !== 'string' || ownerId.length > 64) {
    return res.status(400).json({ ok: false, error: 'bad owner' });
  }
  if (visitorId === ownerId) return res.status(400).json({ ok: false, error: 'own shop' });
  const wantHeart = heart === true;
  const wantFlower = flower === true;
  // Cả hai đều false = lượt "check-in" khi mở màn hình thăm: vẫn ghi dòng thăm
  // để chủ tiệm thấy lượt ghé hôm nay và người thăm nhận thưởng lượt ghé đầu.

  // --- xác thực người thăm: phải có tiệm xã hội và mã bí mật khớp ---
  const { data: visitor } = await supabase
    .from('social_shops')
    .select('secret')
    .eq('player_id', visitorId)
    .maybeSingle();
  if (!visitor) return res.status(403).json({ ok: false, error: 'visitor not registered' });
  if (visitor.secret && visitor.secret !== secret) {
    return res.status(403).json({ ok: false, error: 'not yours' });
  }

  // --- chủ tiệm phải có snapshot để thăm ---
  const { data: owner } = await supabase
    .from('social_shops')
    .select('player_id, hearts_total, flowers_total')
    .eq('player_id', ownerId)
    .maybeSingle();
  if (!owner) return res.status(200).json({ ok: false, error: 'no snapshot' });

  const day = vnDayKey();

  // Dòng thăm hôm nay (nếu có) + số hoa đã tặng hôm nay + số tiệm khác nhau đã ghé hôm nay
  const { data: todayRows } = await supabase
    .from('social_visits')
    .select('owner_id, heart, flower')
    .eq('visitor_id', visitorId)
    .eq('day_key', day);
  const rows = todayRows || [];
  const existing = rows.find(r => r.owner_id === ownerId) || null;
  const flowersGivenToday = rows.filter(r => r.flower).length;
  const firstVisitToday = !existing;
  const distinctVisitsToday = rows.length + (firstVisitToday ? 1 : 0);

  const heartCounted = wantHeart && !(existing && existing.heart);
  let flowerCounted = false;
  if (wantFlower && !(existing && existing.flower) && flowersGivenToday < FLOWERS_PER_DAY) {
    flowerCounted = true;
  }
  const flowerQuotaLeft = FLOWERS_PER_DAY - flowersGivenToday - (flowerCounted ? 1 : 0);

  // Ghi/cập nhật dòng thăm hôm nay: check-in lần đầu cũng ghi (heart/flower = false)
  // để lượt ghé được đếm; các lần sau chỉ cập nhật khi có tim/hoa mới.
  if (firstVisitToday || heartCounted || flowerCounted) {
    const merged = {
      visitor_id: visitorId,
      owner_id: ownerId,
      day_key: day,
      heart: (existing ? existing.heart : false) || wantHeart,
      flower: (existing ? existing.flower : false) || flowerCounted,
    };
    const { error } = await supabase
      .from('social_visits')
      .upsert(merged, { onConflict: 'visitor_id,owner_id,day_key' });
    if (error) return res.status(500).json({ ok: false });
  }

  // Cộng tổng tim/hoa cho chủ tiệm nếu đây là lượt tính mới
  if (heartCounted || flowerCounted) {
    const { error } = await supabase
      .from('social_shops')
      .update({
        hearts_total: Number(owner.hearts_total) + (heartCounted ? 1 : 0),
        flowers_total: Number(owner.flowers_total) + (flowerCounted ? 1 : 0),
      })
      .eq('player_id', ownerId);
    if (error) return res.status(500).json({ ok: false });
  }

  return res.status(200).json({
    ok: true,
    heartCounted,
    flowerCounted,
    flowerQuotaLeft,
    firstVisitToday,
    distinctVisitsToday,
    rewardEligible: firstVisitToday && distinctVisitsToday <= REWARDED_VISITS_PER_DAY,
  });
}
