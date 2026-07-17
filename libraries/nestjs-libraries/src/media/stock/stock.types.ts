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
