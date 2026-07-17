'use client';

import dynamic from 'next/dynamic';

const DeepInfraStudio = dynamic(
  () => import('@gitroom/frontend/components/media-tools/deepinfra/deepinfra-studio').then((m) => m.DeepInfraStudio),
  { ssr: false }
);

export default function DeepInfraPage() {
  return <DeepInfraStudio />;
}
