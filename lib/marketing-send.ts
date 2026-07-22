import 'server-only';
import { supabaseAdmin } from '@lala/shared/lib/supabase/server';
import { sendPushToCustomers } from '@lala/shared/lib/push';

/** 정보통신망법: 광고성 정보는 오후 9시~오전 8시(KST)에는 전송할 수 없다(별도 야간 동의가 없는 한). */
export function isWithinAllowedSendingHours(at: Date = new Date()): boolean {
  const kstHour = (at.getUTCHours() + 9) % 24;
  return kstHour >= 8 && kstHour < 21;
}

/** 지금 이후 가장 가까운 발송 허용 시각(KST 08:00)을 계산한다. */
export function nextAllowedSendTime(from: Date = new Date()): Date {
  const kstMs = from.getTime() + 9 * 60 * 60 * 1000;
  const kst = new Date(kstMs);
  const hour = kst.getUTCHours();
  const dayStartKstUtcMs = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), 8, 0, 0) - 9 * 60 * 60 * 1000;
  if (hour < 8) return new Date(dayStartKstUtcMs);         // 오늘 08:00 KST
  return new Date(dayStartKstUtcMs + 24 * 60 * 60 * 1000);  // 내일 08:00 KST (21시 이후 또는 이미 지남)
}

/**
 * 실제로 알림을 발송하고 결과를 기록한다(즉시 발송 / 예약 처리 공용 경로).
 * status='scheduled' 인 것만 처리 대상으로 원자적으로 선점(status -> 'sent')한다.
 */
export async function sendBroadcastNow(broadcastId: string): Promise<{ ok: true; recipientCount: number } | { ok: false; reason: string }> {
  const sb = supabaseAdmin();

  const { data: broadcast } = await sb.from('marketing_broadcast').select('*').eq('id', broadcastId).maybeSingle();
  if (!broadcast) return { ok: false, reason: '알림을 찾을 수 없습니다.' };
  if (broadcast.status === 'sent') return { ok: true, recipientCount: broadcast.recipient_count };
  if (broadcast.status !== 'scheduled') return { ok: false, reason: '발송할 수 없는 상태입니다.' };

  // 원자적 선점(중복 처리 방지)
  const { data: claimed } = await sb
    .from('marketing_broadcast')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', broadcastId)
    .eq('status', 'scheduled')
    .select('id');
  if (!claimed || claimed.length === 0) return { ok: true, recipientCount: broadcast.recipient_count };

  const consentColumn: Record<string, string> = {
    lookbook: 'marketing_lookbook_consent',
    promotion: 'marketing_promotion_consent',
    daily: 'marketing_daily_consent',
  };
  const { data: recipients } = await sb
    .from('customer')
    .select('id')
    .eq(consentColumn[broadcast.category] ?? 'marketing_lookbook_consent', true)
    .eq('status', 'approved');
  const eligibleIds = (recipients ?? []).map((r: { id: string }) => r.id);

  // 정보통신망법: 광고 표시 + 수신거부 방법 안내
  const adTitle = broadcast.title.startsWith('(광고)') ? broadcast.title : `(광고) ${broadcast.title}`;
  const adBody = `${broadcast.body}\n\n수신거부: 내 정보 > 마케팅 동의 해제`;

  // 실제로 구독(기기)이 있어 발송이 시도된 고객만 "도달"로 집계 — 동의는 했지만 구독을 켜지 않은 고객은 제외
  const reachedIds = await sendPushToCustomers(eligibleIds, adTitle, adBody);

  await sb.from('marketing_broadcast').update({ recipient_count: reachedIds.length }).eq('id', broadcastId);
  if (reachedIds.length > 0) {
    await sb.from('marketing_broadcast_recipient').insert(
      reachedIds.map((customerId) => ({ broadcast_id: broadcastId, customer_id: customerId })),
    );
  }

  return { ok: true, recipientCount: reachedIds.length };
}

/** 예약 시각이 도래한 발송을 모두 처리한다 (크론 작업에서 호출) */
export async function processDueScheduledBroadcasts(): Promise<{ processed: number }> {
  const sb = supabaseAdmin();
  const { data: due } = await sb
    .from('marketing_broadcast')
    .select('id')
    .eq('status', 'scheduled')
    .lte('scheduled_at', new Date().toISOString());

  let processed = 0;
  for (const row of due ?? []) {
    const res = await sendBroadcastNow(row.id);
    if (res.ok) processed += 1;
  }
  return { processed };
}
