import { listCustomers } from '@/lib/customer-actions';
import AdminCustomers from '@/components/AdminCustomers';

export const dynamic = 'force-dynamic';

export default async function CustomersPage() {
  const customers = await listCustomers();
  return <AdminCustomers customers={customers} />;
}
