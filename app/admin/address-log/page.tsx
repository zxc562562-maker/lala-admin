import { listAddressChanges } from '@lala/shared/lib/staff-actions';
import AdminAddressLog from '@/components/AdminAddressLog';

export const dynamic = 'force-dynamic';

export default async function AddressLogPage() {
  const initial = await listAddressChanges();
  return <AdminAddressLog initial={initial} />;
}
