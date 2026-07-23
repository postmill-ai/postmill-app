'use client';

import dynamic from 'next/dynamic';

const RunwayStudio = dynamic(
  () => import('@postmill-ai/frontend/components/media-tools/runway/runway-studio').then((m) => m.RunwayStudio),
  { ssr: false }
);

export default function RunwayPage() {
  return <RunwayStudio />;
}
