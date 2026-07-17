'use client';

import dynamic from 'next/dynamic';

const HeyGenStudio = dynamic(
  () =>
    import('@gitroom/frontend/components/media-tools/heygen/heygen-studio').then(
      (m) => m.HeyGenStudio
    ),
  { ssr: false }
);

export default function HeyGenPage() {
  return <HeyGenStudio />;
}
