'use client';

import dynamic from 'next/dynamic';

const TavusStudio = dynamic(
  () => import('@gitroom/frontend/components/media-tools/tavus/tavus-studio').then((m) => m.TavusStudio),
  { ssr: false }
);

export default function TavusPage() {
  return <TavusStudio />;
}
