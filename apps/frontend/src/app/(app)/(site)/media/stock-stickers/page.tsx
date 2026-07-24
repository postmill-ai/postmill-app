'use client';

import dynamic from 'next/dynamic';

const StockStickers = dynamic(
  () =>
    import('@postmill-ai/frontend/components/media-tools/stock-stickers').then(
      (m) => m.StockStickers
    ),
  { ssr: false }
);

export default function StockStickersPage() {
  return <StockStickers />;
}
