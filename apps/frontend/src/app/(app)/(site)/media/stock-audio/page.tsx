'use client';

import dynamic from 'next/dynamic';

const StockAudio = dynamic(
  () =>
    import('@gitroom/frontend/components/media-tools/stock-audio').then(
      (m) => m.StockAudio
    ),
  { ssr: false }
);

export default function StockAudioPage() {
  return <StockAudio />;
}
