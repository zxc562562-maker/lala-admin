import { type NextRequest } from 'next/server';
import { updateSession } from '@lala/shared/lib/supabase/middleware';

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // 정적 파일/이미지 제외한 모든 경로에서 세션 갱신
    '/((?!_next/static|_next/image|favicon.ico|api/cron|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
