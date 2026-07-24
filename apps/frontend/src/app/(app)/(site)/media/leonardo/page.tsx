'use client';

import dynamic from 'next/dynamic';

const LeonardoStudio = dynamic(
  () => import('@postmill-ai/frontend/components/media-tools/leonardo/leonardo-studio').then((m) => m.LeonardoStudio),
  { ssr: false }
);

export default function LeonardoPage() {
  return <LeonardoStudio />;
}
