'use client';

import dynamic from 'next/dynamic';

const StockPhotos = dynamic(
  () =>
    import('@postmill-ai/frontend/components/media-tools/stock-photos').then(
      (m) => m.StockPhotos
    ),
  { ssr: false }
);

export default function StockPhotosPage() {
  return <StockPhotos />;
}
