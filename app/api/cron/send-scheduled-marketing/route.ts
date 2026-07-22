import { NextResponse, type NextRequest } from 'next/server';
import { processDueScheduledBroadcasts } from '@/lib/marketing-send';

/**
 * 예약된 마케팅 알림 중 시각이 도래한 것을 처리한다.
 * 외부 스케줄러(Vercel Cron 등)가 주기적으로 호출한다. 반드시 CRON_SECRET으로 보호할 것.
 *   호출 예: GET /api/cron/send-scheduled-marketing  (Authorization: Bearer <CRON_SECRET>)
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const result = await processDueScheduledBroadcasts();
  return NextResponse.json({ ok: true, ...result });
}
