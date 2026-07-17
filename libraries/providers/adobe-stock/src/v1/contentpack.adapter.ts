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

// Adobe Stock Search API — https://developer.adobe.com/stock/
//   GET https://stock.adobe.io/Rest/Media/1/Search/Files
//   Headers: x-api-key: <apiKey>, x-product: <app-name>
// Search works with just an API key. Note: minting a *licensed* full-res asset
// needs an OAuth access token + an active entitlement (Rest/Libraries/1/Content/
// License); with a key alone we can only resolve the watermarked comp URL, which
// is what resolveDownload returns. Wire a real licensing token here when Adobe
// entitlement is available. Built source-grounded, not yet live-smoke-tested.
const SEARCH_URL = 'https://stock.adobe.io/Rest/Media/1/Search/Files';
const PRODUCT = 'Postmill';
const PER_PAGE = 20;

// Adobe content_type filter keys per capability.
const CONTENT_TYPE: Record<string, string> = {
  photos: 'photo',
  vectors: 'illustration',
  videos: 'video',
};

const RESULT_COLUMNS = [
  'nb_results',
  'id',
  'title',
  'width',
  'height',
  'thumbnail_url',
  'thumbnail_500_url',
  'comp_url',
  'details_url',
  'creator_name',
  'media_type_id',
];

export class AdobeStockContentPack implements ContentPackCapabilityContract {
  readonly identifier = 'adobe-stock';
  readonly name = 'Adobe Stock';
  readonly capabilities: ContentPackCapability[] = ['photos', 'vectors', 'videos'];

  constructor(private readonly _apiKey: string, private readonly _fetch: SafeFetchPort) {}

  private get _headers() {
    return {
      'x-api-key': this._apiKey,
      'x-product': PRODUCT,
      Accept: 'application/json',
    };
  }

  async search(
    capability: ContentPackCapability,
    query: string,
    page: number = 1,
    filters?: Record<string, string>
  ): Promise<StockSearchResponse<any>> {
    const params = new URLSearchParams();
    params.set('locale', 'en_US');
    params.set('search_parameters[words]', query || '');
    params.set('search_parameters[limit]', String(PER_PAGE));
    params.set('search_parameters[offset]', String((page - 1) * PER_PAGE));
    const contentType = CONTENT_TYPE[capability] || 'photo';
    params.set(`search_parameters[filters][content_type:${contentType}]`, '1');
    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        if (value) params.set(`search_parameters[${key}]`, value);
      }
    }
    for (const col of RESULT_COLUMNS) params.append('result_columns[]', col);

    const res = await this._fetch(`${SEARCH_URL}?${params}`, { headers: this._headers });
    if (res.status === 429) {
      throw new ContentPackDailyCapError('Adobe Stock rate limit reached. Check your Adobe plan.');
    }
    if (!res.ok) {
      const text = await res.text().catch(() => 'Unknown error');
      throw new Error(`Adobe Stock request failed: ${res.status} ${text}`);
    }

    const data = (await res.json()) as any;
    const files = Array.isArray(data?.files) ? data.files : [];
    const total = Number(data?.nb_results) || files.length;
    const mapper = this._mapperFor(capability);
    return {
      results: files.map(mapper.bind(this)),
      page,
      totalPages: Math.max(1, Math.ceil(total / PER_PAGE)),
      configured: true,
      source: 'adobe-stock',
    };
  }

  async resolveDownload(id: string, capability: ContentPackCapability = 'photos'): Promise<string> {
    // Resolve the item by id and return its comp URL. Full licensed download
    // requires an OAuth entitlement token (see file header).
    const params = new URLSearchParams();
    params.set('search_parameters[media_id]', id);
    params.set('search_parameters[limit]', '1');
    const contentType = CONTENT_TYPE[capability] || 'photo';
    params.set(`search_parameters[filters][content_type:${contentType}]`, '1');
    for (const col of ['id', 'comp_url', 'thumbnail_500_url', 'thumbnail_url']) {
      params.append('result_columns[]', col);
    }

    const res = await this._fetch(`${SEARCH_URL}?${params}`, { headers: this._headers });
    if (res.status === 429) {
      throw new ContentPackDailyCapError('Adobe Stock rate limit reached. Check your Adobe plan.');
    }
    if (!res.ok) {
      const text = await res.text().catch(() => 'Unknown error');
      throw new Error(`Adobe Stock download failed: ${res.status} ${text}`);
    }
    const data = (await res.json()) as any;
    const file = (Array.isArray(data?.files) ? data.files : [])[0];
    const url = file?.comp_url || file?.thumbnail_500_url || file?.thumbnail_url;
    if (!url) {
      throw new Error('Adobe Stock download response did not include a URL');
    }
    return url;
  }

  private _mapperFor(capability: ContentPackCapability): (file: any) => any {
    if (capability === 'videos') return this._mapVideo;
    if (capability === 'vectors') return this._mapVector;
    return this._mapPhoto;
  }

  private _preview(file: any): string {
    return file.thumbnail_500_url || file.thumbnail_url || file.comp_url || '';
  }

  private _mapPhoto = (file: any): StockPhotoItem => {
    const preview = this._preview(file);
    return {
      id: String(file.id),
      url: preview,
      thumbUrl: preview,
      description: file.title || null,
      author: file.creator_name || 'Adobe Stock',
      authorUrl: '',
      sourceUrl: file.details_url || '',
      width: file.width || 0,
      height: file.height || 0,
      color: null,
      downloadLocation: null,
      source: 'adobe-stock',
      license: 'adobe-stock-byok',
    };
  };

  private _mapVector = (file: any): StockVectorItem => {
    const preview = this._preview(file);
    return {
      id: String(file.id),
      url: preview,
      thumbUrl: preview,
      description: file.title || null,
      author: file.creator_name || 'Adobe Stock',
      authorUrl: '',
      sourceUrl: file.details_url || '',
      width: file.width || 0,
      height: file.height || 0,
      source: 'adobe-stock',
      license: 'adobe-stock-byok',
    };
  };

  private _mapVideo = (file: any): StockVideoItem => {
    const preview = this._preview(file);
    return {
      id: String(file.id),
      url: preview,
      thumbUrl: preview,
      description: file.title || null,
      author: file.creator_name || 'Adobe Stock',
      authorUrl: '',
      sourceUrl: file.details_url || '',
      width: file.width || 0,
      height: file.height || 0,
      duration: 0,
      source: 'adobe-stock',
      license: 'adobe-stock-byok',
    };
  };
}

export const adobestockContentPackModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'contentpack',
    providerId: 'adobe-stock',
    version: 'v1',
    displayName: 'Adobe Stock',
    status: 'active',
    credentialFields: [{ key: 'apiKey', label: 'API Key', type: 'password', required: true }],
    capabilities: ['photos', 'vectors', 'videos'],
  },
  create: (ctx) => new AdobeStockContentPack(ctx.credentials.apiKey, ctx.fetch),
};
