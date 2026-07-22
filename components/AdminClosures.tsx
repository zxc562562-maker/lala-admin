'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addClosureRange, removeClosureDate, type ClosureDay } from '@lala/shared/lib/closure-actions';
import { KOREAN_HOLIDAYS } from '@lala/shared/lib/holidays';
import { todayISO } from '@lala/shared/lib/domain/reservation';

export default function AdminClosures({ closures }: { closures: ClosureDay[] }) {
  const router = useRouter();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function add() {
    setErr(null); setMsg(null);
    if (!startDate || !endDate) { setErr('시작일과 종료일을 입력해주세요.'); return; }
    startTransition(async () => {
      const res = await addClosureRange(startDate, endDate, reason);
      if (!res.ok) { setErr(res.reason ?? '등록에 실패했습니다.'); return; }
      setMsg('임시 휴무일로 등록됐어요.');
      setStartDate(''); setEndDate(''); setReason('');
      router.refresh();
    });
  }

  function remove(date: string) {
    if (!confirm(`${date} 휴무일 지정을 취소할까요?`)) return;
    startTransition(async () => { await removeClosureDate(date); router.refresh(); });
  }

  const today = todayISO();
  const upcomingHolidays = KOREAN_HOLIDAYS.filter((h) => h.date >= today);

  return (
    <section>
      <h1 className="staff-title">휴무일</h1>
      <p className="staff-empty" style={{ padding: 0, marginBottom: 18, textAlign: 'left' }}>
        법정 공휴일은 자동으로 휴무 처리되고(아래 참고), 휴가 기간처럼 사내 사정으로 추가되는 임시 휴무일만 여기서 직접 등록합니다.
        등록된 날짜는 예약일·반납일로 선택할 수 없게 돼요(그 기간을 관통하는 예약 자체는 막지 않아요).
      </p>

      <div className="optional-panel" style={{ marginBottom: 24 }}>
        <div className="field-section" style={{ marginTop: 0, marginBottom: 0 }}>시작일 → 종료일</div>
        <input className="field" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <input className="field" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        <input className="field" placeholder="사유(예: 여름 휴가)" value={reason} onChange={(e) => setReason(e.target.value)} />

        {err && <div className="hint err">{err}</div>}
        {msg && <div className="hint" style={{ color: 'var(--sage)' }}>{msg}</div>}
        <button className="cta" disabled={pending} onClick={add}>
          {pending ? '처리 중…' : '휴무일 등록'}
        </button>
      </div>

      <h2 className="field-section" style={{ marginTop: 0 }}>등록된 임시 휴무일</h2>
      {closures.length === 0 && <p className="staff-empty">등록된 임시 휴무일이 없습니다.</p>}
      <div className="order-list">
        {closures.map((c) => (
          <div className="order-card" key={c.date}>
            <div className="order-head">
              <span className="order-cust">{c.date}</span>
            </div>
            {c.reason && <div className="order-sub">{c.reason}</div>}
            <button className="linklike" disabled={pending} onClick={() => remove(c.date)} style={{ fontSize: 12, color: 'var(--wine)', marginTop: 6 }}>
              취소
            </button>
          </div>
        ))}
      </div>

      <h2 className="field-section">법정 공휴일 (참고용, 자동 반영됨)</h2>
      <div className="order-list">
        {upcomingHolidays.map((h) => (
          <div className="order-card" key={h.date}>
            <div className="order-head">
              <span className="order-cust">{h.date}</span>
              <span className="order-status">{h.name}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
