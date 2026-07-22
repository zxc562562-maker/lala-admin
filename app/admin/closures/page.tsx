import { listClosuresAdmin } from '@lala/shared/lib/closure-actions';
import AdminClosures from '@/components/AdminClosures';

export const dynamic = 'force-dynamic';

export default async function ClosuresPage() {
  const closures = await listClosuresAdmin();
  return <AdminClosures closures={closures} />;
}
