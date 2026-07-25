import { supabaseBrowser } from '@lala/shared/lib/supabase/client';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// 카탈로그 화면용이라 원본 해상도가 필요 없음 — 화면에 실제로 쓰이는 4:5(1080x1350) 크기로 고정.
const TARGET_WIDTH = 1080;
const TARGET_HEIGHT = 1350;
const RESIZE_QUALITY = 0.82;

/**
 * 휴대폰 원본 사진(3~8MB대)을 그대로 올리면 사용자 업로드 대역폭에 그대로 발목잡혀 느리다 —
 * 항상 1080x1350(4:5)으로 가운데 크롭·리사이즈하고 JPEG로 압축해서 보통 수백 KB로 만든다.
 * 리사이즈에 실패하면(예: 지원 안 되는 형식) 원본을 그대로 쓴다.
 * (룩북/상품 이미지 업로드가 똑같은 로직을 쓰게 되어 공용으로 뺐다.)
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

export type UploadTicketFn = (contentType: string) => Promise<{ ok: true; path: string; token: string } | { ok: false; reason: string }>;

/** 리사이즈 후 서버에서 서명 업로드 티켓을 받아 브라우저에서 Supabase Storage로 바로 올린다(서버 경유 없음). */
export async function uploadImageDirect(
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
