'use client';

import dynamic from 'next/dynamic';

const StabilityStudio = dynamic(
  () =>
    import('@gitroom/frontend/components/media-tools/stability-ai/stability-studio').then(
      (m) => m.StabilityStudio
    ),
  { ssr: false }
);

export default function StabilityPage() {
  return <StabilityStudio />;
}
