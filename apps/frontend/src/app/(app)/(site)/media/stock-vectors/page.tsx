'use client';

import dynamic from 'next/dynamic';

const StockVectors = dynamic(
  () =>
    import('@gitroom/frontend/components/media-tools/stock-vectors').then(
      (m) => m.StockVectors
    ),
  { ssr: false }
);

export default function StockVectorsPage() {
  return <StockVectors />;
}
