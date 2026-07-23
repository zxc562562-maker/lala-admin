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
          <span className="admin-nav-section">주문</span>
          <Link href="/admin">주문 현황</Link>

          <span className="admin-nav-section">상품</span>
          <Link href="/admin/products">상품관리</Link>
          <Link href="/admin/inventory">재고관리</Link>

          <span className="admin-nav-section">회원</span>
          <Link href="/admin/customers">고객 관리</Link>
          <Link href="/admin/address-log">배송정보 변경</Link>
          <Link href="/admin/approvals">가입 승인</Link>

          <span className="admin-nav-section">운영</span>
          <Link href="/admin/closures">휴일 설정</Link>
          <Link href="/admin/marketing">앱푸시 관리</Link>

          <span className="admin-nav-section">관리</span>
          <Link href="/admin/stats">대시보드</Link>
          <Link href="/admin/staff">직원관리</Link>

          <div className="admin-nav-divider" />
          <Link href={`${serviceUrl}/looks`}>고객앱</Link>
        </nav>
      </aside>
      <main className="admin-main">{children}</main>
    </div>
  );
}
