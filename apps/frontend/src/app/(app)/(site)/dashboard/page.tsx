import { Metadata } from 'next';
import { DashboardComponent } from '@gitroom/frontend/components/dashboard/dashboard.component';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Postmill Dashboard',
};

export default function DashboardPage() {
  return <DashboardComponent />;
}
