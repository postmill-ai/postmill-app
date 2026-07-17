'use client';

import dynamic from 'next/dynamic';

const DIDStudio = dynamic(
  () => import('@gitroom/frontend/components/media-tools/did/did-studio').then((m) => m.DIDStudio),
  { ssr: false }
);

export default function DIDPage() {
  return <DIDStudio />;
}
