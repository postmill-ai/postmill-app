'use client';

import dynamic from 'next/dynamic';

const HiggsfieldStudio = dynamic(
  () => import('@postmill-ai/frontend/components/media-tools/higgsfield/higgsfield-studio').then((m) => m.HiggsfieldStudio),
  { ssr: false }
);

export default function HiggsfieldPage() {
  return <HiggsfieldStudio />;
}
