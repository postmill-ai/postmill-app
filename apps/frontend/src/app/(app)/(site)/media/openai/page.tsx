'use client';

import dynamic from 'next/dynamic';

const OpenaiStudio = dynamic(
  () => import('@gitroom/frontend/components/media-tools/openai/openai-studio').then((m) => m.OpenaiStudio),
  { ssr: false }
);

export default function OpenaiPage() {
  return <OpenaiStudio />;
}
