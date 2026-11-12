'use client';

import { BrandEditLayout } from '@postmill-ai/frontend/components/settings/brand/brand-edit-layout';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-[20px] mobile:p-[16px]">
      <BrandEditLayout>{children}</BrandEditLayout>
    </div>
  );
}
