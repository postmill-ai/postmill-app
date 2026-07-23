import { ReactNode } from 'react';
import { AppLayout } from '@postmill-ai/frontend/components/launches/layout.standalone';
export default async function AppLayoutIn({
  children,
}: {
  children: ReactNode;
}) {
  return <AppLayout>{children}</AppLayout>;
}
