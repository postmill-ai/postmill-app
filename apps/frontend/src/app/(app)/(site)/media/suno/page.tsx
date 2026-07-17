'use client';

import dynamic from 'next/dynamic';

const SunoStudio = dynamic(
  () => import('@gitroom/frontend/components/media-tools/suno/suno-studio').then((m) => m.SunoStudio),
  { ssr: false }
);

export default function SunoPage() {
  return <SunoStudio />;
}
