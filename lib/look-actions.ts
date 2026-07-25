'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@lala/shared/lib/supabase/server';
import { getAccess } from '@lala/shared/lib/roles';
import { getLookImageUrl, LOOK_IMAGE_BUCKET } from '@lala/shared/lib/storage';
import { STYLE_OPTIONS, type Style } from '@lala/shared/lib/style';

// 이미지는 서버를 거치지 않고 서명 업로드 티켓으로 브라우저에서 Supabase Storage에 바로 올라간다
// (아래 createLookImageUploadTicket) — 그래서 파일 크기·MIME 제한은 여기서 검사할 수 없고,
// look-images 버킷 자체의 file_size_limit/allowed_mime_types로 강제한다.
const IMAGE_MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
};

export interface LookListRow {
  id: string;
  coverUrl: string | null;
  styles: Style[];
}

export interface LookDetail {
  id: string;
  coverPath: string | null;
  coverUrl: string | null;
  galleryImages: { path: string; url: string }[];
  styles: Style[];
}

export async function listLooks(): Promise<LookListRow[]> {
  const me = await getAccess();
  if (!me?.isApprover) return [];
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from('look')
    .select('id,cover_path,look_style(style)')
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return (data as unknown as { id: string; cover_path: string | null; look_style: { style: Style }[] }[]).map((r) => ({
    id: r.id,
    coverUrl: getLookImageUrl(r.cover_path),
    styles: (r.look_style ?? []).map((s) => s.style),
  }));
}

export async function getLook(id: string): Promise<LookDetail | null> {
  const me = await getAccess();
  if (!me?.isApprover) return null;
  const sb = supabaseAdmin();

  const { data: look, error } = await sb.from('look').select('id,cover_path').eq('id', id).maybeSingle();
  if (error || !look) return null;

  const [{ data: images }, { data: styles }] = await Promise.all([
    sb.from('look_image').select('path').eq('look_id', id).order('position', { ascending: true }),
    sb.from('look_style').select('style').eq('look_id', id),
  ]);

  return {
    id: look.id,
    coverPath: look.cover_path,
    coverUrl: getLookImageUrl(look.cover_path),
    galleryImages: (images ?? []).map((i: { path: string }) => ({ path: i.path, url: getLookImageUrl(i.path)! })),
    styles: (styles ?? []).map((s: { style: Style }) => s.style),
  };
}

/** 룩의 스타일 태그를 통째로 교체(현재 목록 삭제 후 선택된 것만 다시 삽입) — product-actions.ts와 동일 패턴. */
async function replaceLookStyles(sb: ReturnType<typeof supabaseAdmin>, lookId: string, styles: Style[]): Promise<void> {
  await sb.from('look_style').delete().eq('look_id', lookId);
  const valid = styles.filter((s) => (STYLE_OPTIONS as readonly string[]).includes(s));
  if (valid.length === 0) return;
  await sb.from('look_style').insert(valid.map((style) => ({ look_id: lookId, style })));
}

/**
 * 이미지를 서버(Vercel 함수)를 거치지 않고 브라우저에서 Supabase Storage로 바로 올리기 위한
 * 서명 업로드 티켓 발급. 파일 자체는 안 받고 "이 경로/이 토큰으로 한 번만 업로드해도 좋다"는
 * 허가만 내준다 — 실제 바이너리는 클라이언트가 signedUrl/token으로 Supabase에 직접 전송한다
 * (브라우저→서버→Supabase 이중 전송을 브라우저→Supabase 단일 전송으로 줄여 업로드 속도 개선).
 */
export async function createLookImageUploadTicket(
  contentType: string,
): Promise<{ ok: true; path: string; token: string } | { ok: false; reason: string }> {
  const me = await getAccess();
  if (!me?.isApprover) return { ok: false, reason: '권한이 없습니다.' };

  const ext = IMAGE_MIME_EXT[contentType];
  if (!ext) return { ok: false, reason: '이미지 파일만 업로드할 수 있어요.' };

  const path = `${crypto.randomUUID()}${ext}`;
  const sb = supabaseAdmin();
  const { data, error } = await sb.storage.from(LOOK_IMAGE_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { ok: false, reason: '업로드 준비에 실패했어요.' };
  return { ok: true, path, token: data.token };
}

export interface LookInput {
  styles: Style[];
  coverPath: string | null;
  galleryPaths: string[]; // 이미 uploadLookImage로 올려둔 경로들, 노출 순서대로
}

/** 룩북 등록 — 이미지는 이미 업로드된 경로만 받는다(파일 자체는 안 받음). 제목/설명/구성 상품 없이 스타일+이미지만. */
export async function createLook(input: LookInput): Promise<{ ok: boolean; reason?: string; id?: string }> {
  const me = await getAccess();
  if (!me?.isApprover) return { ok: false, reason: '권한이 없습니다.' };

  const sb = supabaseAdmin();
  // title/cat/description은 더 이상 폼에서 안 받지만 컬럼이 not null이라 빈 값으로 채운다.
  const { data: row, error } = await sb.from('look').insert({
    title: '', cat: '', description: '', cover_path: input.coverPath,
  }).select('id').single();
  if (error || !row) return { ok: false, reason: '저장에 실패했어요.' };

  await Promise.all([
    input.galleryPaths.length > 0
      ? sb.from('look_image').insert(input.galleryPaths.map((path, i) => ({ look_id: row.id, path, position: i })))
      : Promise.resolve(),
    replaceLookStyles(sb, row.id, input.styles),
  ]);

  revalidatePath('/admin/looks');
  return { ok: true, id: row.id };
}

/** 룩북 수정 — coverPath/galleryPaths는 최종적으로 남아야 할 상태를 그대로 넘긴다(diff는 서버가 계산). */
export async function updateLook(id: string, input: LookInput): Promise<{ ok: boolean; reason?: string }> {
  const me = await getAccess();
  if (!me?.isApprover) return { ok: false, reason: '권한이 없습니다.' };

  const sb = supabaseAdmin();
  const { data: current } = await sb.from('look').select('cover_path').eq('id', id).maybeSingle();
  if (!current) return { ok: false, reason: '룩북을 찾을 수 없어요.' };

  if (current.cover_path && current.cover_path !== input.coverPath) {
    await sb.storage.from(LOOK_IMAGE_BUCKET).remove([current.cover_path]);
  }

  const { error } = await sb.from('look').update({ cover_path: input.coverPath }).eq('id', id);
  if (error) return { ok: false, reason: '저장에 실패했어요.' };

  const { data: existingImages } = await sb.from('look_image').select('path').eq('look_id', id);
  const removedPaths = (existingImages ?? []).map((i: { path: string }) => i.path).filter((p) => !input.galleryPaths.includes(p));
  if (removedPaths.length > 0) await sb.storage.from(LOOK_IMAGE_BUCKET).remove(removedPaths);

  await sb.from('look_image').delete().eq('look_id', id);
  if (input.galleryPaths.length > 0) {
    await sb.from('look_image').insert(input.galleryPaths.map((path, i) => ({ look_id: id, path, position: i })));
  }

  await replaceLookStyles(sb, id, input.styles);

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
