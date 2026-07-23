'use client';

import dynamic from 'next/dynamic';

const ReplicateStudio = dynamic(
  () =>
    import(
      '@postmill-ai/frontend/components/media-tools/replicate/replicate-studio'
    ).then((m) => m.ReplicateStudio),
  { ssr: false }
);

export default function ReplicatePage() {
  return <ReplicateStudio />;
}
