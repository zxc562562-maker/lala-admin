'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@lala/shared/lib/supabase/client';
import { updateFulfillment, assignOrder, openDispute, resolveDispute, setItemIssue, type OrderRow, type Fulfillment } from '@lala/shared/lib/staff-actions';
import { FULFILLMENT_LABEL as LABEL } from '@lala/shared/lib/fulfillment-label';
import { getDeliverySlotLabel } from '@lala/shared/lib/delivery';
import ReturnTrackingAdminForm from './ReturnTrackingAdminForm';
import PackagingPhotoAdminForm from './PackagingPhotoAdminForm';

const won = (n: number) => n.toLocaleString('ko-KR') + '원';
const STATUSES: Fulfillment[] = [
  'ORDERED', 'PRE_INSPECTING', 'READY', 'SHIPPED', 'DELIVERED', 'RETURN_REQUESTED', 'RETURN_INSPECTING', 'REFUNDED',
  'PRE_INSPECT_ISSUE', 'MISDELIVERED', 'RETURN_ISSUE',
];

export default function AdminOrders({ orders, staff }: { orders: OrderRow[]; staff: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [disputeTarget, setDisputeTarget] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState('');
  const [dateFilter, setDateFilter] = useState('');

  // 주문번호: 주문이 실제로 들어온 순서(생성일 오름차순) 기준 — 목록 정렬/필터와 무관하게 고정된 번호.
  const orderNumberById = useMemo(() => {
    const byCreatedAsc = [...orders].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const m = new Map<string, number>();
    byCreatedAsc.forEach((o, i) => m.set(o.id, i + 1));
    return m;
  }, [orders]);

  const visibleOrders = useMemo(() => {
    if (!dateFilter) return orders;
    return orders.filter((o) => o.createdAt.slice(0, 10) === dateFilter);
  }, [orders, dateFilter]);

  // 실시간: payment_order 변경 시 서버 컴포넌트 재실행
  useEffect(() => {
    const sb = supabaseBrowser();
    const ch = sb
      .channel('admin-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_order' }, () => router.refresh())
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [router]);

  function setStatus(id: string, s: Fulfillment) {
    startTransition(async () => { await updateFulfillment(id, s); router.refresh(); });
  }
  function assign(id: string, staffId: string) {
    startTransition(async () => { await assignOrder(id, staffId); router.refresh(); });
  }
  function submitDispute() {
    if (!disputeTarget) return;
    const orderId = disputeTarget;
    startTransition(async () => {
      await openDispute(orderId, disputeReason.trim() || '사유 미기재');
      setDisputeTarget(null); setDisputeReason('');
      router.refresh();
    });
  }
  function resolve(orderId: string) {
    startTransition(async () => { await resolveDispute(orderId); router.refresh(); });
  }
  function toggleIssue(reservationId: string, hasIssue: boolean) {
    startTransition(async () => { await setItemIssue(reservationId, hasIssue); router.refresh(); });
  }

  return (
    <section>
      <div className="admin-topbar">
        <h1 className="staff-title">주문 현황 <span className="rt-dot" title="실시간 연결됨">●</span></h1>
      </div>

      <div className="admin-toolbar">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
          날짜별 조회
          <input type="date" className="admin-search" style={{ minWidth: 0 }} value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
        </label>
        {dateFilter && <button className="btn-ghost" onClick={() => setDateFilter('')}>전체 보기</button>}
        <div className="admin-spacer" />
        <span className="prod-brand">총 {visibleOrders.length}건</span>
      </div>

      {visibleOrders.length === 0 && (
        <p className="staff-empty">{dateFilter ? '해당 날짜에 주문이 없습니다.' : '결제완료된 주문이 없습니다.'}</p>
      )}
      <div className="order-list">
        {visibleOrders.map((o) => (
          <div className="order-card" key={o.id}>
            <div className="order-head">
              <span className="order-cust">
                <span className="order-num">#{orderNumberById.get(o.id)}</span> {o.customerName}
                {o.disputed && <span className="order-dispute-badge">분쟁중</span>}
              </span>
              <span className="order-amt">{won(o.amount)}</span>
            </div>
            <div className="order-sub">{o.checkout} → {o.return}</div>
            <div className="order-sub">배송 시간: {getDeliverySlotLabel(o.deliverySlot)}</div>
            {o.disputed && o.disputeReason && (
              <div className="order-dispute-reason">사유: {o.disputeReason}</div>
            )}
            <div className="order-ctrls">
              <label>상태
                <select value={o.fulfillment} disabled={pending} onChange={(e) => setStatus(o.id, e.target.value as Fulfillment)}>
                  {STATUSES.map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}
                </select>
              </label>
              <label>배송기사
                <select value={o.assignedTo ?? ''} disabled={pending} onChange={(e) => assign(o.id, e.target.value)}>
                  <option value="">미배정</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            </div>
            <PackagingPhotoAdminForm orderId={o.id} photoUrl={o.packagingPhotoUrl} />
            {(o.fulfillment === 'PRE_INSPECT_ISSUE' || o.fulfillment === 'RETURN_ISSUE') && o.items.length > 0 && (
              <div className="order-issue-items">
                <div className="field-section" style={{ margin: '8px 0 4px' }}>문제 상품 지정 (회원 화면에 해당 상품만 안내 표시)</div>
                {o.items.map((item) => (
                  <label key={item.id} className="agree-row" style={{ fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={item.hasIssue}
                      disabled={pending}
                      onChange={(e) => toggleIssue(item.id, e.target.checked)}
                    />
                    <span>{item.productName}</span>
                  </label>
                ))}
              </div>
            )}
            {o.fulfillment === 'RETURN_REQUESTED' && o.deliveryMethod === 'PARCEL' && (
              <ReturnTrackingAdminForm
                orderId={o.id}
                initialCourier={o.returnCourier ?? ''}
                initialTrackingNumber={o.returnTrackingNumber ?? ''}
              />
            )}
            <div className="order-dispute-ctrl">
              {o.disputed ? (
                <button className="cta ghost" disabled={pending} onClick={() => resolve(o.id)} style={{ width: 'auto', padding: '8px 14px', fontSize: 12 }}>
                  분쟁 해결 처리
                </button>
              ) : (
                <button className="linklike" disabled={pending} onClick={() => setDisputeTarget(o.id)} style={{ fontSize: 12 }}>
                  분쟁 지정
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {disputeTarget && (
        <div className="wd-ov" onClick={(e) => e.target === e.currentTarget && setDisputeTarget(null)}>
          <div className="wd-box">
            <div className="wd-title">분쟁 지정</div>
            <p className="wd-desc">이 주문을 분쟁 상태로 지정합니다. 사유를 남겨주세요.</p>
            <textarea
              className="pf-input pf-edit"
              style={{ width: '100%', textAlign: 'left', padding: '10px 12px', minHeight: 70, resize: 'vertical' }}
              placeholder="분쟁 사유"
              value={disputeReason}
              onChange={(e) => setDisputeReason(e.target.value)}
              autoFocus
            />
            <div className="wd-btns">
              <button className="cta ghost" onClick={() => setDisputeTarget(null)}>취소</button>
              <button className="cta" disabled={pending} onClick={submitDispute}>분쟁 지정</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
