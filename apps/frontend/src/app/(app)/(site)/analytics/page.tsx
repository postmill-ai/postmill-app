export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { AnalyticsDashboard } from '@gitroom/frontend/components/analytics-v2/analytics.dashboard';

export const metadata: Metadata = {
  title: `Analytics`,
  description: '',
};

export default function AnalyticsPage() {
  return <AnalyticsDashboard />;
}
