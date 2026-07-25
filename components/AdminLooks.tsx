'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@lala/shared/lib/supabase/client';
import {
  createLook, updateLook, deleteLook, getLook, createLookImageUploadTicket,
  type LookListRow, type LookItemOption, type LookDetail,
} from '@/lib/look-actions';

const MAX_GALLERY_IMAGES = 6;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const LOOK_IMAGE_BUCKET = 'look-images';

/** 서버에서 서명 업로드 티켓을 받아 브라우저에서 Supabase Storage로 바로 올린다(서버 경유 없음). */
async function uploadDirect(file: File): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  if (!file.type.startsWith('image/')) return { ok: false, reason: '이미지 파일만 업로드할 수 있어요.' };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, reason: '파일 크기는 4MB 이하로 올려주세요.' };
  const ticket = await createLookImageUploadTicket(file.type);
  if (!ticket.ok) return ticket;
  const sb = supabaseBrowser();
  const { error } = await sb.storage.from(LOOK_IMAGE_BUCKET).uploadToSignedUrl(ticket.path, ticket.token, file);
  if (error) return { ok: false, reason: '이미지 업로드에 실패했어요.' };
  return { ok: true, path: ticket.path };
}

interface GalleryImage { path: string; url: string }

interface FormState {
  title: string;
  cat: string;
  description: string;
  itemProductIds: string[];
  coverPath: string | null;
  coverPreview: string | null;
  gallery: GalleryImage[];
}

const EMPTY_FORM: FormState = {
  title: '', cat: '', description: '', itemProductIds: [], coverPath: null, coverPreview: null, gallery: [],
};

