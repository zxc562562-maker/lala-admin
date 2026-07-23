'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabaseBrowser } from '@lala/shared/lib/supabase/client';
import { createProduct, updateProduct, type ProductRow, type ProductInput } from '@/lib/product-actions';

const won = (n: number) => n.toLocaleString('ko-KR') + '원';

const EMPTY_FORM: ProductInput = {
  name: '', category: '', size: '', colorName: '', dailyPrice: 0, deposit: 0, c1: '#3B2230', c2: '#6B2737',
};

export default function AdminProducts({ products }: { products: ProductRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('전체');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProductInput>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const sb = supabaseBrowser();
    const ch = sb
      .channel('admin-products')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'product' }, () => router.refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_item' }, () => router.refresh())
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [router]);

  const categories = useMemo(() => {
    const set = new Set(products.map((p) => p.category));
    return ['전체', ...Array.from(set)];
  }, [products]);

  const filtered = useMemo(() => {
    return products.filter((p) => {
      const matchesCategory = category === '전체' || p.category === category;
      const q = query.trim().toLowerCase();
      const matchesQuery = !q || p.name.toLowerCase().includes(q) || p.barcodes.some((b) => b.toLowerCase().includes(q));
      return matchesCategory && matchesQuery;
    });
  }, [products, query, category]);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setDrawerOpen(true);
  }

  function openEdit(p: ProductRow) {
    setEditingId(p.id);
    setForm({ name: p.name, category: p.category, size: p.size, colorName: p.colorName ?? '', dailyPrice: p.dailyPrice, deposit: p.deposit, c1: p.c1, c2: p.c2 });
    setFormError(null);
    setDrawerOpen(true);
  }

  function closeDrawer() {
    if (pending) return;
    setDrawerOpen(false);
  }

  function submit() {
    if (!form.colorName.trim()) { setFormError('색상명을 입력해주세요(바코드 생성에 필요해요).'); return; }
    setFormError(null);
    startTransition(async () => {
      const result = editingId ? await updateProduct(editingId, form) : await createProduct(form);
      if (!result.ok) {
        setFormError(result.reason ?? '저장에 실패했습니다.');
        return;
      }
      setDrawerOpen(false);
      router.refresh();
    });
  }

  return (
    <section>
      <div className="admin-topbar">
        <h1 className="staff-title">상품 <span className="rt-dot" title="실시간 연결됨">●</span></h1>
        <button className="btn-primary" onClick={openCreate}>+ 상품 등록</button>
      </div>

      <div className="admin-toolbar">
        <input className="admin-search" placeholder="상품명 · 바코드 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className="admin-select-filter" value={category} onChange={(e) => setCategory(e.target.value)}>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="admin-spacer" />
        <span className="prod-brand">총 {filtered.length}개</span>
      </div>

      {filtered.length === 0 ? (
        <p className="staff-empty">등록된 상품이 없습니다.</p>
      ) : (
        <div className="dtable-wrap">
          <table className="dtable">
            <thead>
              <tr>
                <th>이미지</th><th>카테고리</th><th>상품</th><th>사이즈</th>
                <th className="num">렌탈요금</th><th className="num">보증금</th><th className="num">재고</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/admin/products/${p.id}`}>
                      <div className="order-item-thumb" style={{ background: `linear-gradient(160deg, ${p.c2}, ${p.c1})` }} />
                    </Link>
                  </td>
                  <td>{p.category}</td>
                  <td>
                    <Link href={`/admin/products/${p.id}`} className="prod-name" style={{ textDecoration: 'none' }}>{p.name}</Link>
                    {p.barcodes.length > 0 && <div className="prod-brand prod-barcodes">{p.barcodes.join(', ')}</div>}
                  </td>
                  <td>{p.size}</td>
                  <td className="num">{won(p.dailyPrice)}</td>
                  <td className="num">{won(p.deposit)}</td>
                  <td className="num">{p.itemCount}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn-primary" style={{ padding: '7px 14px' }} onClick={() => openEdit(p)}>수정</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {drawerOpen && (
        <div className="wd-ov" onClick={(e) => e.target === e.currentTarget && closeDrawer()}>
          <div className="modal-form-box">
            <h2>{editingId ? '상품 수정' : '상품 등록'}</h2>
            <div className="field-group">
              <label>상품명</label>
              <input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="drawer-row">
              <div className="field-group">
                <label>카테고리</label>
                <input className="field" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
              </div>
              <div className="field-group">
                <label>사이즈</label>
                <input className="field" value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} />
              </div>
            </div>
            <div className="field-group">
              <label>색상명 (영문, 바코드용 — 예: BLACK)</label>
              <input className="field" value={form.colorName} onChange={(e) => setForm({ ...form, colorName: e.target.value })} />
            </div>
            <div className="drawer-row">
              <div className="field-group">
                <label>일 대여료(원)</label>
                <input type="number" min="0" step="1000" className="field" value={form.dailyPrice}
                  onChange={(e) => setForm({ ...form, dailyPrice: Math.max(0, Number(e.target.value) || 0) })} />
              </div>
              <div className="field-group">
                <label>보증금(원)</label>
                <input type="number" min="0" step="1000" className="field" value={form.deposit}
                  onChange={(e) => setForm({ ...form, deposit: Math.max(0, Number(e.target.value) || 0) })} />
              </div>
            </div>
            {formError && <p style={{ fontSize: 12 }}>{formError}</p>}

            <div className="drawer-actions">
              <button className="btn-ghost" onClick={closeDrawer} disabled={pending}>취소</button>
              <button className="btn-primary" onClick={submit} disabled={pending}>{pending ? '저장 중…' : '저장'}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
