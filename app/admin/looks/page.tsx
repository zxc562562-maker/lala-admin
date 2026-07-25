import { listLooks } from '@/lib/look-actions';
import AdminLooks from '@/components/AdminLooks';

export const dynamic = 'force-dynamic';

export default async function LooksPage() {
  const looks = await listLooks();
  return <AdminLooks looks={looks} />;
}
