import type { AssetAspect } from '../ai-designer.types';

// Aspect classes for generated assets. The conductor generates ONE asset per
// plan×slot (variant-scoped key `${variantId}:${slotId}:aspect`) in the
// primary output's aspect class; the renderer cover-crops it per format.

// Generation/cap-trimming priority: a square master cover-crops to either
// extreme with the least subject loss, so square is kept first, then wide.
export const ASPECT_PRIORITY: AssetAspect[] = ['square', 'wide', 'tall'];

// square ≈ 1:1 (±0.2), wide > 1.2, tall < 0.8.
export const aspectClass = (width: number, height: number): AssetAspect => {
  const ratio = width / Math.max(1, height);
  if (ratio > 1.2) return 'wide';
  if (ratio < 0.8) return 'tall';
  return 'square';
};

// Assets are keyed `slotId:aspect`; pre-Phase-3 payloads (no aspect) keep the
// plain slotId key so older asset maps still resolve.
export const assetKey = (slotId: string, aspect?: AssetAspect): string =>
  aspect ? `${slotId}:${aspect}` : slotId;
