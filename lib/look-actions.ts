'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@lala/shared/lib/supabase/server';
import { getAccess } from '@lala/shared/lib/roles';
import { getLookImageUrl, LOOK_IMAGE_BUCKET } from '@lala/shared/lib/storage';

const MAX_GALLERY_IMAGES = 6;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB
const IMAGE_MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
};

export interface LookListRow {
  id: string;
  title: string;
  cat: string;
  coverUrl: string | null;
  itemCount: number;
}

export interface LookItemOption { productId: string; name: string; category: string; size: string }

export interface LookDetail {
  id: string;
  title: string;
  cat: string;
  description: string;
  coverUrl: string | null;
  galleryImages: { path: string; url: string }[];
  items: LookItemOption[];
}

export async function listLooks(): Promise<LookListRow[]> {
  const me = await getAccess();
  if (!me?.isApprover) return [];
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from('look')
    .select('id,title,cat,cover_path,look_item(product_id)')
    .order('position', { ascending: true });
  if (error || !data) return [];
  return (data as unknown as { id: string; title: string; cat: string; cover_path: string | null; look_item: { product_id: string }[] }[]).map((r) => ({
    id: r.id, title: r.title, cat: r.cat,
    coverUrl: getLookImageUrl(r.cover_path),
    itemCount: r.look_item?.length ?? 0,
  }));
}

export async function getLook(id: string): Promise<LookDetail | null> {
  const me = await getAccess();
  if (!me?.isApprover) return null;
  const sb = supabaseAdmin();

  const { data: look, error } = await sb.from('look').select('id,title,cat,description,cover_path').eq('id', id).maybeSingle();
  if (error || !look) return null;

  const [{ data: images }, { data: items }] = await Promise.all([
    sb.from('look_image').select('path').eq('look_id', id).order('position', { ascending: true }),
    sb.from('look_item').select('position,product:product_id(id,name,category,size)').eq('look_id', id).order('position', { ascending: true }),
  ]);

  return {
    id: look.id, title: look.title, cat: look.cat, description: look.description,
    coverUrl: getLookImageUrl(look.cover_path),
    galleryImages: (images ?? []).map((i: { path: string }) => ({ path: i.path, url: getLookImageUrl(i.path)! })),
    items: ((items ?? []) as unknown as { product: { id: string; name: string; category: string; size: string } | null }[])
      .filter((i) => i.product)
      .map((i) => ({ productId: i.product!.id, name: i.product!.name, category: i.product!.category, size: i.product!.size })),
  };
}

/** 상품 선택기용 — 전체 상품을 이름순으로. */
export async function listProductOptions(): Promise<LookItemOption[]> {
  const me = await getAccess();
  if (!me?.isApprover) return [];
  const sb = supabaseAdmin();
  const { data } = await sb.from('product').select('id,name,category,size').order('name', { ascending: true });
  return (data ?? []).map((p: { id: string; name: string; category: string; size: string }) => ({
    productId: p.id, name: p.name, category: p.category, size: p.size,
  }));
}

function extFor(file: File): string | null { return IMAGE_MIME_EXT[file.type] ?? null; }

async function uploadLookImage(sb: ReturnType<typeof supabaseAdmin>, file: File): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  const ext = extFor(file);
  if (!ext) return { ok: false, reason: '이미지 파일만 업로드할 수 있어요.' };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, reason: '파일 크기는 8MB 이하로 올려주세요.' };
  const path = `${crypto.randomUUID()}${ext}`;
  const { error } = await sb.storage.from(LOOK_IMAGE_BUCKET).upload(path, file, { contentType: file.type });
  if (error) return { ok: false, reason: '이미지 업로드에 실패했어요.' };
  return { ok: true, path };
}

export interface LookInput { title: string; cat: string; description: string; itemProductIds: string[] }

/** formData에서 File이 아닌 공용 필드(title/cat/description/itemProductIds)를 뽑아낸다. */
function readLookInput(formData: FormData): LookInput {
  return {
    title: String(formData.get('title') ?? ''),
    cat: String(formData.get('cat') ?? ''),
    description: String(formData.get('description') ?? ''),
    itemProductIds: JSON.parse(String(formData.get('itemProductIds') ?? '[]')),
  };
}

/** 룩 등록 — 커버(선택, 'cover' 필드) + 갤러리(최대 6장, 선택, 'gallery' 필드) + 구성 상품을 한 번에 저장. */
export async function createLook(formData: FormData): Promise<{ ok: boolean; reason?: string; id?: string }> {
  const me = await getAccess();
  if (!me?.isApprover) return { ok: false, reason: '권한이 없습니다.' };
  const input = readLookInput(formData);
  if (!input.title.trim()) return { ok: false, reason: '제목을 입력해주세요.' };
  const coverEntry = formData.get('cover');
  const coverFile = coverEntry instanceof File && coverEntry.size > 0 ? coverEntry : null;
  const galleryFiles = formData.getAll('gallery').filter((f): f is File => f instanceof File && f.size > 0);
  if (galleryFiles.length > MAX_GALLERY_IMAGES) return { ok: false, reason: `갤러리 이미지는 최대 ${MAX_GALLERY_IMAGES}장까지예요.` };

  const sb = supabaseAdmin();

  let coverPath: string | null = null;
  if (coverFile) {
    const up = await uploadLookImage(sb, coverFile);
    if (!up.ok) return { ok: false, reason: up.reason };
    coverPath = up.path;
  }
  const galleryUploads = await Promise.all(galleryFiles.map((f) => uploadLookImage(sb, f)));
  const failedGallery = galleryUploads.find((u) => !u.ok);
  if (failedGallery) return { ok: false, reason: (failedGallery as { ok: false; reason: string }).reason };

  const { data: row, error } = await sb.from('look').insert({
    title: input.title.trim(), cat: input.cat.trim(), description: input.description.trim(), cover_path: coverPath,
  }).select('id').single();
  if (error || !row) return { ok: false, reason: '저장에 실패했어요.' };

  const galleryPaths = galleryUploads.map((u) => (u as { ok: true; path: string }).path);
  await Promise.all([
    galleryPaths.length > 0
      ? sb.from('look_image').insert(galleryPaths.map((path, i) => ({ look_id: row.id, path, position: i })))
      : Promise.resolve(),
    input.itemProductIds.length > 0
      ? sb.from('look_item').insert(input.itemProductIds.map((productId, i) => ({ look_id: row.id, product_id: productId, position: i })))
      : Promise.resolve(),
  ]);

  revalidatePath('/admin/looks');
  return { ok: true, id: row.id };
}

