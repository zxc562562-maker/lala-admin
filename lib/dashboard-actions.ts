'use server';

import { supabaseAdmin } from '@lala/shared/lib/supabase/server';
import { getAccess } from '@lala/shared/lib/roles';
import type { Fulfillment } from '@lala/shared/lib/staff-actions';
import type { ItemStatus } from '@lala/shared/lib/domain/inventory';

export interface OrderLineItem {
  id: string;
  customerName: string;
  amount: number;
  createdAt: string; // ISO
  assignedToName: string | null;
}

export interface RevenueSummary {
  today: number;
  thisWeek: number;
  thisMonth: number;
  todayOrders: OrderLineItem[];
  weekOrders: OrderLineItem[];
  monthOrders: OrderLineItem[];
}

export interface TopProductRow {
  name: string;
  rentalCount: number;
}

export interface DashboardData {
  generatedAt: string;
  revenue: RevenueSummary;
  orderStatusCounts: Record<Fulfillment, number>;
  inventoryStatusCounts: Record<ItemStatus, number>;
  utilizationRate: number; // 현재 RENTED 개체 / 전체 개체
  newCustomersThisMonth: number;
  topProducts: TopProductRow[];
}

const FULFILLMENT_KEYS: Fulfillment[] = [
  'ORDERED', 'PRE_INSPECTING', 'READY', 'SHIPPED', 'DELIVERED', 'RETURN_REQUESTED', 'RETURN_INSPECTING',
  'REFUNDED', 'DEPOSIT_REFUNDED', 'PRE_INSPECT_ISSUE', 'MISDELIVERED', 'RETURN_ISSUE', 'CANCELLED',
];
const ITEM_STATUS_KEYS: ItemStatus[] = ['AVAILABLE', 'RESERVED', 'RENTED', 'RETURNED', 'CLEANING', 'INSPECTING', 'REPAIRING', 'RETIRED'];

function startOfDay(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function startOfWeek(d: Date): Date { const x = startOfDay(d); const day = x.getDay(); x.setDate(x.getDate() - day); return x; }
function startOfMonth(d: Date): Date { const x = startOfDay(d); x.setDate(1); return x; }

export interface OrderProductRow {
  productName: string;
  dailyPrice: number;
  days: number;
  rentalAmount: number;
  deposit: number;
}

/** 매출 단건 하나(주문 1건)에 담긴 상품 목록과 가격 */
export async function getOrderProducts(orderId: string): Promise<OrderProductRow[]> {
  const me = await getAccess();
  if (!me?.isApprover) return [];

  const sb = supabaseAdmin();
  const { data: order } = await sb.from('payment_order').select('days').eq('id', orderId).maybeSingle();
  if (!order) return [];
  const days = (order as { days: number }).days;

  const { data: rows, error } = await sb
    .from('reservation')
    .select('item:item_id(product:product_id(name,daily_price,deposit))')
    .eq('payment_order_id', orderId);
  if (error || !rows) return [];

  return (rows as unknown as { item: { product: { name: string; daily_price: number; deposit: number } | null } | null }[])
    .filter((r) => r.item?.product)
    .map((r) => {
      const p = r.item!.product!;
      return { productName: p.name, dailyPrice: p.daily_price, days, rentalAmount: p.daily_price * days, deposit: p.deposit };
    });
}

/** 대시보드 지표 */
export async function getDashboardData(): Promise<DashboardData | null> {
  const me = await getAccess();
  if (!me?.isApprover) return null;

  const sb = supabaseAdmin();
  const now = new Date();
  const dayStart = startOfDay(now), weekStart = startOfWeek(now), monthStart = startOfMonth(now);
  // 주(週) 시작이 이전 달로 넘어가는 경우(예: 이번달 1일이 화요일이라 이번주는 지난달 일요일부터 시작)를 대비해
  // 더 이른 쪽 기준으로 한 번에 조회한다.
  const queryStart = weekStart < monthStart ? weekStart : monthStart;

  const [
    { data: statusRows },
    { data: lineItemRows },
    { data: items },
    { data: customers },
  ] = await Promise.all([
    sb.from('payment_order').select('fulfillment_status').eq('status', 'PAID'),
    sb.from('payment_order')
      .select('id,amount,created_at,customer:customer_id(name),staff:assigned_to(name)')
      .eq('status', 'PAID')
      .gte('created_at', queryStart.toISOString())
      .order('created_at', { ascending: true }),
    sb.from('inventory_item').select('status,rental_count,product_id,product:product_id(name)'),
    sb.from('customer').select('created_at'),
  ]);

  // ---- 주문 처리상태 분포 (전체 기간) ----
  const orderStatusCounts = Object.fromEntries(FULFILLMENT_KEYS.map((k) => [k, 0])) as Record<Fulfillment, number>;
  for (const o of (statusRows ?? []) as { fulfillment_status: Fulfillment }[]) {
    orderStatusCounts[o.fulfillment_status] = (orderStatusCounts[o.fulfillment_status] ?? 0) + 1;
  }

  // ---- 매출 단건 + 합계 (오늘/이번주/이번달) ----
  const allLineItems = ((lineItemRows ?? []) as unknown as {
    id: string; amount: number; created_at: string; customer: { name: string | null } | null; staff: { name: string | null } | null;
  }[]).map((r) => ({
    id: r.id, amount: r.amount, createdAt: r.created_at,
    customerName: r.customer?.name ?? '고객', assignedToName: r.staff?.name ?? null,
  }));

  const todayOrders = allLineItems.filter((o) => new Date(o.createdAt) >= dayStart);
  const weekOrders = allLineItems.filter((o) => new Date(o.createdAt) >= weekStart);
  const monthOrders = allLineItems.filter((o) => new Date(o.createdAt) >= monthStart);
  const sum = (rows: OrderLineItem[]) => rows.reduce((s, r) => s + r.amount, 0);

  // ---- 재고 상태 분포 + 가동률 + 인기상품 ----
  const inventoryStatusCounts = Object.fromEntries(ITEM_STATUS_KEYS.map((k) => [k, 0])) as Record<ItemStatus, number>;
  const productTotals = new Map<string, number>();
  const itemRows = (items ?? []) as unknown as { status: ItemStatus; rental_count: number; product_id: string; product: { name: string } | null }[];
  for (const it of itemRows) {
    inventoryStatusCounts[it.status] = (inventoryStatusCounts[it.status] ?? 0) + 1;
    const name = it.product?.name ?? '(삭제된 상품)';
    productTotals.set(name, (productTotals.get(name) ?? 0) + it.rental_count);
  }
  const totalItems = itemRows.length;
  const utilizationRate = totalItems === 0 ? 0 : Math.round((inventoryStatusCounts.RENTED / totalItems) * 1000) / 10;

  const topProducts = Array.from(productTotals.entries())
    .map(([name, rentalCount]) => ({ name, rentalCount }))
    .sort((a, b) => b.rentalCount - a.rentalCount)
    .slice(0, 5);

  // ---- 이번달 신규 회원 ----
  const newCustomersThisMonth = ((customers ?? []) as { created_at: string }[])
    .filter((c) => new Date(c.created_at) >= monthStart).length;

  return {
    generatedAt: now.toISOString(),
    revenue: { today: sum(todayOrders), thisWeek: sum(weekOrders), thisMonth: sum(monthOrders), todayOrders, weekOrders, monthOrders },
    orderStatusCounts,
    inventoryStatusCounts,
    utilizationRate,
    newCustomersThisMonth,
    topProducts,
  };
}
