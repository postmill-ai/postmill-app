'use client';

import dynamic from 'next/dynamic';

const ReelFarmStudio = dynamic(
  () => import('@gitroom/frontend/components/media-tools/reelfarm/reelfarm-studio').then((m) => m.ReelFarmStudio),
  { ssr: false }
);

export default function ReelFarmPage() {
  return <ReelFarmStudio />;
}
