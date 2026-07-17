'use client';

import dynamic from 'next/dynamic';

const KlingStudio = dynamic(
  () => import('@gitroom/frontend/components/media-tools/kling/kling-studio').then((m) => m.KlingStudio),
  { ssr: false }
);

export default function KlingPage() {
  return <KlingStudio />;
}
