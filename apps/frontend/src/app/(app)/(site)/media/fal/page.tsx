'use client';

import dynamic from 'next/dynamic';

const FalStudio = dynamic(
  () => import('@postmill-ai/frontend/components/media-tools/fal/fal-studio').then((m) => m.FalStudio),
  { ssr: false }
);

export default function FalPage() {
  return <FalStudio />;
}
