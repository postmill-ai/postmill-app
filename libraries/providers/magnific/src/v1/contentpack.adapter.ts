import { metadata as providerMetadata } from './metadata';
import {
  ContentPackCapability as ContentPackCapabilityContract,
  ContentPackCapabilityName as ContentPackCapability,
  ContentPackDailyCapError,
  ProviderModule,
  SafeFetchPort,
  StockIconItem,
  StockPhotoItem,
  StockSearchResponse,
  StockStickerItem,
  StockVectorItem,
  StockVideoItem,
} from '@gitroom/provider-kernel';

const BASE_URL = 'https://api.magnific.com';

export class MagnificContentPack implements ContentPackCapabilityContract {
  readonly identifier = 'magnific';
  readonly name = 'Magnific';
  readonly capabilities: ContentPackCapability[] = ['photos', 'vectors', 'icons', 'videos'];

  constructor(private readonly _apiKey: string, private readonly _fetch: SafeFetchPort) {}

  async search(
    capability: ContentPackCapability,
    query: string,
    page: number = 1,
    filters?: Record<string, string>
  ): Promise<StockSearchResponse<any>> {
    // Verified against docs.magnific.com (formerly Freepik API): search term is `term`,
    // page size is `limit`, pagination lives flat on `meta` (total / last_page / per_page).
    const params = new URLSearchParams({
      term: query || '',
      page: String(page),
      limit: '20',
    });
    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        if (value) params.set(key, value);
      }
    }

    const endpoint = this.endpointForCapability(capability);
    const res = await this._fetch(`${BASE_URL}${endpoint}?${params}`, {
      headers: { 'x-magnific-api-key': this._apiKey },
    });

    if (res.status === 429) {
      throw new ContentPackDailyCapError('Daily Magnific limit reached. Check your Magnific plan.');
    }
    if (!res.ok) {
      const text = await res.text().catch(() => 'Unknown error');
      throw new Error(`Magnific request failed: ${res.status} ${text}`);
    }

    const data = (await res.json()) as any;
    const items = Array.isArray(data?.data) ? data.data : [];
    const meta = data?.meta || {};
    const perPage = Number(meta.per_page) || 20;
    const total = Number(meta.total) || items.length;
    const totalPages = Number(meta.last_page) || Math.max(1, Math.ceil(total / perPage));

    const mapper = this.mapperForCapability(capability);
    return {
      results: items.map(mapper.bind(this)),
      page,
      totalPages: Math.max(1, totalPages),
      configured: true,
      source: 'magnific',
    };
  }

  async resolveDownload(id: string, capability: ContentPackCapability = 'photos'): Promise<string> {
    const downloadPath = this.downloadPathForCapability(capability, id);
    const res = await this._fetch(`${BASE_URL}${downloadPath}`, {
      headers: { 'x-magnific-api-key': this._apiKey },
    });

    if (res.status === 429) {
      throw new ContentPackDailyCapError('Daily Magnific limit reached. Check your Magnific plan.');
    }
    if (!res.ok) {
      const text = await res.text().catch(() => 'Unknown error');
      throw new Error(`Magnific download failed: ${res.status} ${text}`);
    }

    const data = (await res.json()) as any;
    const url = data?.data?.url || data?.url || data?.download_url;
    if (!url) {
      throw new Error('Magnific download response did not include a URL');
    }
    return url;
  }

  private endpointForCapability(capability: ContentPackCapability): string {
    switch (capability) {
      case 'photos':
      case 'vectors':
        return '/v1/resources';
      case 'icons':
        return '/v1/icons';
      case 'videos':
        return '/v1/videos';
      default:
        return '/v1/resources';
    }
  }

  private downloadPathForCapability(capability: ContentPackCapability, id: string): string {
    // Percent-encode the client-supplied id so a `../` cannot path-traverse the
    // authenticated request within the provider host.
    const safeId = encodeURIComponent(id);
    switch (capability) {
      case 'photos':
      case 'vectors':
        return `/v1/resources/${safeId}/download`;
      case 'icons':
        return `/v1/icons/${safeId}/download`;
      case 'videos':
        return `/v1/videos/${safeId}/download`;
      default:
        return `/v1/resources/${safeId}/download`;
    }
  }

  private mapperForCapability(
    capability: ContentPackCapability
  ): (item: any) => StockPhotoItem | StockVectorItem | StockIconItem | StockVideoItem | StockStickerItem {
    switch (capability) {
      case 'photos':
        return this.mapResource.bind(this) as any;
      case 'vectors':
        return this.mapVector.bind(this) as any;
      case 'icons':
        return this.mapIcon.bind(this) as any;
      case 'videos':
        return this.mapVideo.bind(this) as any;
      default:
        return this.mapResource.bind(this) as any;
    }
  }

  // Resource preview URL lives at `image.source.url`; `item.url` is the public web page
  // (used as sourceUrl). The licensed full file is minted separately via resolveDownload.
  private previewUrl(item: any): string {
    return (
      item.image?.source?.url ||
      item.thumbnails?.[0]?.url ||
      item.preview?.url ||
      item.preview_url ||
      ''
    );
  }

  private authorUrl(item: any): string {
    return item.author?.slug
      ? `https://www.magnific.com/author/${item.author.slug}`
      : item.author?.url || '';
  }

  private mapResource(item: any): StockPhotoItem {
    const preview = this.previewUrl(item);
    return {
      id: String(item.id),
      url: preview,
      thumbUrl: preview,
      description: item.title || item.description || null,
      author: item.author?.name || 'Magnific',
      authorUrl: this.authorUrl(item),
      sourceUrl: item.url || '',
      width: item.image?.source?.size?.width || item.width || 0,
      height: item.image?.source?.size?.height || item.height || 0,
      color: null,
      downloadLocation: null,
      source: 'magnific',
      license: 'magnific-byok',
    };
  }

  private mapVector(item: any): StockVectorItem {
    const preview = this.previewUrl(item);
    return {
      id: String(item.id),
      url: preview,
      thumbUrl: preview,
      description: item.title || item.description || null,
      author: item.author?.name || 'Magnific',
      authorUrl: this.authorUrl(item),
      sourceUrl: item.url || '',
      width: item.image?.source?.size?.width || item.width || 0,
      height: item.image?.source?.size?.height || item.height || 0,
      source: 'magnific',
      license: 'magnific-byok',
    };
  }

  private mapIcon(item: any): StockIconItem {
    const preview = this.previewUrl(item);
    return {
      id: String(item.id),
      url: preview,
      thumbUrl: preview,
      description: item.name || item.title || null,
      author: item.author?.name || item.family?.name || 'Magnific',
      authorUrl: this.authorUrl(item),
      sourceUrl: item.url || '',
      width: item.thumbnails?.[0]?.width || 24,
      height: item.thumbnails?.[0]?.height || 24,
      source: 'magnific',
      prefix: 'magnific',
      iconName: item.name || String(item.id),
      license: 'magnific-byok',
    };
  }

  private mapVideo(item: any): StockVideoItem {
    const preview = this.previewUrl(item);
    return {
      id: String(item.id),
      url: preview,
      thumbUrl: preview,
      description: item.title || item.description || null,
      author: item.author?.name || 'Magnific',
      authorUrl: this.authorUrl(item),
      sourceUrl: item.url || '',
      width: item.image?.source?.size?.width || item.width || 0,
      height: item.image?.source?.size?.height || item.height || 0,
      duration: item.duration || 0,
      source: 'magnific',
      license: 'magnific-byok',
    };
  }
}

export const magnificContentPackModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'contentpack',
    providerId: 'magnific',
    version: 'v1',
    displayName: 'Magnific',
    status: 'active',
    credentialFields: [{ key: 'apiKey', label: 'API Key', type: 'password', required: true }],
    capabilities: ['photos', 'vectors', 'icons', 'videos'],
  },
  create: (ctx) => new MagnificContentPack(ctx.credentials.apiKey, ctx.fetch),
};
