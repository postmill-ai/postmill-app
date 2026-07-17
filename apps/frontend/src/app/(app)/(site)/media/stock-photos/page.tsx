'use client';

import dynamic from 'next/dynamic';

const StockPhotos = dynamic(
  () =>
    import('@gitroom/frontend/components/media-tools/stock-photos').then(
      (m) => m.StockPhotos
    ),
  { ssr: false }
);

export default function StockPhotosPage() {
  return <StockPhotos />;
}
