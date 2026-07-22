import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAccess } from '@lala/shared/lib/roles';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const serviceUrl = process.env.NEXT_PUBLIC_SERVICE_URL!;
  const adminUrl = process.env.NEXT_PUBLIC_ADMIN_URL!;
  const me = await getAccess();
  if (!me) redirect(`${serviceUrl}/login?next=${encodeURIComponent(`${adminUrl}/admin`)}`);
  if (!me.isApprover) redirect(serviceUrl);
  return (
    <>
      <header className="staff-header">
        <div className="wrap header-inner">
          <span className="staff-brand">Lala · 관리자</span>
          <nav className="staff-nav">
            <Link href="/admin">주문</Link>
            <Link href="/admin/approvals">승인</Link>
            <Link href="/admin/marketing">마케팅</Link>
            <Link href="/admin/address-log">배송정보 변경</Link>
            <Link href="/admin/closures">휴무일</Link>
            <Link href={`${serviceUrl}/looks`}>고객앱</Link>
          </nav>
        </div>
      </header>
      <main className="wrap">{children}</main>
    </>
  );
}
