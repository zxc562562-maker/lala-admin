'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@lala/shared/lib/supabase/server';
import { getAccess } from '@lala/shared/lib/roles';
import { getLookImageUrl, LOOK_IMAGE_BUCKET } from '@lala/shared/lib/storage';

const MAX_GALLERY_IMAGES = 6;
// Vercel 서버 액션 요청 하나는 플랫폼 자체에서 약 4.5MB로 제한된다(next.config의 bodySizeLimit로는
// 못 늘림). 커버+갤러리 여러 장을 한 요청에 몰아 올리면 그 합이 쉽게 한도를 넘어 요청이 서버에
// 닿기도 전에 끊겨버려서, 사진은 반드시 한 장씩 개별 요청(uploadLookImage)으로 올리고 이 파일의
// 나머지 함수들은 이미 올라간 경로(문자열)만 주고받는다 — 그래야 사진 개수와 무관하게 매 요청이 작다.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB
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
  coverPath: string | null;
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
    coverPath: look.cover_path,
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

/** 이미지 1장을 올린다 — 반드시 이 단위(한 요청 = 파일 1개)로만 호출할 것(위 주석 참고). */
export async function uploadLookImage(formData: FormData): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  const me = await getAccess();
  if (!me?.isApprover) return { ok: false, reason: '권한이 없습니다.' };

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, reason: '파일을 선택해주세요.' };
  const ext = IMAGE_MIME_EXT[file.type];
  if (!ext) return { ok: false, reason: '이미지 파일만 업로드할 수 있어요.' };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, reason: '파일 크기는 4MB 이하로 올려주세요.' };

  const path = `${crypto.randomUUID()}${ext}`;
  const sb = supabaseAdmin();
  const { error } = await sb.storage.from(LOOK_IMAGE_BUCKET).upload(path, file, { contentType: file.type });
  if (error) return { ok: false, reason: '이미지 업로드에 실패했어요.' };
  return { ok: true, path };
}

export interface LookInput {
  title: string;
  cat: string;
  description: string;
  itemProductIds: string[];
  coverPath: string | null;
  galleryPaths: string[]; // 이미 uploadLookImage로 올려둔 경로들, 노출 순서대로
}

/** 룩 등록 — 이미지는 이미 uploadLookImage로 올라간 경로만 받는다(파일 자체는 안 받음). */
export async function createLook(input: LookInput): Promise<{ ok: boolean; reason?: string; id?: string }> {
  const me = await getAccess();
  if (!me?.isApprover) return { ok: false, reason: '권한이 없습니다.' };
  if (!input.title.trim()) return { ok: false, reason: '제목을 입력해주세요.' };
  if (input.galleryPaths.length > MAX_GALLERY_IMAGES) return { ok: false, reason: `갤러리 이미지는 최대 ${MAX_GALLERY_IMAGES}장까지예요.` };

  const sb = supabaseAdmin();
  const { data: row, error } = await sb.from('look').insert({
    title: input.title.trim(), cat: input.cat.trim(), description: input.description.trim(), cover_path: input.coverPath,
  }).select('id').single();
  if (error || !row) return { ok: false, reason: '저장에 실패했어요.' };

  await Promise.all([
    input.galleryPaths.length > 0
      ? sb.from('look_image').insert(input.galleryPaths.map((path, i) => ({ look_id: row.id, path, position: i })))
      : Promise.resolve(),
    input.itemProductIds.length > 0
      ? sb.from('look_item').insert(input.itemProductIds.map((productId, i) => ({ look_id: row.id, product_id: productId, position: i })))
      : Promise.resolve(),
  ]);

  revalidatePath('/admin/looks');
  return { ok: true, id: row.id };
}

/** 룩 수정 — coverPath/galleryPaths는 최종적으로 남아야 할 상태를 그대로 넘긴다(diff는 서버가 계산). */
export async function updateLook(id: string, input: LookInput): Promise<{ ok: boolean; reason?: string }> {
  const me = await getAccess();
  if (!me?.isApprover) return { ok: false, reason: '권한이 없습니다.' };
  if (!input.title.trim()) return { ok: false, reason: '제목을 입력해주세요.' };
  if (input.galleryPaths.length > MAX_GALLERY_IMAGES) return { ok: false, reason: `갤러리 이미지는 최대 ${MAX_GALLERY_IMAGES}장까지예요.` };

  const sb = supabaseAdmin();
  const { data: current } = await sb.from('look').select('cover_path').eq('id', id).maybeSingle();
  if (!current) return { ok: false, reason: '룩을 찾을 수 없어요.' };

  if (current.cover_path && current.cover_path !== input.coverPath) {
    await sb.storage.from(LOOK_IMAGE_BUCKET).remove([current.cover_path]);
  }

  const { error } = await sb.from('look').update({
    title: input.title.trim(), cat: input.cat.trim(), description: input.description.trim(), cover_path: input.coverPath,
  }).eq('id', id);
  if (error) return { ok: false, reason: '저장에 실패했어요.' };

  const { data: existingImages } = await sb.from('look_image').select('path').eq('look_id', id);
  const removedPaths = (existingImages ?? []).map((i: { path: string }) => i.path).filter((p) => !input.galleryPaths.includes(p));
  if (removedPaths.length > 0) await sb.storage.from(LOOK_IMAGE_BUCKET).remove(removedPaths);

  await sb.from('look_image').delete().eq('look_id', id);
  if (input.galleryPaths.length > 0) {
    await sb.from('look_image').insert(input.galleryPaths.map((path, i) => ({ look_id: id, path, position: i })));
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
