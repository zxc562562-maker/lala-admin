'use client';

import Link from 'next/link';
import type { CustomerDetail, CustomerOrderRow } from '@/lib/customer-actions';
import { FULFILLMENT_LABEL } from '@lala/shared/lib/fulfillment-label';

const won = (n: number) => n.toLocaleString('ko-KR') + '원';
const dateOnly = (s: string) => s.slice(0, 10);

const PAY_LABEL: Record<string, string> = { PENDING: '결제대기', PAID: '결제완료', FAILED: '결제실패', CANCELLED: '취소됨' };

export default function AdminCustomerDetail({ customer, orders }: { customer: CustomerDetail; orders: CustomerOrderRow[] }) {
  const totalSpent = orders.filter((o) => o.status === 'PAID').reduce((sum, o) => sum + o.amount, 0);

  return (
    <section>
      <div className="admin-topbar">
        <div>
          <Link href="/admin/customers" className="btn-text" style={{ paddingLeft: 0 }}>← 회원 목록</Link>
          <h1 className="staff-title" style={{ marginTop: 6 }}>{customer.name}</h1>
        </div>
      </div>

      <div className="dtable-wrap" style={{ padding: '16px 20px', marginBottom: 24, display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
        <div><div className="prod-brand">전화번호</div><div className="prod-name">{customer.phone ?? '—'}</div></div>
        <div><div className="prod-brand">가입일</div><div className="prod-name">{dateOnly(customer.joinedAt)}</div></div>
        <div className="admin-spacer" />
        <div><div className="prod-brand">누적 결제액</div><div className="prod-name">{won(totalSpent)}</div></div>
        <div><div className="prod-brand">총 주문</div><div className="prod-name">{orders.length}건</div></div>
      </div>

      {orders.length === 0 ? (
        <p className="staff-empty">주문 이력이 없습니다.</p>
      ) : (
        <div className="dtable-wrap">
          <table className="dtable">
            <thead><tr><th>기간</th><th className="num">금액</th><th>결제상태</th><th>처리상태</th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>{o.checkout} → {o.return}</td>
                  <td className="num">{won(o.amount)}</td>
                  <td><span>● {PAY_LABEL[o.status] ?? o.status}</span></td>
                  <td>{o.status === 'PAID' ? FULFILLMENT_LABEL[o.fulfillment] : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
