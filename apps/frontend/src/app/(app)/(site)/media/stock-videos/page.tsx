'use client';

import dynamic from 'next/dynamic';

const StockVideos = dynamic(
  () =>
    import('@gitroom/frontend/components/media-tools/stock-videos').then(
      (m) => m.StockVideos
    ),
  { ssr: false }
);

export default function StockVideosPage() {
  return <StockVideos />;
}
