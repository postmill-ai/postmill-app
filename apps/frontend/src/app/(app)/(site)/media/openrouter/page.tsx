'use client';

import dynamic from 'next/dynamic';

const OpenRouterStudio = dynamic(
  () => import('@gitroom/frontend/components/media-tools/openrouter/openrouter-studio').then((m) => m.OpenRouterStudio),
  { ssr: false }
);

export default function OpenRouterPage() {
  return <OpenRouterStudio />;
}
