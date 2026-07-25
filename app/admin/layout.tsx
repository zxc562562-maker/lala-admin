import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { getAccess } from '@lala/shared/lib/roles';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const serviceUrl = process.env.NEXT_PUBLIC_SERVICE_URL!;
  const me = await getAccess();
  if (!me) redirect(`/login?next=${encodeURIComponent('/admin')}`);
  if (!me.isApprover) redirect(serviceUrl);
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Image src="/lala-logo.png" alt="Lala" width={120} height={60} className="admin-sidebar-logo" priority />
        <nav className="admin-nav">
          {/* 관리자 메뉴는 필요할 때만 눌러 들어가는 화면들이라, Next.js 기본 동작(뷰포트에 보이는
              링크를 전부 백그라운드에서 미리 불러오는 prefetch)을 꺼둔다 — 안 그러면 사이드바가
              뜰 때마다 대시보드처럼 무거운 페이지까지 조용히 통째로 미리 조회되어 실제 작업(업로드,
              저장)이 쓸 서버·네트워크 자원을 잠식한다. */}
          <span className="admin-nav-section">주문</span>
          <Link href="/admin" prefetch={false}>주문 현황</Link>

          <span className="admin-nav-section">상품</span>
          <Link href="/admin/products" prefetch={false}>상품관리</Link>
          <Link href="/admin/inventory" prefetch={false}>재고관리</Link>
          <Link href="/admin/looks" prefetch={false}>룩북관리</Link>

          <span className="admin-nav-section">회원</span>
          <Link href="/admin/customers" prefetch={false}>고객 관리</Link>
          <Link href="/admin/address-log" prefetch={false}>배송정보 변경</Link>
          <Link href="/admin/approvals" prefetch={false}>가입 승인</Link>

          <span className="admin-nav-section">운영</span>
          <Link href="/admin/closures" prefetch={false}>휴일 설정</Link>
          <Link href="/admin/marketing" prefetch={false}>앱푸시 관리</Link>

          <span className="admin-nav-section">관리</span>
          <Link href="/admin/stats" prefetch={false}>대시보드</Link>
          <Link href="/admin/staff" prefetch={false}>직원관리</Link>

          <div className="admin-nav-divider" />
          <Link href={`${serviceUrl}/looks`} prefetch={false}>고객앱</Link>
        </nav>
      </aside>
      <main className="admin-main">{children}</main>
    </div>
  );
}
