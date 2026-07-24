'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabaseBrowser } from '@lala/shared/lib/supabase/client';
import type { InventoryListRow } from '@/lib/product-actions';
import type { ItemStatus } from '@lala/shared/lib/domain/inventory';

const LABEL: Record<ItemStatus, string> = {
  AVAILABLE: '대여가능', RESERVED: '예약됨', RENTED: '대여중', RETURNED: '회수됨',
  CLEANING: '세탁중', INSPECTING: '검수중', REPAIRING: '수선중', RETIRED: '폐기',
};
const STATUS_OPTIONS: (ItemStatus | '전체')[] = ['전체', 'AVAILABLE', 'RESERVED', 'RENTED', 'RETURNED', 'CLEANING', 'INSPECTING', 'REPAIRING', 'RETIRED'];

export default function AdminInventory({ items }: { items: InventoryListRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<ItemStatus | '전체'>('전체');
  const [category, setCategory] = useState('전체');
  const [sortByCondition, setSortByCondition] = useState(true);

  useEffect(() => {
    const sb = supabaseBrowser();
    const ch = sb.channel('admin-inventory')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_item' }, () => router.refresh())
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [router]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = items.filter((it) => {
      const matchesStatus = status === '전체' || it.status === status;
      const matchesCategory = category === '전체' || it.productCategory === category;
      const matchesQuery = !q || it.productName.toLowerCase().includes(q) || it.barcode.toLowerCase().includes(q);
      return matchesStatus && matchesCategory && matchesQuery;
    });
    if (sortByCondition) list = [...list].sort((a, b) => a.condition - b.condition);
    return list;
  }, [items, query, status, category, sortByCondition]);

  const counts = useMemo(() => {
    const m = new Map<ItemStatus, number>();
    for (const it of items) m.set(it.status, (m.get(it.status) ?? 0) + 1);
    return m;
  }, [items]);

  const categories = useMemo(() => {
    const set = new Set(items.map((it) => it.productCategory));
    return ['전체', ...Array.from(set)];
  }, [items]);

  const categoryCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items) m.set(it.productCategory, (m.get(it.productCategory) ?? 0) + 1);
    return m;
  }, [items]);

  return (
    <section>
      <div className="admin-topbar">
        <h1 className="staff-title">재고 현황 <span className="rt-dot" title="실시간 연결됨">●</span></h1>
      </div>

      <div className="admin-toolbar" style={{ marginBottom: 10 }}>
        {STATUS_OPTIONS.map((s) => (
          <button key={s} className="btn-ghost"
            style={{ padding: '5px 10px', fontSize: 11.5, borderColor: status === s ? 'var(--espresso)' : undefined, color: status === s ? 'var(--espresso)' : undefined }}
            onClick={() => setStatus(s)}>
            {s === '전체' ? '전체' : LABEL[s]} {s !== '전체' && `(${counts.get(s) ?? 0})`}
          </button>
        ))}
      </div>

      <div className="admin-toolbar" style={{ marginBottom: 10 }}>
        {categories.map((c) => (
          <button key={c} className="btn-ghost"
            style={{ padding: '5px 10px', fontSize: 11.5, borderColor: category === c ? 'var(--espresso)' : undefined, color: category === c ? 'var(--espresso)' : undefined }}
            onClick={() => setCategory(c)}>
            {c === '전체' ? '전체' : `${c} (${categoryCounts.get(c) ?? 0})`}
          </button>
        ))}
      </div>

      <div className="admin-toolbar">
        <input className="admin-search" placeholder="바코드 · 상품명 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="btn-ghost" onClick={() => setSortByCondition((v) => !v)}>
          {sortByCondition ? '컨디션 낮은순 ✓' : '컨디션 정렬 끔'}
        </button>
        <div className="admin-spacer" />
        <span className="prod-brand">총 {filtered.length}개</span>
      </div>

      {filtered.length === 0 ? (
        <p className="staff-empty">조건에 맞는 재고 개체가 없습니다.</p>
      ) : (
        <div className="dtable-wrap">
          <table className="dtable">
            <thead>
              <tr><th>이미지</th><th>카테고리</th><th>상품</th><th>사이즈</th><th>상태</th><th className="num">컨디션</th><th className="num">누적 대여</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map((it) => (
                <tr key={it.id}>
                  <td>
                    <Link href={`/admin/products/${it.productId}`}>
                      <div className="order-item-thumb" style={{ background: `linear-gradient(160deg, ${it.c2}, ${it.c1})` }} />
                    </Link>
                  </td>
                  <td>{it.productCategory}</td>
                  <td>
                    <span className="prod-name">{it.productName}</span>
                    <div className="prod-brand prod-barcodes">{it.barcode}</div>
                  </td>
                  <td>{it.productSize}</td>
                  <td><span>● {LABEL[it.status]}</span></td>
                  <td className="num">{it.condition}</td>
                  <td className="num">{it.rentalCount}</td>
                  <td><Link href={`/admin/products/${it.productId}`} className="btn-text">상품 보기</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
