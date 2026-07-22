import { getMarketingAudienceCounts, listMarketingBroadcasts } from '@/lib/marketing-actions';
import AdminMarketing from '@/components/AdminMarketing';

export const dynamic = 'force-dynamic';

export default async function MarketingPage() {
  const [audience, history] = await Promise.all([getMarketingAudienceCounts(), listMarketingBroadcasts()]);
  return <AdminMarketing audience={audience} history={history} />;
}
