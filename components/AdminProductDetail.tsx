'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabaseBrowser } from '@lala/shared/lib/supabase/client';
import { createInventoryItem, updateInventoryItemStatus, type AdminInventoryItem } from '@/lib/product-actions';
import { nextStates } from '@lala/shared/lib/domain/inventory';
import type { ItemStatus } from '@lala/shared/lib/domain/inventory';
import type { Product } from '@lala/shared/lib/types';

const won = (n: number) => n.toLocaleString('ko-KR') + '원';

const LABEL: Record<ItemStatus, string> = {
  AVAILABLE: '대여가능', RESERVED: '예약됨', RENTED: '대여중', RETURNED: '회수됨',
  CLEANING: '세탁중', INSPECTING: '검수중', REPAIRING: '수선중', RETIRED: '폐기',
};

const BADGE_COLOR: Record<ItemStatus, string> = {
  AVAILABLE: 'var(--sage)', RESERVED: 'var(--gold)', RENTED: 'var(--wine)', RETURNED: 'var(--muted)',
  CLEANING: 'var(--gold)', INSPECTING: 'var(--gold)', REPAIRING: 'var(--wine)', RETIRED: 'var(--muted)',
};

export default function AdminProductDetail({ product, items }: { product: Product; items: AdminInventoryItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [barcode, setBarcode] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    const sb = supabaseBrowser();
    const ch = sb
      .channel(`admin-product-${product.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_item', filter: `product_id=eq.${product.id}` }, () => router.refresh())
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [router, product.id]);

  function addItem() {
    if (!barcode.trim()) { setAddError('바코드를 입력해주세요.'); return; }
    setAddError(null);
    startTransition(async () => {
      const result = await createInventoryItem(product.id, barcode);
      if (!result.ok) { setAddError(result.reason ?? '추가에 실패했습니다.'); return; }
      setBarcode('');
      router.refresh();
    });
  }

  function changeStatus(itemId: string, to: ItemStatus) {
    setBusyId(itemId);
    startTransition(async () => {
      const result = await updateInventoryItemStatus(itemId, to);
      setBusyId(null);
      if (!result.ok) alert(result.reason ?? '상태 변경에 실패했습니다.');
      router.refresh();
    });
  }

  return (
    <section>
      <div className="admin-topbar">
        <div>
          <Link href="/admin/products" className="btn-text" style={{ paddingLeft: 0 }}>← 상품 목록</Link>
          <h1 className="staff-title" style={{ marginTop: 6 }}>{product.name} <span className="rt-dot" title="실시간 연결됨">●</span></h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input className="admin-search" style={{ minWidth: 160 }} placeholder="새 바코드" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
          <button className="btn-primary" onClick={addItem} disabled={pending}>{pending && !busyId ? '추가 중…' : '+ 개체 추가'}</button>
        </div>
      </div>
      {addError && <p style={{ color: 'var(--wine)', fontSize: 12, marginTop: -12, marginBottom: 12 }}>{addError}</p>}

      <div className="dtable-wrap" style={{ padding: '16px 20px', marginBottom: 24, display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="swatch-pair" style={{ width: 26, height: 26 }}>
          <span style={{ background: product.c1, width: 13, height: 26, display: 'block' }} />
          <span style={{ background: product.c2, width: 13, height: 26, display: 'block' }} />
        </span>
        <div>
          <div className="prod-name">{product.name}</div>
          <div className="prod-brand">{product.brand || '—'}</div>
        </div>
        <div className="prod-brand">{product.category} · {product.size}</div>
        <div className="admin-spacer" />
        <div className="prod-brand">일 대여료 <b style={{ color: 'var(--espresso)' }}>{won(product.dailyPrice)}</b></div>
        <div className="prod-brand">보증금 <b style={{ color: 'var(--espresso)' }}>{won(product.deposit)}</b></div>
        <div className="prod-brand">재고 <b style={{ color: 'var(--espresso)' }}>{items.length}개</b></div>
      </div>

      {items.length === 0 ? (
        <p className="staff-empty">등록된 재고 개체가 없습니다. 바코드를 입력하고 "개체 추가"로 첫 개체를 만들어보세요.</p>
      ) : (
        <div className="dtable-wrap">
          <table className="dtable">
            <thead>
              <tr><th>바코드</th><th>상태</th><th className="num">컨디션</th><th className="num">누적 대여</th><th>다음 상태로 변경</th></tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const options = nextStates(it.status);
                const rowBusy = pending && busyId === it.id;
                return (
                  <tr key={it.id}>
                    <td>{it.barcode}</td>
                    <td><span style={{ color: BADGE_COLOR[it.status], fontSize: 12.5 }}>● {LABEL[it.status]}</span></td>
                    <td className="num">{it.condition}</td>
                    <td className="num">{it.rentalCount}</td>
                    <td>
                      {options.length === 0 ? (
                        <span className="prod-brand">—</span>
                      ) : (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {options.map((to) => (
                            <button key={to} className="btn-ghost" style={{ padding: '5px 10px', fontSize: 11.5 }} disabled={pending}
                              onClick={() => changeStatus(it.id, to)}>
                              {rowBusy ? '변경 중…' : `→ ${LABEL[to]}`}
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="prod-brand" style={{ marginTop: 14 }}>
        상태 변경은 정해진 순서(예: 회수됨 → 세탁중 → 검수중 → 대여가능)만 허용돼요. 잘못된 순서는 서버에서 막힙니다.
      </p>
    </section>
  );
}
