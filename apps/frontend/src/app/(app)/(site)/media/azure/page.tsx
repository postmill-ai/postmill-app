'use client';

import dynamic from 'next/dynamic';

const AzureStudio = dynamic(
  () => import('@postmill-ai/frontend/components/media-tools/azure/azure-studio').then((m) => m.AzureStudio),
  { ssr: false }
);

export default function AzurePage() {
  return <AzureStudio />;
}
