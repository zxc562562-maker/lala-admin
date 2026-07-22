'use client';

import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@lala/shared/lib/supabase/client';
import { listAddressChanges, type AddressChangeRow } from '@lala/shared/lib/staff-actions';

export default function AdminAddressLog({ initial }: { initial: AddressChangeRow[] }) {
  const [rows, setRows] = useState<AddressChangeRow[]>(initial);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const sb = supabaseBrowser();
    const channel = sb
      .channel('address-change-log-admin')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'address_change_log' },
        () => {
          // 실시간 알림을 받으면 (고객명 등 조인 정보까지 포함해) 목록을 다시 가져온다.
          listAddressChanges().then(setRows);
        },
      )
      .subscribe((status) => setLive(status === 'SUBSCRIBED'));

    return () => { sb.removeChannel(channel); };
  }, []);

  return (
    <section>
      <h1 className="staff-title">
        배송·회수·근무지 정보 변경 이력
        <span className={`live-dot ${live ? 'on' : ''}`} title={live ? '실시간 연결됨' : '연결 중…'} />
      </h1>
      {rows.length === 0 && <p className="staff-empty">아직 변경 이력이 없습니다.</p>}
      <div className="order-list">
        {rows.map((r) => (
          <div className="order-card" key={r.id}>
            <div className="order-head">
              <span className="order-cust">{r.customerName} ({r.customerUsername})</span>
              <span className="order-status">{r.fieldLabel}</span>
            </div>
            <div className="order-sub">
              {r.oldValue ? `${r.oldValue} → ` : '(없음) → '}{r.newValue || '(삭제됨)'}
            </div>
            <div className="order-sub">{new Date(r.changedAt).toLocaleString('ko-KR')}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
