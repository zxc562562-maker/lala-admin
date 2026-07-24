'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@lala/shared/lib/supabase/client';
import {
  updateFulfillment, assignOrder, openDispute, resolveDispute, saveItemIssue,
  listSiblingItemsForReservation, reassignReservationItem,
  type OrderRow, type Fulfillment, type SiblingItemRow,
} from '@lala/shared/lib/staff-actions';
import { FULFILLMENT_LABEL as LABEL } from '@lala/shared/lib/fulfillment-label';
import { getDeliverySlotLabel } from '@lala/shared/lib/delivery';
import ReturnTrackingAdminForm from './ReturnTrackingAdminForm';
import PackagingPhotoAdminForm from './PackagingPhotoAdminForm';
import AdminDatePicker from './AdminDatePicker';

const won = (n: number) => n.toLocaleString('ko-KR') + '원';
const STATUSES: Fulfillment[] = [
  'ORDERED', 'PRE_INSPECTING', 'READY', 'SHIPPED', 'DELIVERED', 'RETURN_REQUESTED', 'RETURN_INSPECTING', 'REFUNDED', 'DEPOSIT_REFUNDED',
];
// 정상 흐름 중간에 끼어드는 오류 분기 — 진행 상태와 섞어놓으면 헷갈려서 별도 select로 분리.
const ISSUE_STATUSES: Fulfillment[] = ['PRE_INSPECT_ISSUE', 'MISDELIVERED', 'RETURN_ISSUE'];

