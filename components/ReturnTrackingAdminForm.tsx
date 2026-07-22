'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveReturnTracking } from '@lala/shared/lib/staff-actions';

export default function ReturnTrackingAdminForm({
  orderId, initialCourier, initialTrackingNumber,
}: {
  orderId: string;
  initialCourier: string;
  initialTrackingNumber: string;
}) {
  const router = useRouter();
  const [courier, setCourier] = useState(initialCourier);
  const [trackingNumber, setTrackingNumber] = useState(initialTrackingNumber);
  const [editing, setEditing] = useState(!(initialCourier && initialTrackingNumber));
  const [busy, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function save() {
    setErr(null);
    startTransition(async () => {
      const res = await saveReturnTracking(orderId, courier, trackingNumber);
      if (res.ok) { setEditing(false); router.refresh(); }
      else setErr(res.reason);
    });
  }

  return (
    <div className="order-issue-items">
      <div className="field-section" style={{ margin: '8px 0 4px' }}>반납 택배 정보 (회원에게 안내됨)</div>
      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input
            className="field"
            placeholder="택배사 (예: CJ대한통운)"
            value={courier}
            onChange={(e) => setCourier(e.target.value)}
          />
          <input
            className="field"
            placeholder="송장번호"
            value={trackingNumber}
            onChange={(e) => setTrackingNumber(e.target.value)}
          />
          {err && <p className="hint err" style={{ margin: 0, minHeight: 0 }}>{err}</p>}
          <button
            type="button"
            className="cta ghost"
            style={{ width: 'auto', padding: '8px 14px', fontSize: 12, alignSelf: 'flex-start', marginTop: 0 }}
            disabled={busy}
            onClick={save}
          >
            {busy ? '저장 중…' : '저장'}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12.5, color: 'var(--espresso)' }}>{courier} · {trackingNumber}</span>
          <button type="button" className="linklike" style={{ fontSize: 11.5 }} onClick={() => setEditing(true)}>수정</button>
        </div>
      )}
    </div>
  );
}