export default function AdminLooks({ looks, productOptions }: { looks: LookListRow[]; productOptions: LookItemOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [productQuery, setProductQuery] = useState('');

  useEffect(() => {
    const sb = supabaseBrowser();
    const ch = sb
      .channel('admin-looks')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'look' }, () => router.refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'look_item' }, () => router.refresh())
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [router]);

  const busy = pending || uploading;

  const filteredProducts = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    if (!q) return productOptions;
    return productOptions.filter((p) => p.name.toLowerCase().includes(q));
  }, [productOptions, productQuery]);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setProductQuery('');
    setDrawerOpen(true);
  }

  function openEdit(id: string) {
    setEditingId(id);
    setFormError(null);
    setProductQuery('');
    setDrawerOpen(true);
    startTransition(async () => {
      const detail: LookDetail | null = await getLook(id);
      if (!detail) { setFormError('룩 정보를 불러오지 못했어요.'); return; }
      setForm({
        title: detail.title, cat: detail.cat, description: detail.description,
        itemProductIds: detail.items.map((i) => i.productId),
        coverPath: detail.coverPath, coverPreview: detail.coverUrl,
        gallery: detail.galleryImages,
      });
    });
  }

  function closeDrawer() {
    if (busy) return;
    setDrawerOpen(false);
  }

  async function pickCover(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setFormError(null);
    const preview = URL.createObjectURL(file);
    const res = await uploadDirect(file);
    setUploading(false);
    if (!res.ok) { setFormError(res.reason); return; }
    setForm((f) => ({ ...f, coverPath: res.path, coverPreview: preview }));
  }

  async function pickGallery(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    const room = MAX_GALLERY_IMAGES - form.gallery.length;
    if (room <= 0) return;
    setUploading(true);
    setFormError(null);
    // 브라우저 → Supabase 직접 업로드라 서버 왕복이 없어 병렬로 올려도 안전함
    const targets = files.slice(0, room);
    const results = await Promise.all(targets.map(async (file) => ({ file, res: await uploadDirect(file) })));
    for (const { file, res } of results) {
      if (!res.ok) { setFormError(res.reason); continue; }
      setForm((f) => ({ ...f, gallery: [...f.gallery, { path: res.path, url: URL.createObjectURL(file) }] }));
    }
    setUploading(false);
  }

  function removeGalleryImage(path: string) {
    setForm((f) => ({ ...f, gallery: f.gallery.filter((g) => g.path !== path) }));
  }

  function toggleProduct(productId: string) {
    setForm((f) => ({
      ...f,
      itemProductIds: f.itemProductIds.includes(productId)
        ? f.itemProductIds.filter((id) => id !== productId)
        : [...f.itemProductIds, productId],
    }));
  }

  function submit() {
    if (!form.title.trim()) { setFormError('제목을 입력해주세요.'); return; }
    setFormError(null);
    const input = {
      title: form.title, cat: form.cat, description: form.description,
      itemProductIds: form.itemProductIds, coverPath: form.coverPath,
      galleryPaths: form.gallery.map((g) => g.path),
    };
    startTransition(async () => {
      const result = editingId ? await updateLook(editingId, input) : await createLook(input);
      if (!result.ok) {
        setFormError(result.reason ?? '저장에 실패했습니다.');
        return;
      }
      setDrawerOpen(false);
      router.refresh();
    });
  }

  function remove(id: string) {
    if (!confirm('이 룩을 삭제할까요? 갤러리 이미지도 함께 삭제됩니다.')) return;
    startTransition(async () => { await deleteLook(id); router.refresh(); });
  }

  return (
    <section>
      <div className="admin-topbar">
        <h1 className="staff-title">룩북 <span className="rt-dot" title="실시간 연결됨">●</span></h1>
        <button className="btn-primary" onClick={openCreate}>+ 룩 등록</button>
      </div>

      {looks.length === 0 ? (
        <p className="staff-empty">등록된 룩이 없습니다.</p>
      ) : (
        <div className="dtable-wrap">
          <table className="dtable dtable-compact">
            <thead>
              <tr><th>커버</th><th>제목</th><th>성격</th><th className="num">구성 상품</th><th></th></tr>
            </thead>
            <tbody>
              {looks.map((l) => (
                <tr key={l.id}>
                  <td>
                    {l.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={l.coverUrl} alt="" className="order-item-thumb" style={{ objectFit: 'cover' }} />
                    ) : (
                      <div className="order-item-thumb" style={{ background: 'linear-gradient(160deg, #6B2737, #3B2230)' }} />
                    )}
                  </td>
                  <td className="prod-name">{l.title}</td>
                  <td>{l.cat}</td>
                  <td className="num">{l.itemCount}개</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn-primary" style={{ padding: '7px 14px', marginRight: 6 }} onClick={() => openEdit(l.id)}>수정</button>
                    <button className="btn-ghost" style={{ padding: '7px 14px' }} onClick={() => remove(l.id)}>삭제</button>
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
            <h2>{editingId ? '룩 수정' : '룩 등록'}</h2>
            <div className="field-group">
              <label>제목</label>
              <input className="field" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="field-group">
              <label>성격 (예: 이브닝, 데일리, 로맨틱)</label>
              <input className="field" value={form.cat} onChange={(e) => setForm({ ...form, cat: e.target.value })} />
            </div>
            <div className="field-group">
              <label>설명</label>
              <textarea
                className="pf-input pf-edit"
                style={{ width: '100%', textAlign: 'left', padding: '10px 12px', minHeight: 60, resize: 'vertical' }}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>

            <div className="field-group">
              <label>커버 이미지 (목록 카드용, 4MB 이하)</label>
              <input type="file" accept="image/*" onChange={pickCover} disabled={busy} />
              {form.coverPreview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.coverPreview} alt="" className="order-item-issue-photo" style={{ marginTop: 8 }} />
              )}
            </div>

            <div className="field-group">
              <label>갤러리 이미지 (상세 페이지용, 최대 {MAX_GALLERY_IMAGES}장, 장당 4MB 이하 — 지금 {form.gallery.length}장)</label>
              <input type="file" accept="image/*" multiple onChange={pickGallery} disabled={busy || form.gallery.length >= MAX_GALLERY_IMAGES} />
              {form.gallery.length > 0 && (
                <div className="order-item-issue-preview-row">
                  {form.gallery.map((g) => (
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

            <div className="field-group">
              <label>구성 상품 ({form.itemProductIds.length}개 선택됨)</label>
              <input className="field" placeholder="상품명 검색" value={productQuery} onChange={(e) => setProductQuery(e.target.value)} />
              <div style={{ maxHeight: 180, overflowY: 'auto', marginTop: 6, border: '1px solid var(--line)', borderRadius: 8, padding: 6 }}>
                {filteredProducts.map((p) => (
                  <label key={p.productId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', fontSize: 12.5, cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.itemProductIds.includes(p.productId)} onChange={() => toggleProduct(p.productId)} />
                    {p.name} <span style={{ color: 'var(--muted)' }}>· {p.category} · {p.size}</span>
                  </label>
                ))}
                {filteredProducts.length === 0 && <p className="staff-empty" style={{ padding: 8 }}>검색 결과가 없어요.</p>}
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
