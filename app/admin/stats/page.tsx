import { getDashboardData } from '@/lib/dashboard-actions';
import AdminDashboard from '@/components/AdminDashboard';

export const dynamic = 'force-dynamic';

export default async function StatsPage() {
  const data = await getDashboardData();
  if (!data) return <p className="staff-empty">데이터를 불러올 수 없습니다.</p>;
  return <AdminDashboard data={data} />;
}
