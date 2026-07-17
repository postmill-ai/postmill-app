'use client';

import dynamic from 'next/dynamic';

const FireworksStudio = dynamic(
  () => import('@gitroom/frontend/components/media-tools/fireworks/fireworks-studio').then((m) => m.FireworksStudio),
  { ssr: false }
);

export default function FireworksPage() {
  return <FireworksStudio />;
}
