import { getAccess } from '@lala/shared/lib/roles';
import { listStaff } from '@/lib/staff-admin-actions';
import AdminStaff from '@/components/AdminStaff';

export const dynamic = 'force-dynamic';

export default async function StaffPage() {
  const [me, staff] = await Promise.all([getAccess(), listStaff()]);
  return <AdminStaff staff={staff} currentUserId={me?.userId ?? null} />;
}
