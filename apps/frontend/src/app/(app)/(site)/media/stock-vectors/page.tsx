'use client';

import dynamic from 'next/dynamic';

const StockVectors = dynamic(
  () =>
    import('@postmill-ai/frontend/components/media-tools/stock-vectors').then(
      (m) => m.StockVectors
    ),
  { ssr: false }
);

export default function StockVectorsPage() {
  return <StockVectors />;
}
