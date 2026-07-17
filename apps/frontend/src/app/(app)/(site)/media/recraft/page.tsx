'use client';

import dynamic from 'next/dynamic';

const RecraftStudio = dynamic(
  () => import('@gitroom/frontend/components/media-tools/recraft/recraft-studio').then((m) => m.RecraftStudio),
  { ssr: false }
);

export default function RecraftPage() {
  return <RecraftStudio />;
}
