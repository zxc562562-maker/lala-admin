import { notFound } from 'next/navigation';
import { getCustomerDetail } from '@/lib/customer-actions';
import AdminCustomerDetail from '@/components/AdminCustomerDetail';

export const dynamic = 'force-dynamic';

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getCustomerDetail(id);
  if (!result) notFound();
  return <AdminCustomerDetail customer={result.customer} orders={result.orders} />;
}
