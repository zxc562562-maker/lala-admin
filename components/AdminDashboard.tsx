'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import type { DashboardData, OrderLineItem, OrderProductRow } from '@/lib/dashboard-actions';
import { getOrderProducts } from '@/lib/dashboard-actions';
import type { Fulfillment } from '@lala/shared/lib/staff-actions';
import { FULFILLMENT_LABEL } from '@lala/shared/lib/fulfillment-label';
import type { ItemStatus } from '@lala/shared/lib/domain/inventory';

const won = (n: number) => n.toLocaleString('ko-KR') + '원';
const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
const DASH = '-';

const ITEM_LABEL: Record<ItemStatus, string> = {
  AVAILABLE: '대여가능', RESERVED: '예약됨', RENTED: '대여중', RETURNED: '회수됨',
  CLEANING: '세탁중', INSPECTING: '검수중', REPAIRING: '수선중', RETIRED: '폐기',
};

type PanelKey = 'revenue' | 'utilization' | 'newCustomers' | 'orders' | 'inventory' | 'topProducts';

function weekOfMonth(d: Date): number {
  const firstOfMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  const offset = firstOfMonth.getDay();
  return Math.floor((d.getDate() - 1 + offset) / 7) + 1;
}
function weeksInMonth(d: Date): number {
  const lastOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return weekOfMonth(lastOfMonth);
}
function dateKey(iso: string): string { return iso.slice(0, 10); }
function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}
function dayButtonLabel(iso: string): string {
  const d = new Date(iso);
  return `${DAY_NAMES[d.getDay()]}요일 · ${d.getMonth() + 1}/${d.getDate()}`;
}

interface DayGroup { key: string; label: string; orders: OrderLineItem[] }

/** 시간 순 정렬된 주문들을 날짜별로 묶는다 (요일 버튼용). 날짜 오름차순으로 정렬해서 반환. */
function groupByDay(orders: OrderLineItem[]): DayGroup[] {
  const groups = new Map<string, OrderLineItem[]>();
  for (const o of orders) {
    const key = dateKey(o.createdAt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(o);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, list]) => ({ key, label: dayButtonLabel(list[0].createdAt), orders: list }));
}

