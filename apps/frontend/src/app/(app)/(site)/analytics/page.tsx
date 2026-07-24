export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { AnalyticsDashboard } from '@postmill-ai/frontend/components/analytics-v2/analytics.dashboard';

export const metadata: Metadata = {
  title: `Analytics`,
  description: '',
};

export default function AnalyticsPage() {
  return <AnalyticsDashboard />;
}
