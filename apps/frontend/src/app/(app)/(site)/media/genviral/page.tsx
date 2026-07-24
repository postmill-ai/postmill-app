'use client';

import dynamic from 'next/dynamic';

const GenviralStudio = dynamic(
  () => import('@postmill-ai/frontend/components/media-tools/genviral/genviral-studio').then((m) => m.GenviralStudio),
  { ssr: false }
);

export default function GenviralPage() {
  return <GenviralStudio />;
}
