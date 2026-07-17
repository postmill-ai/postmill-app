import { metadata as providerMetadata } from './metadata';
import {
  ContentPackCapability as ContentPackCapabilityContract,
  ContentPackCapabilityName as ContentPackCapability,
  ContentPackDailyCapError,
  ProviderModule,
  SafeFetchPort,
  StockAudioItem,
  StockPhotoItem,
  StockSearchResponse,
  StockVectorItem,
  StockVideoItem,
} from '@gitroom/provider-kernel';

// Envato API — https://build.envato.com/api/ (Bearer personal token).
//   GET https://api.envato.com/v1/discovery/search/search/item?term=&site=&page=&page_size=
// Each capability maps to an Envato marketplace `site`. Search + previews work
// with a personal token; a *licensed* download is subscription/purchase gated
// (Elements download or Market /v2/market/buyer/download), so resolveDownload
// returns the highest-quality preview URL. Built source-grounded against
// api.envato.com (Market); Elements' download entitlement differs and needs a
// live smoke test.
const BASE_URL = 'https://api.envato.com/v1/discovery/search/search/item';
const PER_PAGE = 20;

const SITE: Record<string, string> = {
  photos: 'photodune.net',
  videos: 'videohive.net',
  audio: 'audiojungle.net',
  vectors: 'graphicriver.net',
};

export class EnvatoContentPack implements ContentPackCapabilityContract {
  readonly identifier = 'envato';
  readonly name = 'Envato Elements';
  readonly capabilities: ContentPackCapability[] = ['photos', 'vectors', 'videos', 'audio'];

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
      site: SITE[capability] || SITE.photos,
      page: String(page),
      page_size: String(PER_PAGE),
    });
    if (capability === 'vectors') params.set('category', 'vectors');
    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        if (value) params.set(key, value);
      }
    }

    const res = await this._fetch(`${BASE_URL}?${params}`, { headers: this._headers });
    if (res.status === 429) {
      throw new ContentPackDailyCapError('Envato rate limit reached. Check your Envato plan.');
    }
    if (!res.ok) {
      const text = await res.text().catch(() => 'Unknown error');
      throw new Error(`Envato request failed: ${res.status} ${text}`);
    }

    const data = (await res.json()) as any;
    const matches = Array.isArray(data?.matches) ? data.matches : [];
    const total = Number(data?.total_hits) || matches.length;
    const mapper = this._mapperFor(capability);
    return {
      results: matches.map(mapper.bind(this)),
      page,
      totalPages: Math.max(1, Math.ceil(total / PER_PAGE)),
      configured: true,
      source: 'envato',
    };
  }

  async resolveDownload(id: string, capability: ContentPackCapability = 'photos'): Promise<string> {
    // Resolve the item by id and return its best preview URL (full licensed
    // download is subscription/purchase gated — see file header).
    const params = new URLSearchParams({ id });
    const res = await this._fetch(
      `https://api.envato.com/v3/market/catalog/item?${params}`,
      { headers: this._headers }
    );
    if (res.status === 429) {
      throw new ContentPackDailyCapError('Envato rate limit reached. Check your Envato plan.');
    }
    if (!res.ok) {
      const text = await res.text().catch(() => 'Unknown error');
      throw new Error(`Envato download failed: ${res.status} ${text}`);
    }
    const item = (await res.json()) as any;
    const url = capability === 'audio' ? this._audioUrl(item) : this._previewUrl(item);
    if (!url) {
      throw new Error('Envato download response did not include a URL');
    }
    return url;
  }

  private _mapperFor(capability: ContentPackCapability): (item: any) => any {
    if (capability === 'videos') return this._mapVideo;
    if (capability === 'audio') return this._mapAudio;
    if (capability === 'vectors') return this._mapVector;
    return this._mapPhoto;
  }

  private _previewUrl(item: any): string {
    const p = item.previews || {};
    return (
      p.landscape_preview?.landscape_url ||
      p.icon_with_landscape_preview?.landscape_url ||
      p.live_preview?.url ||
      p.icon_preview?.icon_url ||
      item.preview_url ||
      ''
    );
  }

  private _audioUrl(item: any): string {
    const p = item.previews || {};
    return p.audio_preview?.mp3_url || p.audio_preview?.mp3_preview_download_url || '';
  }

  private _mapPhoto = (item: any): StockPhotoItem => {
    const preview = this._previewUrl(item);
    return {
      id: String(item.id),
      url: preview,
      thumbUrl: preview,
      description: item.name || null,
      author: item.author_username || 'Envato',
      authorUrl: item.author_url || '',
      sourceUrl: item.url || '',
      width: 0,
      height: 0,
      color: null,
      downloadLocation: null,
      source: 'envato',
      license: 'envato-byok',
    };
  };

  private _mapVector = (item: any): StockVectorItem => {
    const preview = this._previewUrl(item);
    return {
      id: String(item.id),
      url: preview,
      thumbUrl: preview,
      description: item.name || null,
      author: item.author_username || 'Envato',
      authorUrl: item.author_url || '',
      sourceUrl: item.url || '',
      width: 0,
      height: 0,
      source: 'envato',
      license: 'envato-byok',
    };
  };

  private _mapVideo = (item: any): StockVideoItem => {
    const preview = this._previewUrl(item);
    return {
      id: String(item.id),
      url: preview,
      thumbUrl: preview,
      description: item.name || null,
      author: item.author_username || 'Envato',
      authorUrl: item.author_url || '',
      sourceUrl: item.url || '',
      width: 0,
      height: 0,
      duration: 0,
      source: 'envato',
      license: 'envato-byok',
    };
  };

  private _mapAudio = (item: any): StockAudioItem => {
    const url = this._audioUrl(item);
    return {
      id: String(item.id),
      url,
      downloadUrl: url,
      name: item.name || 'Untitled',
      duration: 0,
      author: item.author_username || 'Envato',
      source: 'envato',
      license: 'envato-byok',
    };
  };
}

export const envatoContentPackModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'contentpack',
    providerId: 'envato',
    version: 'v1',
    displayName: 'Envato Elements',
    status: 'active',
    credentialFields: [{ key: 'apiKey', label: 'API Token', type: 'password', required: true }],
    capabilities: ['photos', 'vectors', 'videos', 'audio'],
  },
  create: (ctx) => new EnvatoContentPack(ctx.credentials.apiKey, ctx.fetch),
};
