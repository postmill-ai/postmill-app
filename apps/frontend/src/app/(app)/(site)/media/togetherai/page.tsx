'use client';

import dynamic from 'next/dynamic';

const TogetherAiStudio = dynamic(
  () => import('@gitroom/frontend/components/media-tools/togetherai/togetherai-studio').then((m) => m.TogetherAiStudio),
  { ssr: false }
);

export default function TogetherAiPage() {
  return <TogetherAiStudio />;
}
