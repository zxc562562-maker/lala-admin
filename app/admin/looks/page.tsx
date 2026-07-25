import { listLooks, listProductOptions } from '@/lib/look-actions';
import AdminLooks from '@/components/AdminLooks';

export const dynamic = 'force-dynamic';

export default async function LooksPage() {
  const [looks, productOptions] = await Promise.all([listLooks(), listProductOptions()]);
  return <AdminLooks looks={looks} productOptions={productOptions} />;
}
