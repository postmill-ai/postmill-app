'use client';

import dynamic from 'next/dynamic';

const BlackForestLabsStudio = dynamic(
  () =>
    import('@gitroom/frontend/components/media-tools/black-forest-labs/black-forest-labs-studio').then(
      (m) => m.BlackForestLabsStudio
    ),
  { ssr: false }
);

export default function BlackForestLabsPage() {
  return <BlackForestLabsStudio />;
}
