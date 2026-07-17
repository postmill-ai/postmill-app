'use client';

import dynamic from 'next/dynamic';

const SoraStudio = dynamic(
  () => import('@gitroom/frontend/components/media-tools/sora/sora-studio').then((m) => m.SoraStudio),
  { ssr: false }
);

export default function SoraPage() {
  return <SoraStudio />;
}