/**
 * 룩 수정 — 기본 정보 갱신, 커버는 새로 올렸을 때만 교체, 갤러리는 keepPaths에 없는 기존 이미지를
 * 지우고 새로 올린 파일을 뒤에 이어 붙이며, 구성 상품 목록은 통째로 교체한다.
 */
export async function updateLook(id: string, formData: FormData): Promise<{ ok: boolean; reason?: string }> {
  const me = await getAccess();
  if (!me?.isApprover) return { ok: false, reason: '권한이 없습니다.' };
  const input = readLookInput(formData);
  if (!input.title.trim()) return { ok: false, reason: '제목을 입력해주세요.' };
  const coverEntry = formData.get('cover');
  const coverFile = coverEntry instanceof File && coverEntry.size > 0 ? coverEntry : null;
  const keepGalleryPaths: string[] = JSON.parse(String(formData.get('keepGalleryPaths') ?? '[]'));
  const newGalleryFiles = formData.getAll('gallery').filter((f): f is File => f instanceof File && f.size > 0);
  if (keepGalleryPaths.length + newGalleryFiles.length > MAX_GALLERY_IMAGES) {
    return { ok: false, reason: `갤러리 이미지는 최대 ${MAX_GALLERY_IMAGES}장까지예요.` };
  }

  const sb = supabaseAdmin();
  const { data: current } = await sb.from('look').select('cover_path').eq('id', id).maybeSingle();
  if (!current) return { ok: false, reason: '룩을 찾을 수 없어요.' };

  let coverPath = current.cover_path;
  if (coverFile) {
    const up = await uploadLookImage(sb, coverFile);
    if (!up.ok) return { ok: false, reason: up.reason };
    if (current.cover_path) await sb.storage.from(LOOK_IMAGE_BUCKET).remove([current.cover_path]);
    coverPath = up.path;
  }

  const newGalleryUploads = await Promise.all(newGalleryFiles.map((f) => uploadLookImage(sb, f)));
  const failedGallery = newGalleryUploads.find((u) => !u.ok);
  if (failedGallery) return { ok: false, reason: (failedGallery as { ok: false; reason: string }).reason };

  const { error } = await sb.from('look').update({
    title: input.title.trim(), cat: input.cat.trim(), description: input.description.trim(), cover_path: coverPath,
  }).eq('id', id);
  if (error) return { ok: false, reason: '저장에 실패했어요.' };

  const { data: existingImages } = await sb.from('look_image').select('path').eq('look_id', id);
  const removedPaths = (existingImages ?? []).map((i: { path: string }) => i.path).filter((p) => !keepGalleryPaths.includes(p));
  if (removedPaths.length > 0) {
    await sb.storage.from(LOOK_IMAGE_BUCKET).remove(removedPaths);
    await sb.from('look_image').delete().eq('look_id', id).in('path', removedPaths);
  }
  const newPaths = newGalleryUploads.map((u) => (u as { ok: true; path: string }).path);
  if (newPaths.length > 0) {
    const startPos = keepGalleryPaths.length;
    await sb.from('look_image').insert(newPaths.map((path, i) => ({ look_id: id, path, position: startPos + i })));
  }

  await sb.from('look_item').delete().eq('look_id', id);
  if (input.itemProductIds.length > 0) {
    await sb.from('look_item').insert(input.itemProductIds.map((productId, i) => ({ look_id: id, product_id: productId, position: i })));
  }

  revalidatePath('/admin/looks');
  return { ok: true };
}

export async function deleteLook(id: string): Promise<{ ok: boolean }> {
  const me = await getAccess();
  if (!me?.isApprover) return { ok: false };
  const sb = supabaseAdmin();

  const [{ data: look }, { data: images }] = await Promise.all([
    sb.from('look').select('cover_path').eq('id', id).maybeSingle(),
    sb.from('look_image').select('path').eq('look_id', id),
  ]);
  const paths = [...(images ?? []).map((i: { path: string }) => i.path), ...(look?.cover_path ? [look.cover_path] : [])];
  if (paths.length > 0) await sb.storage.from(LOOK_IMAGE_BUCKET).remove(paths);

  const { error } = await sb.from('look').delete().eq('id', id);
  if (error) return { ok: false };
  revalidatePath('/admin/looks');
  return { ok: true };
}
