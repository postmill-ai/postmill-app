import { metadata as providerMetadata } from './metadata';
import {
  ContentPackCapability as ContentPackCapabilityContract,
  ContentPackCapabilityName as ContentPackCapability,
  ContentPackDailyCapError,
  ProviderModule,
  SafeFetchPort,
  StockPhotoItem,
  StockSearchResponse,
  StockVectorItem,
  StockVideoItem,
} from '@gitroom/provider-kernel';

// Vecteezy Content API (https://www.vecteezy.com/api) — Bearer API key.
// Vecteezy's content/download API is partner-gated; endpoints/shapes here are
// modelled on the common stock-API pattern (search → resolve a licensed download
// URL by id) and MUST be verified against the live Vecteezy API docs/key. Photos,
// vectors and videos are covered; anything else falls back to the free provider.
const BASE_URL = 'https://api.vecteezy.com/v1';
const PER_PAGE = 20;

const CONTENT_TYPE: Record<string, string> = {
  photos: 'photo',
  vectors: 'vector',
  videos: 'video',
};

export class VecteezyContentPack implements ContentPackCapabilityContract {
  readonly identifier = 'vecteezy';
  readonly name = 'Vecteezy';
  readonly capabilities: ContentPackCapability[] = ['photos', 'vectors', 'videos'];

  constructor(private readonly _apiKey: string, private readonly _fetch: SafeFetchPort) {}

  private get _headers() {
    return { Authorization: `Bearer ${this._apiKey}`, Accept: 'application/json' };
  }

  async search(
    capability: ContentPackCapability,
    query: string,
    page: number = 1,
    filters?: Record<string, string>
  ): Promise<StockSearchResponse<any>> {
    const params = new URLSearchParams({
      term: query || '',
      content_type: CONTENT_TYPE[capability] || 'photo',
      page: String(page),
      per_page: String(PER_PAGE),
    });
    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        if (value) params.set(key, value);
      }
    }

    const res = await this._fetch(`${BASE_URL}/resources?${params}`, { headers: this._headers });
    if (res.status === 429) {
      throw new ContentPackDailyCapError('Vecteezy rate limit reached. Check your Vecteezy plan.');
    }
    if (!res.ok) {
      const text = await res.text().catch(() => 'Unknown error');
      throw new Error(`Vecteezy request failed: ${res.status} ${text}`);
    }

    const data = (await res.json()) as any;
    const items = Array.isArray(data?.data) ? data.data : [];
    const total = Number(data?.total_count) || Number(data?.total) || items.length;
    const mapper = this._mapperFor(capability);
    return {
      results: items.map(mapper.bind(this)),
      page,
      totalPages: Math.max(1, Math.ceil(total / PER_PAGE)),
      configured: true,
      source: 'vecteezy',
    };
  }

  async resolveDownload(id: string, _capability: ContentPackCapability = 'photos'): Promise<string> {
    const res = await this._fetch(`${BASE_URL}/resources/${encodeURIComponent(id)}/download`, { headers: this._headers });
    if (res.status === 429) {
      throw new ContentPackDailyCapError('Vecteezy rate limit reached. Check your Vecteezy plan.');
    }
    if (!res.ok) {
      const text = await res.text().catch(() => 'Unknown error');
      throw new Error(`Vecteezy download failed: ${res.status} ${text}`);
    }
    const data = (await res.json()) as any;
    const url = data?.data?.url || data?.url || data?.download_url;
    if (!url) {
      throw new Error('Vecteezy download response did not include a URL');
    }
    return url;
  }

  private _mapperFor(capability: ContentPackCapability): (item: any) => any {
    if (capability === 'videos') return this._mapVideo;
    if (capability === 'vectors') return this._mapVector;
    return this._mapPhoto;
  }

  private _preview(item: any): string {
    return item.preview_url || item.thumbnail_url || item.thumb_url || item.url || '';
  }

  private _mapPhoto = (item: any): StockPhotoItem => {
    const preview = this._preview(item);
    return {
      id: String(item.id),
      url: preview,
      thumbUrl: item.thumbnail_url || preview,
      description: item.title || item.description || null,
      author: item.contributor || item.author || 'Vecteezy',
      authorUrl: item.contributor_url || '',
      sourceUrl: item.page_url || item.url || '',
      width: item.width || 0,
      height: item.height || 0,
      color: null,
      downloadLocation: null,
      source: 'vecteezy',
      license: 'vecteezy-byok',
    };
  };

  private _mapVector = (item: any): StockVectorItem => {
    const preview = this._preview(item);
    return {
      id: String(item.id),
      url: preview,
      thumbUrl: item.thumbnail_url || preview,
      description: item.title || item.description || null,
      author: item.contributor || item.author || 'Vecteezy',
      authorUrl: item.contributor_url || '',
      sourceUrl: item.page_url || item.url || '',
      width: item.width || 0,
      height: item.height || 0,
      source: 'vecteezy',
      license: 'vecteezy-byok',
    };
  };

  private _mapVideo = (item: any): StockVideoItem => {
    const preview = this._preview(item);
    return {
      id: String(item.id),
      url: preview,
      thumbUrl: item.thumbnail_url || preview,
      description: item.title || item.description || null,
      author: item.contributor || item.author || 'Vecteezy',
      authorUrl: item.contributor_url || '',
      sourceUrl: item.page_url || item.url || '',
      width: item.width || 0,
      height: item.height || 0,
      duration: item.duration || 0,
      source: 'vecteezy',
      license: 'vecteezy-byok',
    };
  };
}

export const vecteezyContentPackModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'contentpack',
    providerId: 'vecteezy',
    version: 'v1',
    displayName: 'Vecteezy',
    status: 'active',
    credentialFields: [{ key: 'apiKey', label: 'API Key', type: 'password', required: true }],
    capabilities: ['photos', 'vectors', 'videos'],
  },
  create: (ctx) => new VecteezyContentPack(ctx.credentials.apiKey, ctx.fetch),
};
