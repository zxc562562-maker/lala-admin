'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { sendMarketingBroadcast, cancelScheduledBroadcast, type BroadcastHistory, type MarketingCategory } from '@/lib/marketing-actions';

const CATEGORY_LABEL: Record<MarketingCategory, string> = {
  lookbook: '신규 룩북 소식',
  promotion: '할인·이벤트 프로모션',
  daily: '데일리 코디 추천',
};
const STATUS_LABEL: Record<string, string> = {
  scheduled: '예약됨', sent: '발송완료', cancelled: '취소됨', failed: '실패',
};

function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AdminMarketing({ audience, history }: { audience: Record<MarketingCategory, number>; history: BroadcastHistory[] }) {
  const router = useRouter();
  const [category, setCategory] = useState<MarketingCategory>('lookbook');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [useSchedule, setUseSchedule] = useState(false);
  const [scheduleAt, setScheduleAt] = useState(() => {
    const d = new Date(); d.setHours(d.getHours() + 1, 0, 0, 0);
    return toDatetimeLocal(d);
  });
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function send() {
    setMsg(null); setErr(null);
    if (!title.trim() || !body.trim()) { setErr('제목과 내용을 입력해주세요.'); return; }
    if (!confirm(useSchedule
      ? `${scheduleAt.replace('T', ' ')}에 발송 예약합니다. 계속할까요?`
      : `${CATEGORY_LABEL[category]} 동의 회원 ${audience[category]}명에게 발송합니다(발송 가능 시간이 아니면 자동으로 예약됩니다). 계속할까요?`)) return;

    startTransition(async () => {
      const scheduledIso = useSchedule ? new Date(scheduleAt).toISOString() : undefined;
      const res = await sendMarketingBroadcast(category, title, body, scheduledIso);
      if (!res.ok) { setErr(res.reason); return; }
      if (res.mode === 'sent') setMsg(`${res.recipientCount}명에게 발송했어요.`);
      else setMsg(`야간(또는 예약) 발송으로 등록됐어요. ${new Date(res.scheduledAt).toLocaleString('ko-KR')}에 자동 발송됩니다.`);
      setTitle(''); setBody('');
      router.refresh();
    });
  }

  function cancel(id: string) {
    if (!confirm('이 예약을 취소할까요?')) return;
    startTransition(async () => { await cancelScheduledBroadcast(id); router.refresh(); });
  }

  return (
    <section>
      <h1 className="staff-title">마케팅 알림</h1>
      <p className="staff-empty" style={{ padding: 0, marginBottom: 18, textAlign: 'left' }}>
        선택한 카테고리({CATEGORY_LABEL[category]})에 동의하고 <b>푸시 알림을 켠</b> 승인 회원 <b>{audience[category]}명</b>에게 발송됩니다.
        <br />※ 정보통신망법에 따라 오후 9시~오전 8시(KST)에는 발송할 수 없습니다 — 이 시간대엔 자동으로 다음 날 오전 8시로 예약됩니다.
      </p>

      <div className="optional-panel" style={{ marginBottom: 24 }}>
        <select className="field" value={category} onChange={(e) => setCategory(e.target.value as MarketingCategory)}>
          {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input className="field" placeholder="알림 제목" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea
          className="field"
          placeholder="알림 내용"
          rows={3}
          style={{ resize: 'vertical', fontFamily: 'inherit' }}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />

        <label className="agree-row">
          <input type="checkbox" checked={useSchedule} onChange={(e) => setUseSchedule(e.target.checked)} />
          <span>예약 발송 (시각 직접 지정)</span>
        </label>
        {useSchedule && (
          <input
            className="field"
            type="datetime-local"
            value={scheduleAt}
            onChange={(e) => setScheduleAt(e.target.value)}
          />
        )}

        {err && <div className="hint err">{err}</div>}
        {msg && <div className="hint" style={{ color: 'var(--sage)' }}>{msg}</div>}
        <button className="cta" disabled={pending} onClick={send}>
          {pending ? '처리 중…' : useSchedule ? '예약하기' : '발송하기'}
        </button>
      </div>

      <h2 className="field-section" style={{ marginTop: 0 }}>최근 발송/예약 이력</h2>
      {history.length === 0 && <p className="staff-empty">이력이 없습니다.</p>}
      <div className="order-list">
        {history.map((h) => (
          <div className="order-card" key={h.id}>
            <div className="order-head">
              <span className="order-cust">{h.title}</span>
              <span className={h.status === 'sent' ? 'order-status' : 'order-dispute-badge'}>{STATUS_LABEL[h.status]}</span>
            </div>
            <div className="order-sub">{CATEGORY_LABEL[h.category]} · {h.body}</div>
            <div className="order-sub">
              {h.status === 'sent'
                ? `${h.sentAt ? new Date(h.sentAt).toLocaleString('ko-KR') : ''} · ${h.recipientCount}명 발송`
                : h.status === 'scheduled'
                  ? `${new Date(h.scheduledAt).toLocaleString('ko-KR')} 발송 예정`
                  : `${new Date(h.scheduledAt).toLocaleString('ko-KR')} 예정이었음`}
            </div>
            {h.status === 'scheduled' && (
              <button className="linklike" disabled={pending} onClick={() => cancel(h.id)} style={{ fontSize: 12, color: 'var(--wine)', marginTop: 6 }}>
                예약 취소
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
