'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabaseBrowser } from '@lala/shared/lib/supabase/client';
import { STYLE_OPTIONS, type Style } from '@lala/shared/lib/style';
import {
  createProduct, updateProduct, createProductImageUploadTicket, updateProductPhotos, getProductPhotos,
  type ProductRow, type ProductInput,
} from '@/lib/product-actions';
import { uploadImageDirect } from '@/lib/image-upload-client';

const won = (n: number) => n.toLocaleString('ko-KR') + '원';

const PRODUCT_IMAGE_BUCKET = 'product-images';
const uploadProductImageDirect = (f: File) => uploadImageDirect(f, PRODUCT_IMAGE_BUCKET, createProductImageUploadTicket);

interface GalleryImage { path: string; url: string }

const EMPTY_FORM: ProductInput = {
  name: '', category: '', size: '', colorName: '', dailyPrice: 0, deposit: 0, c1: '#3B2230', c2: '#6B2737', styles: [],
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
  const [uploading, setUploading] = useState(false);
  const [thumbnailPath, setThumbnailPath] = useState<string | null>(null);
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null);
  const [gallery, setGallery] = useState<GalleryImage[]>([]);

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

  const categoryCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of products) m.set(p.category, (m.get(p.category) ?? 0) + 1);
    return m;
  }, [products]);

  const filtered = useMemo(() => {
    return products.filter((p) => {
      const matchesCategory = category === '전체' || p.category === category;
      const q = query.trim().toLowerCase();
      const matchesQuery = !q || p.name.toLowerCase().includes(q) || p.barcodes.some((b) => b.toLowerCase().includes(q));
      return matchesCategory && matchesQuery;
    });
  }, [products, query, category]);

  const busy = pending || uploading;

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setThumbnailPath(null);
    setThumbnailPreview(null);
    setGallery([]);
    setDrawerOpen(true);
  }

  function openEdit(p: ProductRow) {
    setEditingId(p.id);
    setForm({ name: p.name, category: p.category, size: p.size, colorName: p.colorName ?? '', dailyPrice: p.dailyPrice, deposit: p.deposit, c1: p.c1, c2: p.c2, styles: p.styles });
    setFormError(null);
    setThumbnailPath(null);
    setThumbnailPreview(p.imageUrl);
    setGallery([]);
    setDrawerOpen(true);
    startTransition(async () => {
      const photos = await getProductPhotos(p.id);
      setThumbnailPath(photos.imagePath);
      setThumbnailPreview(photos.imageUrl);
      setGallery(photos.gallery);
    });
  }

  function toggleStyle(s: Style) {
    setForm((f) => ({ ...f, styles: f.styles.includes(s) ? f.styles.filter((x) => x !== s) : [...f.styles, s] }));
  }

  function closeDrawer() {
    if (busy) return;
    setDrawerOpen(false);
  }

  async function pickThumbnail(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setFormError(null);
    const preview = URL.createObjectURL(file);
    const res = await uploadProductImageDirect(file);
    setUploading(false);
    if (!res.ok) { setFormError(res.reason); return; }
    setThumbnailPath(res.path);
    setThumbnailPreview(preview);
  }

  async function pickGallery(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    setUploading(true);
    setFormError(null);
    const results = await Promise.all(files.map(async (file) => ({ file, res: await uploadProductImageDirect(file) })));
    for (const { file, res } of results) {
      if (!res.ok) { setFormError(res.reason); continue; }
      setGallery((g) => [...g, { path: res.path, url: URL.createObjectURL(file) }]);
    }
    setUploading(false);
  }

  function removeGalleryImage(path: string) {
    setGallery((g) => g.filter((img) => img.path !== path));
  }

  function submit() {
    if (!form.colorName.trim()) { setFormError('색상명을 입력해주세요(바코드 생성에 필요해요).'); return; }
    setFormError(null);
    startTransition(async () => {
      let productId: string | undefined = editingId ?? undefined;
      if (editingId) {
        const result = await updateProduct(editingId, form);
        if (!result.ok) { setFormError(result.reason ?? '저장에 실패했습니다.'); return; }
      } else {
        const result = await createProduct(form);
        if (!result.ok) { setFormError(result.reason ?? '저장에 실패했습니다.'); return; }
        productId = result.id;
      }
      if (productId) {
        await updateProductPhotos({ productId, imagePath: thumbnailPath, galleryPaths: gallery.map((g) => g.path) });
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
        {categories.map((c) => (
          <button key={c} type="button" className="btn-ghost"
            style={{ padding: '5px 10px', fontSize: 11.5, borderColor: category === c ? 'var(--espresso)' : undefined, color: category === c ? 'var(--espresso)' : undefined }}
            onClick={() => setCategory(c)}>
            {c === '전체' ? '전체' : `${c} (${categoryCounts.get(c) ?? 0})`}
          </button>
        ))}
        <input className="admin-search" style={{ padding: '5px 10px', fontSize: 11.5, minWidth: 160 }}
          placeholder="상품명 · 바코드 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="admin-spacer" />
        <span className="prod-brand">총 {filtered.length}개</span>
      </div>

      {filtered.length === 0 ? (
        <p className="staff-empty">등록된 상품이 없습니다.</p>
      ) : (
        <div className="dtable-wrap">
          <table className="dtable dtable-compact">
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
                      {p.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.imageUrl} alt="" className="order-item-thumb" style={{ objectFit: 'cover' }} />
                      ) : (
                        <div className="order-item-thumb" style={{ background: `linear-gradient(160deg, ${p.c2}, ${p.c1})` }} />
                      )}
                    </Link>
                  </td>
                  <td>{p.category}</td>
                  <td>
                    <Link href={`/admin/products/${p.id}`} className="prod-name" style={{ textDecoration: 'none' }}>{p.name}</Link>
                    {p.styles.length > 0 && <div className="prod-brand">{p.styles.join(', ')}</div>}
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
            <div className="field-group">
              <label>스타일 (여러 개 선택 가능)</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {STYLE_OPTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => toggleStyle(s)}
                    className={`size-chip ${form.styles.includes(s) ? 'chosen' : 'pickable'}`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="field-group">
              <label>상품 썸네일</label>
              <input type="file" accept="image/*" onChange={pickThumbnail} disabled={busy} />
              {thumbnailPreview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumbnailPreview} alt="" className="order-item-issue-photo" style={{ marginTop: 8 }} />
              )}
            </div>
            <div className="field-group">
              <label>상품 갤러리</label>
              <input type="file" accept="image/*" multiple onChange={pickGallery} disabled={busy} />
              {gallery.length > 0 && (
                <div className="order-item-issue-preview-row">
                  {gallery.map((g) => (
                    <div key={g.path} style={{ position: 'relative' }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={g.url} alt="" className="order-item-issue-photo" />
                      <button type="button" className="cart-x" style={{ position: 'absolute', top: -6, right: -6 }}
                        onClick={() => removeGalleryImage(g.path)} aria-label="삭제">×</button>
                    </div>
                  ))}
                </div>
              )}
              {uploading && <p className="hint">업로드 중…</p>}
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
              <button className="btn-ghost" onClick={closeDrawer} disabled={busy}>취소</button>
              <button className="btn-primary" onClick={submit} disabled={busy}>{pending ? '저장 중…' : uploading ? '업로드 중…' : '저장'}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
