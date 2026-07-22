import { listProducts } from '@/lib/product-actions';
import AdminProducts from '@/components/AdminProducts';

export const dynamic = 'force-dynamic';

export default async function ProductsPage() {
  const products = await listProducts();
  return <AdminProducts products={products} />;
}
