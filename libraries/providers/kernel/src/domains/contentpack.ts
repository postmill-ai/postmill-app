// Every capability a content pack can serve. The first four are the "premium"
// catalog surfaces that override the free providers (Unsplash/Pexels/Pixabay/
// Iconify); stickers/audio are included because some packs (e.g. Envato) cover
// them. Anything a given pack does NOT declare falls back to the free provider.
export type ContentPackCapabilityName =
  | 'photos'
  | 'vectors'
  | 'icons'
  | 'videos'
  | 'stickers'
  | 'audio';

// ── Stock result shapes ──────────────────────────────────────────────────
// Structurally identical to the consumer-side types in
// `nestjs-libraries/src/media/stock/stock.types.ts`. Defined here so relocated
// content-pack provider packages depend only on the kernel.

export interface StockItemBase {
  id: string;
  url: string;
  thumbUrl: string;
  description: string | null;
  author: string;
  authorUrl: string;
  sourceUrl: string;
  source: string;
  width: number;
  height: number;
  license?: string;
  attribution?: Record<string, unknown>;
}

export interface StockPhotoItem extends StockItemBase {
  downloadLocation: string | null;
  color: string | null;
}

// Vectors reuse the photo shape; source is typically 'pixabay'.
export type StockVectorItem = StockItemBase;

export interface StockVideoItem extends StockItemBase {
  duration: number;
}

export interface StockStickerItem extends StockItemBase {
  // GIPHY stickers may provide an MP4 fallback for video timelines.
  mp4Url?: string;
  // Stickers are transparent; keep a flag for UI hints.
  isSticker: true;
}

export interface StockIconItem extends StockItemBase {
  // Iconify set prefix + icon name.
  prefix: string;
  iconName: string;
  // Per-set license is mandatory for compliance.
  license: string;
  licenseUrl?: string;
}

export interface StockAudioItem {
  id: string;
  url: string;
  /** Stable download URL for saving (the streaming `url` carries an expiring token). */
  downloadUrl?: string;
  name: string;
  duration: number;
  author: string;
  source?: string;
  license?: string;
  attribution?: Record<string, unknown>;
}

export interface StockSearchResponse<T> {
  results: T[];
  page: number;
  totalPages: number;
  configured: boolean;
  source?: string;
}

// Thrown when a pack's provider returns a rate/quota error (HTTP 429). The
// import controller maps this to a 402 so the user sees a clear "limit reached".
export class ContentPackDailyCapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentPackDailyCapError';
  }
}

// A premium, BYOK stock library. Implementations search a capability and mint a
// licensed download URL from an item id (mint-then-ingest). All outbound HTTP
// must go through the runtime's `fetch` (safeFetch); credentials are passed in
// already-decrypted.
export interface ContentPackCapability {
  readonly identifier: string;
  readonly name: string;
  readonly capabilities: ContentPackCapabilityName[];

  search(
    capability: ContentPackCapabilityName,
    query: string,
    page?: number,
    filters?: Record<string, string>,
  ): Promise<StockSearchResponse<any>>;

  resolveDownload(id: string, capability: ContentPackCapabilityName): Promise<string>;
}
