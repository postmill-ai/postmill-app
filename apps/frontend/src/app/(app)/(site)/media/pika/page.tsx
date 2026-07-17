'use client';

import dynamic from 'next/dynamic';

const PikaStudio = dynamic(
  () => import('@gitroom/frontend/components/media-tools/pika/pika-studio').then((m) => m.PikaStudio),
  { ssr: false }
);

export default function PikaPage() {
  return <PikaStudio />;
}
