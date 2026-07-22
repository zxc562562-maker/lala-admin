'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabaseBrowser } from '@lala/shared/lib/supabase/client';
import type { CustomerRow } from '@/lib/customer-actions';

const won = (n: number) => n.toLocaleString('ko-KR') + '원';
const dateOnly = (s: string) => s.slice(0, 10);

export default function AdminCustomers({ customers }: { customers: CustomerRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [sortBySpend, setSortBySpend] = useState(false);

  useEffect(() => {
    const sb = supabaseBrowser();
    const ch = sb.channel('admin-customers')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_order' }, () => router.refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customer' }, () => router.refresh())
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [router]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = customers.filter((c) => !q || c.name.toLowerCase().includes(q) || (c.phone ?? '').includes(q));
    if (sortBySpend) list = [...list].sort((a, b) => b.totalSpent - a.totalSpent);
    return list;
  }, [customers, query, sortBySpend]);

  return (
    <section>
      <div className="admin-topbar">
        <h1 className="staff-title">회원 <span className="rt-dot" title="실시간 연결됨">●</span></h1>
      </div>

      <div className="admin-toolbar">
        <input className="admin-search" placeholder="이름 · 전화번호 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="btn-ghost" style={{ borderColor: sortBySpend ? 'var(--espresso)' : undefined, color: sortBySpend ? 'var(--espresso)' : undefined }}
          onClick={() => setSortBySpend((v) => !v)}>
          누적 결제액 높은순 {sortBySpend ? '✓' : ''}
        </button>
        <div className="admin-spacer" />
        <span className="prod-brand">총 {filtered.length}명</span>
      </div>

      {filtered.length === 0 ? (
        <p className="staff-empty">조건에 맞는 회원이 없습니다.</p>
      ) : (
        <div className="dtable-wrap">
          <table className="dtable">
            <thead>
              <tr><th>이름</th><th>전화번호</th><th>가입일</th><th className="num">주문 수</th><th className="num">누적 결제액</th><th>최근 주문일</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td className="prod-name"><Link href={`/admin/customers/${c.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>{c.name}</Link></td>
                  <td>{c.phone ?? '—'}</td>
                  <td>{dateOnly(c.joinedAt)}</td>
                  <td className="num">{c.orderCount}</td>
                  <td className="num">{won(c.totalSpent)}</td>
                  <td>{c.lastOrderAt ? dateOnly(c.lastOrderAt) : '—'}</td>
                  <td><Link href={`/admin/customers/${c.id}`} className="btn-text">상세</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
