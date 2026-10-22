'use client';

import dynamic from 'next/dynamic';

const KlingAiStudio = dynamic(
  () => import('@postmill-ai/frontend/components/media-tools/kling-ai/kling-ai-studio').then((m) => m.KlingAiStudio),
  { ssr: false }
);

export default function KlingAiPage() {
  return <KlingAiStudio />;
}
