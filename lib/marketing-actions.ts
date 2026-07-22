'use server';

import { supabaseAdmin } from '@lala/shared/lib/supabase/server';
import { getAccess } from '@lala/shared/lib/roles';
import { isWithinAllowedSendingHours, nextAllowedSendTime, sendBroadcastNow } from './marketing-send';

export type MarketingCategory = 'lookbook' | 'promotion' | 'daily';
const CONSENT_COLUMN: Record<MarketingCategory, string> = {
  lookbook: 'marketing_lookbook_consent',
  promotion: 'marketing_promotion_consent',
  daily: 'marketing_daily_consent',
};
export type BroadcastStatus = 'scheduled' | 'sent' | 'cancelled' | 'failed';

export interface BroadcastHistory {
  id: string;
  category: MarketingCategory;
  title: string;
  body: string;
  status: BroadcastStatus;
  recipientCount: number;
  scheduledAt: string;
  sentAt: string | null;
}

/** 카테고리별 발송 대상 수 미리보기(해당 카테고리 동의 + 승인 + 푸시 구독까지 켠 회원만) */
export async function getMarketingAudienceCounts(): Promise<Record<MarketingCategory, number>> {
  const me = await getAccess();
  if (!me?.isApprover) return { lookbook: 0, promotion: 0, daily: 0 };
  const sb = supabaseAdmin();

  const result: Record<MarketingCategory, number> = { lookbook: 0, promotion: 0, daily: 0 };
  for (const category of Object.keys(CONSENT_COLUMN) as MarketingCategory[]) {
    const { data: eligible } = await sb
      .from('customer')
      .select('id')
      .eq(CONSENT_COLUMN[category], true)
      .eq('status', 'approved');
    const eligibleIds = (eligible ?? []).map((r: { id: string }) => r.id);
    if (eligibleIds.length === 0) continue;
    const { data: subs } = await sb.from('push_subscription').select('customer_id').in('customer_id', eligibleIds);
    result[category] = new Set((subs ?? []).map((s: { customer_id: string }) => s.customer_id)).size;
  }
  return result;
}

export type SendResult =
  | { ok: true; mode: 'sent'; recipientCount: number }
  | { ok: true; mode: 'scheduled'; scheduledAt: string }
  | { ok: false; reason: string };

/**
 * 마케팅 알림 발송(또는 예약).
 * - scheduledAt 을 지정하면: 그 시각(반드시 08:00~21:00 KST 이내)에 발송되도록 예약만 하고 지금은 보내지 않음.
 * - scheduledAt 없이 호출 + 지금이 발송 허용 시간대: 즉시 발송.
 * - scheduledAt 없이 호출 + 지금이 야간(21시~08시): 자동으로 다음 허용 시각(다음날 08:00 KST 등)에 예약 전환.
 */
export async function sendMarketingBroadcast(
  category: MarketingCategory,
  title: string,
  body: string,
  scheduledAt?: string,
): Promise<SendResult> {
  const me = await getAccess();
  if (!me?.isApprover) return { ok: false, reason: '권한이 없습니다.' };
  if (!title.trim() || !body.trim()) return { ok: false, reason: '제목과 내용을 입력해주세요.' };

  const sb = supabaseAdmin();

  if (scheduledAt) {
    const target = new Date(scheduledAt);
    if (Number.isNaN(target.getTime()) || target.getTime() <= Date.now()) {
      return { ok: false, reason: '예약 시각은 현재보다 이후여야 합니다.' };
    }
    if (!isWithinAllowedSendingHours(target)) {
      return { ok: false, reason: '예약 시각은 오전 8시~오후 9시(KST) 사이여야 합니다(정보통신망법).' };
    }
    const { error } = await sb.from('marketing_broadcast').insert({
      category, title: title.trim(), body: body.trim(),
      sent_by: me.userId, status: 'scheduled', scheduled_at: target.toISOString(), recipient_count: 0,
    });
    if (error) return { ok: false, reason: '예약 등록에 실패했습니다.' };
    return { ok: true, mode: 'scheduled', scheduledAt: target.toISOString() };
  }

  // 즉시 발송 요청인데 지금이 야간이면 → 다음 허용 시각으로 자동 예약 전환
  if (!isWithinAllowedSendingHours()) {
    const auto = nextAllowedSendTime();
    const { error } = await sb.from('marketing_broadcast').insert({
      category, title: title.trim(), body: body.trim(),
      sent_by: me.userId, status: 'scheduled', scheduled_at: auto.toISOString(), recipient_count: 0,
    });
    if (error) return { ok: false, reason: '예약 등록에 실패했습니다.' };
    return { ok: true, mode: 'scheduled', scheduledAt: auto.toISOString() };
  }

  // 지금 바로 발송
  const now = new Date().toISOString();
  const { data: inserted, error } = await sb.from('marketing_broadcast').insert({
    category, title: title.trim(), body: body.trim(),
    sent_by: me.userId, status: 'scheduled', scheduled_at: now, recipient_count: 0,
  }).select('id').single();
  if (error || !inserted) return { ok: false, reason: '발송에 실패했습니다.' };

  const sent = await sendBroadcastNow(inserted.id);
  if (!sent.ok) return sent;
  return { ok: true, mode: 'sent', recipientCount: sent.recipientCount };
}

/** 예약 취소 (아직 발송 전인 것만) */
export async function cancelScheduledBroadcast(id: string): Promise<{ ok: boolean }> {
  const me = await getAccess();
  if (!me?.isApprover) return { ok: false };
  const sb = supabaseAdmin();
  const { error } = await sb.from('marketing_broadcast').update({ status: 'cancelled' }).eq('id', id).eq('status', 'scheduled');
  return { ok: !error };
}

/** 최근 발송/예약 이력 (디렉터/슈퍼바이저만) */
export async function listMarketingBroadcasts(): Promise<BroadcastHistory[]> {
  const me = await getAccess();
  if (!me?.isApprover) return [];
  const sb = supabaseAdmin();
  const { data } = await sb
    .from('marketing_broadcast')
    .select('id,category,title,body,status,recipient_count,scheduled_at,sent_at')
    .order('scheduled_at', { ascending: false })
    .limit(30);
  return (data ?? []).map((r: {
    id: string; category: MarketingCategory; title: string; body: string; status: BroadcastStatus;
    recipient_count: number; scheduled_at: string; sent_at: string | null;
  }) => ({
    id: r.id, category: r.category, title: r.title, body: r.body, status: r.status,
    recipientCount: r.recipient_count, scheduledAt: r.scheduled_at, sentAt: r.sent_at,
  }));
}
