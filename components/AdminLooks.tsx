'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@lala/shared/lib/supabase/client';
import { STYLE_OPTIONS, type Style } from '@lala/shared/lib/style';
import {
  createLook, updateLook, deleteLook, getLook, createLookImageUploadTicket,
  type LookListRow, type LookItemOption, type LookDetail,
} from '@/lib/look-actions';
import { createProductImageUploadTicket, updateProductPhotos, getProductPhotos } from '@/lib/product-actions';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const LOOK_IMAGE_BUCKET = 'look-images';
const PRODUCT_IMAGE_BUCKET = 'product-images';
// service 앱에서 이미지가 전부 같은 비율로 깔끔하게 정렬되도록, 화면에 실제로 쓰이는 4:5(1080x1350)
// 크기로 고정한다 — 원본 비율이 다르면 가운데를 기준으로 크롭해서 맞춘다.
const TARGET_WIDTH = 1080;
const TARGET_HEIGHT = 1350;
const RESIZE_QUALITY = 0.82;

/**
 * 휴대폰 원본 사진(3~8MB대)을 그대로 올리면 사용자 업로드 대역폭에 그대로 발목잡혀 느리다 —
 * 항상 1080x1350(4:5)으로 가운데 크롭·리사이즈하고 JPEG로 압축해서 보통 수백 KB로 만든다.
 * 리사이즈에 실패하면(예: 지원 안 되는 형식) 원본을 그대로 쓴다.
 */
async function resizeForUpload(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const targetRatio = TARGET_WIDTH / TARGET_HEIGHT;
    const srcRatio = bitmap.width / bitmap.height;
    let sx = 0, sy = 0, sw = bitmap.width, sh = bitmap.height;
    if (srcRatio > targetRatio) {
      // 원본이 더 넓다 — 좌우를 잘라 세로 기준으로 맞춘다
      sw = bitmap.height * targetRatio;
      sx = (bitmap.width - sw) / 2;
    } else if (srcRatio < targetRatio) {
      // 원본이 더 좁다 — 위아래를 잘라 가로 기준으로 맞춘다
      sh = bitmap.width / targetRatio;
      sy = (bitmap.height - sh) / 2;
    }
    const canvas = document.createElement('canvas');
    canvas.width = TARGET_WIDTH;
    canvas.height = TARGET_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, TARGET_WIDTH, TARGET_HEIGHT);
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', RESIZE_QUALITY));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

type UploadTicketFn = (contentType: string) => Promise<{ ok: true; path: string; token: string } | { ok: false; reason: string }>;

/** 리사이즈 후 서버에서 서명 업로드 티켓을 받아 브라우저에서 Supabase Storage로 바로 올린다(서버 경유 없음). */
async function uploadDirect(
  rawFile: File, bucket: string, createTicket: UploadTicketFn,
): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  if (!rawFile.type.startsWith('image/')) return { ok: false, reason: '이미지 파일만 업로드할 수 있어요.' };
  const file = await resizeForUpload(rawFile);
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, reason: '파일 크기는 10MB 이하로 올려주세요.' };
  const ticket = await createTicket(file.type);
  if (!ticket.ok) return ticket;
  const sb = supabaseBrowser();
  const { error } = await sb.storage.from(bucket).uploadToSignedUrl(ticket.path, ticket.token, file);
  if (error) return { ok: false, reason: '이미지 업로드에 실패했어요.' };
  return { ok: true, path: ticket.path };
}
const uploadLookImageDirect = (f: File) => uploadDirect(f, LOOK_IMAGE_BUCKET, createLookImageUploadTicket);
const uploadProductImageDirect = (f: File) => uploadDirect(f, PRODUCT_IMAGE_BUCKET, createProductImageUploadTicket);

interface GalleryImage { path: string; url: string }

interface ProductPhotoEntry {
  productId: string;
  thumbnailPath: string | null;
  thumbnailPreview: string | null;
  gallery: GalleryImage[];
}
const EMPTY_PRODUCT_ENTRY: ProductPhotoEntry = { productId: '', thumbnailPath: null, thumbnailPreview: null, gallery: [] };

interface FormState {
  styles: Style[];
  coverPath: string | null;
  coverPreview: string | null;
  gallery: GalleryImage[];
  productPhotos: ProductPhotoEntry[];
}

