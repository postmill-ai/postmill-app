'use client';

import dynamic from 'next/dynamic';

const ElevenLabsStudio = dynamic(
  () =>
    import('@gitroom/frontend/components/media-tools/elevenlabs/elevenlabs-studio').then(
      (m) => m.ElevenLabsStudio
    ),
  { ssr: false }
);

export default function ElevenLabsPage() {
  return <ElevenLabsStudio />;
}
