import { notFound } from 'next/navigation';
import { getProduct, listInventoryItemsForProduct } from '@/lib/product-actions';
import AdminProductDetail from '@/components/AdminProductDetail';

export const dynamic = 'force-dynamic';

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await getProduct(id);
  if (!product) notFound();
  const items = await listInventoryItemsForProduct(id);
  return <AdminProductDetail product={product} items={items} />;
}
