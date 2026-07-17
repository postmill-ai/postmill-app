'use client';

import dynamic from 'next/dynamic';

const VertexStudio = dynamic(
  () => import('@gitroom/frontend/components/media-tools/vertex/vertex-studio').then((m) => m.VertexStudio),
  { ssr: false }
);

export default function VertexPage() {
  return <VertexStudio />;
}
