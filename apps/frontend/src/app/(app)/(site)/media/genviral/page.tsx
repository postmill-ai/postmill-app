'use client';

import dynamic from 'next/dynamic';

const GenviralStudio = dynamic(
  () => import('@gitroom/frontend/components/media-tools/genviral/genviral-studio').then((m) => m.GenviralStudio),
  { ssr: false }
);

export default function GenviralPage() {
  return <GenviralStudio />;
}
