'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { PublicDesignPreview } from '@postmill-ai/frontend/components/media-tools/designer/design-preview-view';

export default function PublicDesignSharePage() {
  const { token } = useParams<{ token: string }>();
  return <PublicDesignPreview token={token} />;
}
