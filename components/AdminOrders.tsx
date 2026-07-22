'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@lala/shared/lib/supabase/client';
import { updateFulfillment, assignOrder, openDispute, resolveDispute, setItemIssue, type OrderRow, type Fulfillment } from '@lala/shared/lib/staff-actions';
import { FULFILLMENT_LABEL as LABEL } from '@lala/shared/lib/fulfillment-label';
import { getDeliverySlotLabel } from '@lala/shared/lib/delivery';
import ReturnTrackingAdminForm from './ReturnTrackingAdminForm';
import PackagingPhotoAdminForm from './PackagingPhotoAdminForm';
import AdminDatePicker from './AdminDatePicker';

const won = (n: number) => n.toLocaleString('ko-KR') + '원';
const STATUSES: Fulfillment[] = [
  'ORDERED', 'PRE_INSPECTING', 'READY', 'SHIPPED', 'DELIVERED', 'RETURN_REQUESTED', 'RETURN_INSPECTING', 'REFUNDED',
  'PRE_INSPECT_ISSUE', 'MISDELIVERED', 'RETURN_ISSUE',
];

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function rentalDays(checkout: string, ret: string): number {
  const ms = new Date(`${ret}T00:00:00`).getTime() - new Date(`${checkout}T00:00:00`).getTime();
  return Math.max(1, Math.round(ms / 86400000));
}

export default function AdminOrders({ orders, staff }: { orders: OrderRow[]; staff: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [disputeTarget, setDisputeTarget] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState('');
  const [dateFilter, setDateFilter] = useState(todayISO());
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [showAll, setShowAll] = useState(false);

  // 주문번호: 주문이 실제로 들어온 순서(생성일 오름차순) 기준 — 목록 정렬/필터와 무관하게 고정된 번호.
  const orderNumberById = useMemo(() => {
    const byCreatedAsc = [...orders].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const m = new Map<string, number>();
    byCreatedAsc.forEach((o, i) => m.set(o.id, i + 1));
    return m;
  }, [orders]);

  const rangeActive = !!rangeStart && !!rangeEnd;

  const visibleOrders = useMemo(() => {
    if (showAll) return orders;
    if (rangeActive) {
      return orders.filter((o) => {
        const d = o.createdAt.slice(0, 10);
        return d >= rangeStart && d <= rangeEnd;
      });
    }
    return orders.filter((o) => o.createdAt.slice(0, 10) === dateFilter);
  }, [orders, dateFilter, rangeStart, rangeEnd, rangeActive, showAll]);

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
        <div className="date-range-row">
          일자별 조회
          <AdminDatePicker value={dateFilter} onChange={(v) => { setDateFilter(v); setRangeStart(''); setRangeEnd(''); setShowAll(false); }} />
        </div>

        <div className="date-range-row date-range-row-period">
          기간별 조회
          <AdminDatePicker value={rangeStart} placeholder="시작일" onChange={(v) => { setRangeStart(v); setShowAll(false); }} />
          ~
          <AdminDatePicker value={rangeEnd} placeholder="종료일" onChange={(v) => { setRangeEnd(v); setShowAll(false); }} />
        </div>

        {(rangeActive || showAll) && (
          <button className="btn-ghost" onClick={() => { setShowAll(false); setRangeStart(''); setRangeEnd(''); setDateFilter(todayISO()); }}>오늘로</button>
        )}
        {!showAll && <button className="btn-ghost" onClick={() => setShowAll(true)}>전체 보기</button>}

        <div className="admin-spacer" />
        <span className="prod-brand">총 {visibleOrders.length}건</span>
      </div>

      {visibleOrders.length === 0 && (
        <p className="staff-empty">{showAll ? '결제완료된 주문이 없습니다.' : '조건에 맞는 주문이 없습니다.'}</p>
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

            <div className="order-sub-row">
              <span className="order-sub" style={{ margin: 0 }}>{o.checkout} → {o.return}</span>
              <span className="pill">{rentalDays(o.checkout, o.return)}일</span>
            </div>
            <div className="order-sub-row">
              <span className="pill">{getDeliverySlotLabel(o.deliverySlot)}</span>
            </div>

            {o.items.length > 0 && (
              <div className="order-products">
                {o.items.map((item) => <span key={item.id} className="pill">{item.productName}</span>)}
              </div>
            )}

            {o.disputed && o.disputeReason && (
              <div className="order-dispute-reason">사유: {o.disputeReason}</div>
            )}

            <div className="order-ctrls">
              <div className="order-ctrl-row">
                <span>상태</span>
                <select value={o.fulfillment} disabled={pending} onChange={(e) => setStatus(o.id, e.target.value as Fulfillment)}>
                  {STATUSES.map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}
                </select>
                <span className="pill">{LABEL[o.fulfillment]}</span>
              </div>
              <div className="order-ctrl-row">
                <span>배송직원</span>
                <select value={o.assignedTo ?? ''} disabled={pending} onChange={(e) => assign(o.id, e.target.value)}>
                  <option value="">미배정</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
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