/** 현재 상태부터 그 이후 버튼만 남기고, 이미 지난 단계는 자동으로 숨긴다. 오류 상태 등 흐름 밖이면 전체를 보여준다. */
function visibleStatuses(current: Fulfillment): Fulfillment[] {
  const idx = STATUSES.indexOf(current);
  return STATUSES.filter((_, i) => i >= Math.max(idx, 0));
}
/** 되돌리기는 정상 흐름의 두 번째 단계부터만 의미가 있다(첫 단계는 되돌릴 이전 단계가 없음). */
function canUndoStatus(current: Fulfillment): boolean {
  return STATUSES.indexOf(current) > 0;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function rentalDays(checkout: string, ret: string): number {
  const ms = new Date(`${ret}T00:00:00`).getTime() - new Date(`${checkout}T00:00:00`).getTime();
  return Math.max(1, Math.round(ms / 86400000));
}

/** "2026-07-22" -> "26-07-22" — 주문 카드는 좁은 공간에 표기하니 연도 앞 2자리는 생략. */
function shortDate(d: string): string {
  return d.length === 10 ? d.slice(2) : d;
}

/** 배송시간은 오후대(3~8시)뿐이라 "오후"를 붙일 필요가 없음 — 알약 표기는 시각만. */
function shortSlotLabel(id: string | null): string {
  return getDeliverySlotLabel(id).replace('오후 ', '');
}

/** 재고 개체에 실제 바코드가 없는 경우(데모/구주문 등)를 위한 대체 표시 — reservation id 기반이라 매번 같은 값이 나온다. */
function demoBarcode(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return `LALA-${String(h % 100000000).padStart(8, '0')}`;
}

/** 주문 카드 알약은 공간이 좁아 "직배송/퀵배송" 대신 "직/퀵"으로 줄여 표기(택배는 그대로). */
const METHOD_SHORT_LABEL: Record<string, string> = { DIRECT: '직', QUICK: '퀵', PARCEL: '택배' };

/** 미지정(null)이면 알약 자체를 안 보여줄 거라 null 리턴. */
function deliveryMethodLabel(id: string | null): string | null {
  return id ? METHOD_SHORT_LABEL[id] ?? null : null;
}

export default function AdminOrders({ orders, staff }: { orders: OrderRow[]; staff: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [disputeTarget, setDisputeTarget] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState('');
  const [issueTarget, setIssueTarget] = useState<string | null>(null); // reservation id
  const [issueReason, setIssueReason] = useState('');
  const [issuePhotos, setIssuePhotos] = useState<File[]>([]);
  const [issueErr, setIssueErr] = useState<string | null>(null);
  const issuePhotoPreviews = useMemo(() => issuePhotos.map((f) => URL.createObjectURL(f)), [issuePhotos]);
  const [reassignTarget, setReassignTarget] = useState<string | null>(null); // reservation id
  const [siblingItems, setSiblingItems] = useState<SiblingItemRow[]>([]);
  const [reassignLoading, setReassignLoading] = useState(false);
  const [reassignErr, setReassignErr] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState(todayISO());
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [showAll, setShowAll] = useState(false);

  // 주문번호: 렌탈 시작일(checkout) 오름차순 기준 — 조회 필터도 checkout 기준이라 맞춰둠.
  // 같은 날짜끼리는 결제 순서(createdAt)로 안정적으로 묶어준다.
  const orderNumberById = useMemo(() => {
    const byCheckoutAsc = [...orders].sort((a, b) => a.checkout.localeCompare(b.checkout) || a.createdAt.localeCompare(b.createdAt));
    const m = new Map<string, number>();
    byCheckoutAsc.forEach((o, i) => m.set(o.id, i + 1));
    return m;
  }, [orders]);

  const rangeActive = !!rangeStart && !!rangeEnd;

  // 결제일이 아니라 렌탈 시작일(checkout) 기준 — 결제일로 필터링하면 렌탈일을 미리 체크 못해
  // 결제 당일에 잘못 발송될 위험이 있음(직원 실수 방지).
  const visibleOrders = useMemo(() => {
    if (showAll) return orders;
    if (rangeActive) {
      return orders.filter((o) => o.checkout >= rangeStart && o.checkout <= rangeEnd);
    }
    return orders.filter((o) => o.checkout === dateFilter);
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
  function undoStatus(id: string, current: Fulfillment) {
    const idx = STATUSES.indexOf(current);
    if (idx <= 0) return;
    setStatus(id, STATUSES[idx - 1]);
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
  function openIssue(reservationId: string) {
    setIssueTarget(reservationId);
    setIssueReason('');
    setIssuePhotos([]);
    setIssueErr(null);
  }
  function pickIssuePhotos(e: React.ChangeEvent<HTMLInputElement>) {
    setIssuePhotos(Array.from(e.target.files ?? []).slice(0, 5));
  }
  function submitIssue() {
    if (!issueTarget) return;
    if (!issueReason.trim()) { setIssueErr('사유를 입력해주세요.'); return; }
    if (issuePhotos.length === 0) { setIssueErr('사진을 1장 이상 선택해주세요.'); return; }
    setIssueErr(null);
    const reservationId = issueTarget;
    const formData = new FormData();
    issuePhotos.forEach((f) => formData.append('photos', f));
    startTransition(async () => {
      const res = await saveItemIssue(reservationId, issueReason, formData);
      if (res.ok) { setIssueTarget(null); router.refresh(); }
      else setIssueErr(res.reason);
    });
  }
  function openReassign(reservationId: string) {
    setReassignTarget(reservationId);
    setSiblingItems([]);
    setReassignErr(null);
    setReassignLoading(true);
    listSiblingItemsForReservation(reservationId).then((rows) => {
      setSiblingItems(rows);
      setReassignLoading(false);
    });
  }
  function pickReassign(newItemId: string) {
    if (!reassignTarget) return;
    const reservationId = reassignTarget;
    setReassignErr(null);
    startTransition(async () => {
      const res = await reassignReservationItem(reservationId, newItemId);
      if (res.ok) { setReassignTarget(null); router.refresh(); }
      else setReassignErr(res.reason);
    });
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
              <div className="order-head-top">
                <span className="order-cust-row">
                  <span className="order-cust">
                    <span className="order-num">#{orderNumberById.get(o.id)}</span> {o.customerName}
                  </span>
                  {o.customerPhone && <span className="order-cust-sub">{o.customerPhone}</span>}
                  {o.deliveryAddress && <span className="order-cust-sub">{o.deliveryAddress}</span>}
                  {o.disputed && <span className="order-dispute-badge">분쟁중</span>}
                </span>
                <span className="order-amt">{won(o.amount)}</span>
              </div>

              <span className="order-period-group">
                <span className="order-period">{shortDate(o.checkout)} → {shortDate(o.return)}</span>
                <span className="pill">{rentalDays(o.checkout, o.return)}일</span>
                {deliveryMethodLabel(o.deliveryMethod) && <span className="pill">{deliveryMethodLabel(o.deliveryMethod)}</span>}
                {/* 배송시간은 직배송/퀵배송에서만 의미가 있다(택배는 시간 지정 자체가 없고,
                    배송방법이 아직 안 정해졌으면 시간도 당연히 의미가 없다 — 방법이 시간보다 선행) */}
                {(o.deliveryMethod === 'DIRECT' || o.deliveryMethod === 'QUICK') && (
                  <span className="pill">{shortSlotLabel(o.deliverySlot)}</span>
                )}
              </span>

              <span className="order-ctrl-group">
                <span className="order-inline-ctrl">
                  <span className="order-ctrl-label-wide">상태</span>
                  <span className="order-status-btns">
                    {visibleStatuses(o.fulfillment).map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={`order-status-btn${s === o.fulfillment ? ' active' : ''}`}
                        disabled={pending}
                        onClick={() => setStatus(o.id, s)}
                      >
                        {LABEL[s]}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="order-status-undo"
                      title="이전 상태로 되돌리기"
                      disabled={pending || !canUndoStatus(o.fulfillment)}
                      onClick={() => undoStatus(o.id, o.fulfillment)}
                    >
                      ↺
                    </button>
                  </span>
                </span>
                <span className="order-ctrl-divider" />
                <span className="order-inline-ctrl">
                  <span className="order-ctrl-label-wide">오류</span>
                  <span className="order-status-btns">
                    {ISSUE_STATUSES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={`order-status-btn${s === o.fulfillment ? ' active' : ''}`}
                        disabled={pending}
                        onClick={() => setStatus(o.id, s)}
                      >
                        {LABEL[s]}
                      </button>
                    ))}
                  </span>
                </span>
                <span className="order-inline-ctrl">
                  <span>배송직원</span>
                  <select className="order-inline-select" value={o.assignedTo ?? ''} disabled={pending} onChange={(e) => assign(o.id, e.target.value)}>
                    <option value="">미배정</option>
                    {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </span>
                <span className="order-inline-ctrl order-inline-ctrl-end">
                  {o.disputed && o.disputeReason && <span className="order-dispute-reason-inline">사유: {o.disputeReason}</span>}
                  {o.disputed ? (
                    <button className="cta" disabled={pending} onClick={() => resolve(o.id)} style={{ margin: 0, width: 'auto', padding: '5px 10px', fontSize: 11.5 }}>
                      분쟁 해결
                    </button>
                  ) : (
                    <button className="cta" disabled={pending} onClick={() => setDisputeTarget(o.id)} style={{ margin: 0, width: 'auto', padding: '5px 10px', fontSize: 11.5 }}>
                      분쟁 지정
                    </button>
                  )}
                </span>
              </span>
            </div>

            {o.items.length > 0 && (
              <div className="order-item-columns">
                {/* 주문 상품 목록: 바코드·재배정·오염 그룹까지 전부 — 변동 높이(오염 발생 시)가 있어도
                    출고 목록은 완전히 별개의 컬럼이라 서로 밀거나 영향을 주지 않는다. */}
                <div className="order-item-list">
                  <div className="field-section" style={{ margin: 0 }}>주문 상품 목록</div>
                  {o.items.map((item) => (
                    <div className="order-item-block" key={item.id}>
                      <div className="order-item-row">
                        <div className="order-item-thumb" style={{ background: `linear-gradient(160deg, ${item.c2}, ${item.c1})` }} />
                        <div className="order-item-info">
                          <div className="order-item-name-row">
                            <span className="order-item-name">{item.productName}</span>
                            <span className="order-item-barcode">{item.barcode ?? demoBarcode(item.id)}</span>
                            <button type="button" className="order-item-issue-btn" disabled={pending} onClick={() => openReassign(item.id)}>
                              재배정
                            </button>
                          </div>
                          <div className="order-item-price">{won(item.dailyPrice)} /일</div>
                        </div>
                      </div>
                      <div className="order-item-issue-row">
                        {item.hasIssue ? (
                          <span className="order-item-issue-info">
                            <span className="order-item-issue-photos">
                              {item.issuePhotoUrls.map((url, i) => (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img key={i} src={url} alt="오염·손상 사진" className="order-item-issue-photo" />
                              ))}
                            </span>
                            <span className="order-item-issue-reason">{item.issueReason}</span>
                          </span>
                        ) : (
                          <button type="button" className="order-item-issue-btn" disabled={pending} onClick={() => openIssue(item.id)}>
                            오염·손상 발생
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* 출고 상품 목록: 사진/이름/금액만 — 주문 목록과 동일한 항목이지만 바코드·오염 등
                    출고와 무관한 정보는 뺐다. */}
                <div className="order-item-list">
                  <div className="field-section" style={{ margin: 0 }}>출고 상품 목록</div>
                  {o.items.map((item) => (
                    <div className="order-item-row" key={item.id}>
                      <div className="order-item-thumb" style={{ background: `linear-gradient(160deg, ${item.c2}, ${item.c1})` }} />
                      <div className="order-item-info">
                        <div className="order-item-name-row">
                          <span className="order-item-name">{item.productName}</span>
                        </div>
                        <div className="order-item-price">{won(item.dailyPrice)} /일</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <PackagingPhotoAdminForm orderId={o.id} photoUrl={o.packagingPhotoUrl} />
            {o.fulfillment === 'RETURN_REQUESTED' && o.deliveryMethod === 'PARCEL' && (
              <ReturnTrackingAdminForm
                orderId={o.id}
                initialCourier={o.returnCourier ?? ''}
                initialTrackingNumber={o.returnTrackingNumber ?? ''}
              />
            )}
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

      {issueTarget && (
        <div className="wd-ov" onClick={(e) => e.target === e.currentTarget && setIssueTarget(null)}>
          <div className="wd-box">
            <div className="wd-title">오염·손상 발생</div>
            <p className="wd-desc">사진(최대 5장)과 사유를 남겨주세요.</p>
            <input type="file" accept="image/*" multiple onChange={pickIssuePhotos} disabled={pending} />
            {issuePhotoPreviews.length > 0 && (
              <div className="order-item-issue-preview-row">
                {issuePhotoPreviews.map((url, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={url} alt="" className="order-item-issue-photo" />
                ))}
              </div>
            )}
            <textarea
              className="pf-input pf-edit"
              style={{ width: '100%', textAlign: 'left', padding: '10px 12px', minHeight: 70, resize: 'vertical', marginTop: 10 }}
              placeholder="오염·손상 사유"
              value={issueReason}
              onChange={(e) => setIssueReason(e.target.value)}
            />
            {issueErr && <p className="hint err">{issueErr}</p>}
            <div className="wd-btns">
              <button className="cta ghost" onClick={() => setIssueTarget(null)}>취소</button>
              <button className="cta" disabled={pending} onClick={submitIssue}>등록</button>
            </div>
          </div>
        </div>
      )}

      {reassignTarget && (
        <div className="wd-ov" onClick={(e) => e.target === e.currentTarget && setReassignTarget(null)}>
          <div className="wd-box">
            <div className="wd-title">재고 개체 재배정</div>
            <p className="wd-desc">같은 상품의 다른 개체로 바꿀 수 있어요. 폐기·수선 중인 개체는 목록에서 빠집니다.</p>
            {reassignLoading ? (
              <p className="staff-empty" style={{ padding: '20px 0' }}>불러오는 중…</p>
            ) : siblingItems.length === 0 ? (
              <p className="staff-empty" style={{ padding: '20px 0' }}>배정 가능한 다른 개체가 없습니다.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                {siblingItems.map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    className="order-status-btn"
                    disabled={pending || it.isCurrent}
                    onClick={() => pickReassign(it.id)}
                    style={{ display: 'flex', justifyContent: 'space-between', width: '100%', textAlign: 'left' }}
                  >
                    <span>{it.barcode}{it.isCurrent ? ' (현재 배정됨)' : ''}</span>
                    <span>{it.status} · 컨디션 {it.condition}</span>
                  </button>
                ))}
              </div>
            )}
            {reassignErr && <p className="hint err">{reassignErr}</p>}
            <div className="wd-btns">
              <button className="cta ghost" onClick={() => setReassignTarget(null)}>닫기</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
