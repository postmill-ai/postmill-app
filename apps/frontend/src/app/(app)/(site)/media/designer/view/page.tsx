'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { TeamDesignPreview } from '@postmill-ai/frontend/components/media-tools/designer/design-preview-view';

function TeamPreviewRoute() {
  const searchParams = useSearchParams();
  const t = useT();
  const designId = searchParams.get('designId') || undefined;
  if (!designId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-newBgColor p-6 text-dangerText">
        {t('designer_preview_unavailable', 'This design preview is unavailable or has expired.')}
      </div>
    );
  }
  return <TeamDesignPreview designId={designId} />;
}

export default function TeamDesignPreviewPage() {
  return (
    <Suspense fallback={<div className="min-h-[60vh] bg-newBgColor" />}>
      <TeamPreviewRoute />
    </Suspense>
  );
}
