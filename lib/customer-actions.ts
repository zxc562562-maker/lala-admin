'use server';

import { supabaseAdmin } from '@lala/shared/lib/supabase/server';
import { getAccess } from '@lala/shared/lib/roles';
import type { Fulfillment } from '@lala/shared/lib/staff-actions';

export interface CustomerRow {
  id: string;
  name: string;
  phone: string | null;
  joinedAt: string;
  orderCount: number;
  totalSpent: number;
  lastOrderAt: string | null;
}

/** 회원 목록 + 결제완료 주문 기준 통계 */
export async function listCustomers(): Promise<CustomerRow[]> {
  const me = await getAccess();
  if (!me?.isApprover) return [];

  const sb = supabaseAdmin();
  const [{ data: customers, error: cErr }, { data: orders }] = await Promise.all([
    sb.from('customer').select('id,name,phone,created_at').order('created_at', { ascending: false }),
    sb.from('payment_order').select('customer_id,amount,created_at').eq('status', 'PAID'),
  ]);
  if (cErr || !customers) return [];

  const stats = new Map<string, { count: number; total: number; last: string | null }>();
  for (const o of (orders ?? []) as { customer_id: string; amount: number; created_at: string }[]) {
    const s = stats.get(o.customer_id) ?? { count: 0, total: 0, last: null };
    s.count += 1;
    s.total += o.amount;
    if (!s.last || o.created_at > s.last) s.last = o.created_at;
    stats.set(o.customer_id, s);
  }

  return (customers as unknown as { id: string; name: string; phone: string | null; created_at: string }[]).map((c) => {
    const s = stats.get(c.id);
    return {
      id: c.id, name: c.name, phone: c.phone, joinedAt: c.created_at,
      orderCount: s?.count ?? 0, totalSpent: s?.total ?? 0, lastOrderAt: s?.last ?? null,
    };
  });
}

export interface CustomerDetail {
  id: string;
  name: string;
  phone: string | null;
  joinedAt: string;
}

export interface CustomerOrderRow {
  id: string;
  checkout: string;
  return: string;
  amount: number;
  status: 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED';
  fulfillment: Fulfillment;
}

/** 회원 1명 + 전체 주문 이력 */
export async function getCustomerDetail(customerId: string): Promise<{ customer: CustomerDetail; orders: CustomerOrderRow[] } | null> {
  const me = await getAccess();
  if (!me?.isApprover) return null;

  const sb = supabaseAdmin();
  const [{ data: customer, error: cErr }, { data: orders }] = await Promise.all([
    sb.from('customer').select('id,name,phone,created_at').eq('id', customerId).maybeSingle(),
    sb.from('payment_order')
      .select('id,checkout,return_date,amount,status,fulfillment_status')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false }),
  ]);
  if (cErr || !customer) return null;

  const c = customer as unknown as { id: string; name: string; phone: string | null; created_at: string };
  return {
    customer: { id: c.id, name: c.name, phone: c.phone, joinedAt: c.created_at },
    orders: ((orders ?? []) as unknown as {
      id: string; checkout: string; return_date: string; amount: number;
      status: CustomerOrderRow['status']; fulfillment_status: Fulfillment;
    }[]).map((o) => ({
      id: o.id, checkout: o.checkout, return: o.return_date, amount: o.amount,
      status: o.status, fulfillment: o.fulfillment_status,
    })),
  };
}