const EMPTY_FORM: FormState = {
  styles: [], coverPath: null, coverPreview: null, gallery: [], productPhotos: [],
};

export default function AdminLooks({ looks, productOptions }: { looks: LookListRow[]; productOptions: LookItemOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const sb = supabaseBrowser();
    const ch = sb
      .channel('admin-looks')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'look' }, () => router.refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'look_style' }, () => router.refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'look_item' }, () => router.refresh())
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [router]);

  const busy = pending || uploading;

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setDrawerOpen(true);
  }

  function openEdit(id: string) {
    setEditingId(id);
    setFormError(null);
    setDrawerOpen(true);
    startTransition(async () => {
      const detail: LookDetail | null = await getLook(id);
      if (!detail) { setFormError('룩북 정보를 불러오지 못했어요.'); return; }
      const productPhotos = await Promise.all(detail.items.map(async (item): Promise<ProductPhotoEntry> => {
        const photos = await getProductPhotos(item.productId);
        return {
          productId: item.productId,
          thumbnailPath: photos.imagePath, thumbnailPreview: photos.imageUrl,
          gallery: photos.gallery,
        };
      }));
      setForm({
        styles: detail.styles,
        coverPath: detail.coverPath, coverPreview: detail.coverUrl,
        gallery: detail.galleryImages,
        productPhotos,
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
    const res = await uploadLookImageDirect(file);
    setUploading(false);
    if (!res.ok) { setFormError(res.reason); return; }
    setForm((f) => ({ ...f, coverPath: res.path, coverPreview: preview }));
  }

  async function pickGallery(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    setUploading(true);
    setFormError(null);
    // 브라우저 → Supabase 직접 업로드라 서버 왕복이 없어 병렬로 올려도 안전함
    const results = await Promise.all(files.map(async (file) => ({ file, res: await uploadLookImageDirect(file) })));
    for (const { file, res } of results) {
      if (!res.ok) { setFormError(res.reason); continue; }
      setForm((f) => ({ ...f, gallery: [...f.gallery, { path: res.path, url: URL.createObjectURL(file) }] }));
    }
    setUploading(false);
  }

  function removeGalleryImage(path: string) {
    setForm((f) => ({ ...f, gallery: f.gallery.filter((g) => g.path !== path) }));
  }

  function toggleStyle(s: Style) {
    setForm((f) => ({ ...f, styles: f.styles.includes(s) ? f.styles.filter((x) => x !== s) : [...f.styles, s] }));
  }

  function addProductEntry() {
    setForm((f) => ({ ...f, productPhotos: [...f.productPhotos, { ...EMPTY_PRODUCT_ENTRY }] }));
  }

  function removeProductEntry(index: number) {
    setForm((f) => ({ ...f, productPhotos: f.productPhotos.filter((_, i) => i !== index) }));
  }

  function setProductEntryId(index: number, productId: string) {
    setForm((f) => ({ ...f, productPhotos: f.productPhotos.map((p, i) => (i === index ? { ...p, productId } : p)) }));
  }

  async function pickProductThumbnail(index: number, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setFormError(null);
    const preview = URL.createObjectURL(file);
    const res = await uploadProductImageDirect(file);
    setUploading(false);
    if (!res.ok) { setFormError(res.reason); return; }
    setForm((f) => ({
      ...f,
      productPhotos: f.productPhotos.map((p, i) => (i === index ? { ...p, thumbnailPath: res.path, thumbnailPreview: preview } : p)),
    }));
  }

  async function pickProductGallery(index: number, e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    setUploading(true);
    setFormError(null);
    const results = await Promise.all(files.map(async (file) => ({ file, res: await uploadProductImageDirect(file) })));
    for (const { file, res } of results) {
      if (!res.ok) { setFormError(res.reason); continue; }
      setForm((f) => ({
        ...f,
        productPhotos: f.productPhotos.map((p, i) => (i === index ? { ...p, gallery: [...p.gallery, { path: res.path, url: URL.createObjectURL(file) }] } : p)),
      }));
    }
    setUploading(false);
  }

  function removeProductGalleryImage(index: number, path: string) {
    setForm((f) => ({
      ...f,
      productPhotos: f.productPhotos.map((p, i) => (i === index ? { ...p, gallery: p.gallery.filter((g) => g.path !== path) } : p)),
    }));
  }

  function submit() {
    setFormError(null);
    const validProducts = form.productPhotos.filter((p) => p.productId);
    const input = {
      styles: form.styles,
      itemProductIds: validProducts.map((p) => p.productId),
      coverPath: form.coverPath, galleryPaths: form.gallery.map((g) => g.path),
    };
    startTransition(async () => {
      const result = editingId ? await updateLook(editingId, input) : await createLook(input);
      if (!result.ok) {
        setFormError(result.reason ?? '저장에 실패했습니다.');
        return;
      }
      await Promise.all(validProducts.map((p) => updateProductPhotos({
        productId: p.productId, imagePath: p.thumbnailPath, galleryPaths: p.gallery.map((g) => g.path),
      })));
      setDrawerOpen(false);
      router.refresh();
    });
  }

  function remove(id: string) {
    if (!confirm('이 룩북을 삭제할까요? 갤러리 이미지도 함께 삭제됩니다.')) return;
    startTransition(async () => { await deleteLook(id); router.refresh(); });
  }

  return (
    <section>
      <div className="admin-topbar">
        <h1 className="staff-title">룩북 <span className="rt-dot" title="실시간 연결됨">●</span></h1>
        <button className="btn-primary" onClick={openCreate}>+ 룩북 등록</button>
      </div>

      {looks.length === 0 ? (
        <p className="staff-empty">등록된 룩북이 없습니다.</p>
      ) : (
        <div className="dtable-wrap">
          <table className="dtable dtable-compact">
            <thead>
              <tr><th>커버</th><th>스타일</th><th></th></tr>
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
                  <td>{l.styles.join(', ') || '—'}</td>
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
            <h2>{editingId ? '룩북 수정' : '룩북 등록'}</h2>

            <div className="field-group">
              <label>스타일</label>
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
              <label>룩북 썸네일</label>
              <input type="file" accept="image/*" onChange={pickCover} disabled={busy} />
              {form.coverPreview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.coverPreview} alt="" className="order-item-issue-photo" style={{ marginTop: 8 }} />
              )}
            </div>

            <div className="field-group">
              <label>룩북 갤러리</label>
              <input type="file" accept="image/*" multiple onChange={pickGallery} disabled={busy} />
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
            </div>

            <label style={{ display: 'block', marginTop: 18 }}>상품 등록</label>
            {form.productPhotos.map((entry, index) => (
              <div key={index} className="dtable-wrap" style={{ padding: 12, marginTop: 8 }}>
                <div className="field-group">
                  <label>상품</label>
                  <select className="field" value={entry.productId} onChange={(e) => setProductEntryId(index, e.target.value)}>
                    <option value="">상품 선택</option>
                    {productOptions.map((p) => (
                      <option key={p.productId} value={p.productId}>{p.name} · {p.category} · {p.size}</option>
                    ))}
                  </select>
                </div>
                <div className="field-group">
                  <label>상품 썸네일</label>
                  <input type="file" accept="image/*" onChange={(e) => pickProductThumbnail(index, e)} disabled={busy} />
                  {entry.thumbnailPreview && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={entry.thumbnailPreview} alt="" className="order-item-issue-photo" style={{ marginTop: 8 }} />
                  )}
                </div>
                <div className="field-group">
                  <label>상품 갤러리</label>
                  <input type="file" accept="image/*" multiple onChange={(e) => pickProductGallery(index, e)} disabled={busy} />
                  {entry.gallery.length > 0 && (
                    <div className="order-item-issue-preview-row">
                      {entry.gallery.map((g) => (
                        <div key={g.path} style={{ position: 'relative' }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={g.url} alt="" className="order-item-issue-photo" />
                          <button type="button" className="cart-x" style={{ position: 'absolute', top: -6, right: -6 }}
                            onClick={() => removeProductGalleryImage(index, g.path)} aria-label="삭제">×</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button type="button" className="btn-ghost" onClick={() => removeProductEntry(index)}>이 상품 제거</button>
              </div>
            ))}
            <button type="button" className="btn-ghost" style={{ marginTop: 8 }} onClick={addProductEntry}>+ 상품 추가</button>

            {uploading && <p className="hint" style={{ marginTop: 8 }}>업로드 중…</p>}
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
