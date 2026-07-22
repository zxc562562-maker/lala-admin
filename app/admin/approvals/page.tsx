import { listPendingMembers } from '@lala/shared/lib/roles-actions';
import AdminApprovals from '@/components/AdminApprovals';

export const dynamic = 'force-dynamic';

export default async function ApprovalsPage() {
  const pending = await listPendingMembers();
  return <AdminApprovals pending={pending} />;
}
