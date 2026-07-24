import { LayoutComponent } from '@postmill-ai/frontend/components/new-layout/layout.component';

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <LayoutComponent>{children}</LayoutComponent>;
}