function ProductBreakdown({ orderId }: { orderId: string }) {
  const [products, setProducts] = useState<OrderProductRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getOrderProducts(orderId).then((rows) => {
      if (!cancelled) { setProducts(rows); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [orderId]);

  if (loading) return <p className="prod-brand" style={{ padding: '10px 16px' }}>불러오는 중…</p>;
  if (!products || products.length === 0) return <p className="prod-brand" style={{ padding: '10px 16px' }}>상품 내역을 찾을 수 없습니다.</p>;

  return (
    <div className="dtable-wrap" style={{ margin: '4px 0 10px' }}>
      <table className="dtable">
        <thead>
          <tr><th>상품명</th><th className="num">일 대여료</th><th className="num">대여일수</th><th className="num">대여금액</th><th className="num">보증금</th></tr>
        </thead>
        <tbody>
          {products.map((p, i) => (
            <tr key={i}>
              <td className="prod-name">{p.productName}</td>
              <td className="num">{won(p.dailyPrice)}</td>
              <td className="num">{p.days}일</td>
              <td className="num">{won(p.rentalAmount)}</td>
              <td className="num">{won(p.deposit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrderTable({ orders }: { orders: OrderLineItem[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  if (orders.length === 0) return <p className="staff-empty">해당 기간 결제 내역이 없습니다.</p>;

  function toggle(id: string) {
    setExpandedId((cur) => (cur === id ? null : id));
  }

  return (
    <div className="dtable-wrap">
      <table className="dtable">
        <thead>
          <tr><th className="ctr">시각</th><th className="ctr">고객</th><th className="num">금액</th><th className="ctr">담당자</th></tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <Fragment key={o.id}>
              <tr style={{ cursor: 'pointer' }} onClick={() => toggle(o.id)}>
                <td className="ctr">{timeLabel(o.createdAt)}</td>
                <td className="ctr">{o.customerName}</td>
                <td className="num">{won(o.amount)}</td>
                <td className="ctr">{o.assignedToName ?? DASH}</td>
              </tr>
              {expandedId === o.id && (
                <tr>
                  <td colSpan={4} style={{ padding: '0 16px 12px', background: 'var(--paper)' }}>
                    <ProductBreakdown orderId={o.id} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 요일 버튼 + 선택된 요일의 단건 내역. 데이터가 있는 날짜만 버튼으로 노출하고, 기본으로 첫 번째 날짜를 선택해서 보여준다. */
function DaySelector({ orders }: { orders: OrderLineItem[] }) {
  const groups = useMemo(() => groupByDay(orders), [orders]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const activeKey = groups.some((g) => g.key === selectedKey) ? selectedKey : (groups[0]?.key ?? null);
  const activeGroup = groups.find((g) => g.key === activeKey) ?? null;

  if (groups.length === 0) return <p className="staff-empty">해당 기간 결제 내역이 없습니다.</p>;

  return (
    <div>
      <div className="admin-toolbar" style={{ marginBottom: 16 }}>
        {groups.map((g) => (
          <button key={g.key} className="btn-ghost"
            style={{ borderColor: activeKey === g.key ? 'var(--espresso)' : undefined, color: activeKey === g.key ? 'var(--espresso)' : undefined }}
            onClick={() => setSelectedKey(g.key)}>
            {g.label}
          </button>
        ))}
      </div>
      <OrderTable orders={activeGroup?.orders ?? []} />
    </div>
  );
}

function RevenuePanel({ revenue }: { revenue: DashboardData['revenue'] }) {
  const [view, setView] = useState<'today' | 'week' | 'month'>('today');
  const [selectedWeek, setSelectedWeek] = useState<number>(1);

  const now = new Date();
  const weekCount = weeksInMonth(now);
  const monthOrdersForSelectedWeek = useMemo(
    () => revenue.monthOrders.filter((o) => weekOfMonth(new Date(o.createdAt)) === selectedWeek),
    [revenue.monthOrders, selectedWeek],
  );

  return (
    <div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
        <MetricCard clickable active={view === 'today'} onClick={() => setView('today')} label="오늘 매출" value={won(revenue.today)} />
        <MetricCard clickable active={view === 'week'} onClick={() => setView('week')} label="이번주 매출" value={won(revenue.thisWeek)} />
        <MetricCard clickable active={view === 'month'} onClick={() => { setView('month'); setSelectedWeek(1); }} label="이번달 매출" value={won(revenue.thisMonth)} />
      </div>

      {view === 'today' && <OrderTable orders={revenue.todayOrders} />}
      {view === 'week' && <DaySelector orders={revenue.weekOrders} />}
      {view === 'month' && (
        <div>
          <div className="admin-toolbar" style={{ marginBottom: 16 }}>
            {Array.from({ length: weekCount }, (_, i) => i + 1).map((w) => (
              <button key={w} className="btn-ghost"
                style={{ borderColor: selectedWeek === w ? 'var(--espresso)' : undefined, color: selectedWeek === w ? 'var(--espresso)' : undefined }}
                onClick={() => setSelectedWeek(w)}>
                {w}주차
              </button>
            ))}
          </div>
          <DaySelector key={selectedWeek} orders={monthOrdersForSelectedWeek} />
        </div>
      )}
    </div>
  );
}

function toExcelRows(orders: OrderLineItem[]) {
  return [
    ['시각', '고객', '금액', '담당자'],
    ...orders.map((o) => [new Date(o.createdAt).toLocaleString('ko-KR'), o.customerName, o.amount, o.assignedToName ?? DASH]),
  ];
}

function downloadWorkbook(data: DashboardData) {
  const wb = XLSX.utils.book_new();

  const summaryRows: (string | number)[][] = [
    ['생성 시각', new Date(data.generatedAt).toLocaleString('ko-KR')], [],
    ['매출(오늘)', data.revenue.today], ['매출(이번주)', data.revenue.thisWeek], ['매출(이번달)', data.revenue.thisMonth], [],
    ['가동률(%)', data.utilizationRate], ['이번달 신규 회원', data.newCustomersThisMonth],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), '요약');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(toExcelRows(data.revenue.monthOrders)), '이번달 매출 단건');

  const orderRows = [['처리상태', '건수'], ...Object.entries(data.orderStatusCounts).map(([k, v]) => [FULFILLMENT_LABEL[k as Fulfillment], v])];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(orderRows), '주문현황');

  const invRows = [['재고상태', '개수'], ...Object.entries(data.inventoryStatusCounts).map(([k, v]) => [ITEM_LABEL[k as ItemStatus], v])];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(invRows), '재고현황');

  const topRows = [['상품명', '누적 대여횟수'], ...data.topProducts.map((p) => [p.name, p.rentalCount])];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(topRows), '인기상품');

  const dateStr = new Date(data.generatedAt).toISOString().slice(0, 10);
  XLSX.writeFile(wb, `lala-dashboard-${dateStr}.xlsx`);
}

const PANELS: { key: PanelKey; label: string }[] = [
  { key: 'revenue', label: '매출' }, { key: 'utilization', label: '가동률' }, { key: 'newCustomers', label: '신규 회원' },
  { key: 'orders', label: '주문 처리상태' }, { key: 'inventory', label: '재고 상태' }, { key: 'topProducts', label: '인기 상품' },
];

export default function AdminDashboard({ data }: { data: DashboardData }) {
  const [active, setActive] = useState<PanelKey>('revenue');

  return (
    <section>
      <div className="admin-topbar">
        <h1 className="staff-title">대시보드</h1>
        <button className="btn-primary" onClick={() => downloadWorkbook(data)}>⬇ 엑셀로 내보내기</button>
      </div>
      <p className="prod-brand" style={{ marginBottom: 16 }}>{new Date(data.generatedAt).toLocaleString('ko-KR')} 기준</p>

      <div className="admin-toolbar" style={{ marginBottom: 20 }}>
        {PANELS.map((p) => (
          <button key={p.key} className="btn-ghost"
            style={{ borderColor: active === p.key ? 'var(--espresso)' : undefined, color: active === p.key ? 'var(--espresso)' : undefined }}
            onClick={() => setActive(p.key)}>
            {p.label}
          </button>
        ))}
      </div>

      {active === 'revenue' && <RevenuePanel revenue={data.revenue} />}

      {active === 'utilization' && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <MetricCard label="가동률 (전체 재고 중 현재 대여중 비율)" value={`${data.utilizationRate}%`} />
        </div>
      )}

      {active === 'newCustomers' && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <MetricCard label="이번달 신규 회원" value={`${data.newCustomersThisMonth}명`} />
        </div>
      )}

      {active === 'orders' && (
        <div className="dtable-wrap">
          <table className="dtable"><tbody>
            {Object.entries(data.orderStatusCounts).map(([k, v]) => (
              <tr key={k}><td>{FULFILLMENT_LABEL[k as Fulfillment]}</td><td className="num">{v}건</td></tr>
            ))}
          </tbody></table>
        </div>
      )}

      {active === 'inventory' && (
        <div className="dtable-wrap">
          <table className="dtable"><tbody>
            {Object.entries(data.inventoryStatusCounts).map(([k, v]) => (
              <tr key={k}><td>{ITEM_LABEL[k as ItemStatus]}</td><td className="num">{v}개</td></tr>
            ))}
          </tbody></table>
        </div>
      )}

      {active === 'topProducts' && (
        data.topProducts.length === 0 ? (
          <p className="staff-empty">데이터가 없습니다.</p>
        ) : (
          <div className="dtable-wrap">
            <table className="dtable">
              <thead><tr><th>상품명</th><th className="num">누적 대여</th></tr></thead>
              <tbody>
                {data.topProducts.map((p) => (
                  <tr key={p.name}><td className="prod-name">{p.name}</td><td className="num">{p.rentalCount}회</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </section>
  );
}

function MetricCard({ label, value, clickable, active, onClick }: { label: string; value: string; clickable?: boolean; active?: boolean; onClick?: () => void }) {
  return (
    <div className="dtable-wrap" onClick={onClick}
      style={{ padding: '14px 18px', flex: '1 1 220px', cursor: clickable ? 'pointer' : undefined, borderColor: active ? 'var(--espresso)' : undefined }}>
      <div className="prod-brand">{label}</div>
      <div className="prod-name" style={{ fontSize: 20, marginTop: 6 }}>{value}</div>
    </div>
  );
}
