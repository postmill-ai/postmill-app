'use client';

import dynamic from 'next/dynamic';

const LtxStudio = dynamic(
  () => import('@gitroom/frontend/components/media-tools/ltx/ltx-studio').then((m) => m.LtxStudio),
  { ssr: false }
);

export default function LtxPage() {
  return <LtxStudio />;
}
