import { listInventoryItems } from '@/lib/product-actions';
import AdminInventory from '@/components/AdminInventory';

export const dynamic = 'force-dynamic';

export default async function InventoryPage() {
  const items = await listInventoryItems();
  return <AdminInventory items={items} />;
}
