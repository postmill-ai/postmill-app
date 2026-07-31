import '@postmill-ai/nestjs-libraries/ai-designer/agent-mesh/agent-mesh-env.shim';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  registerInProcessAgent,
  type InProcessHandler,
} from '@reaatech/agent-mesh-router';
import type { AgentResponse } from '@reaatech/agent-mesh';
import sharp from 'sharp';
import { AiDefaultsService } from '@postmill-ai/nestjs-libraries/ai/defaults/ai-defaults.service';
import { FileService } from '@postmill-ai/nestjs-libraries/database/prisma/file/file.service';
import { StorageService } from '@postmill-ai/nestjs-libraries/database/prisma/storage/storage.service';
import { StockMediaService } from '@postmill-ai/nestjs-libraries/media/stock/stock-media.service';
import type { AssetAspect, AssetNeedRequest, AssetResult } from '../../ai-designer.types';
import { assetKey } from '../../util/aspect';
import { raceWithTimeout } from '../../util/race-with-timeout';
import {
  isAgentInputError,
  parseAgentInput,
} from '../../util/parse-agent-input';
import type { ContextPacket } from '@reaatech/agent-mesh';

// Hard ceiling on asset generation per request. The asset agent fans out over
// every need, so without a cap one request could request hundreds of parallel
// text-to-image generations. Match the conductor's MAX_ASSET_NEEDS.
const MAX_ASSET_NEEDS = 8;

// Provider-returned data: URLs bypass `importFromUrl`'s allowlist/size guard,
// so this path enforces its own: raster-image MIMEs only (no SVG — it can
// carry scripts and these files land on the shared uploads host) and the same
// 512 MB cap the media-job lifecycle uses for data-URL decodes.
const ALLOWED_DATA_URL_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);
const MAX_DATA_URL_MEDIA_BYTES = 512 * 1024 * 1024;

// Aspect class → composition framing sentence for the image model.
const ASPECT_COMPOSITION: Record<AssetAspect, string> = {
  wide: 'Wide 16:9 composition.',
  square: 'Square 1:1 composition.',
  tall: 'Tall 9:16 composition.',
};

// Appended to every GENERATED image prompt (never to stock searches): image
// models love painting headline text, logos and watermarks into the asset,
// which then collides with the composer's own rendered copy.
const NO_BAKED_IN_TEXT_SUFFIX =
  'No text, no words, no letters, no typography, no watermark, no logo.';

// Appended ON TOP of the standard suffix when the vision critic flagged the
// previous generation for baked-in text/logos (regenerateAsset fix): the
// first attempt already carried NO_BAKED_IN_TEXT_SUFFIX and the model painted
// branding anyway, so the regeneration prompt gets a harder negative.
const REGENERATE_NO_TEXT_SUFFIX =
  'Plain unbranded packaging or surfaces — absolutely no printed text, labels, or logos on any object.';

// Layout intent → subject-placement guidance for the image model. Covers both
// channelLayouts intent ids and gallery template ids. Composition ONLY — never
// ask for "dark/clean/low-detail areas for text": models paint solid black
// bands into the asset when asked to reserve text space (observed with flux).
// Text legibility is the composer's job (scrim/shadow/stroke), not the asset's.
const LAYOUT_TEXT_SPACE: Record<string, string> = {
  'hero-fullbleed': 'Full-bleed photographic composition to every edge — no borders, bars, letterboxing or solid-color regions. Place the main subject in the upper two-thirds of the frame.',
  'hero-top': 'Full-bleed photographic composition to every edge — no borders, bars, letterboxing or solid-color regions. Place the main subject in the upper two-thirds of the frame.',
  'top-bottom': 'Full-bleed photographic composition to every edge — no borders, bars, letterboxing or solid-color regions. Keep the main subject near the vertical center.',
  stacked: 'Full-bleed photographic composition to every edge — no borders, bars, letterboxing or solid-color regions. Keep the main subject near the vertical center.',
  'badge-burst': 'Full-bleed photographic composition to every edge — no borders, bars, letterboxing or solid-color regions.',
  'split-panel': 'Full-bleed photographic composition to every edge — no borders, bars, letterboxing or solid-color regions. Place the main subject on the right half of the frame.',
  'side-by-side': 'Full-bleed photographic composition to every edge — no borders, bars, letterboxing or solid-color regions. Place the main subject on the right half of the frame.',
  'editorial-sidebar': 'Full-bleed photographic composition to every edge — no borders, bars, letterboxing or solid-color regions. Place the main subject on the right half of the frame.',
};

// Aspect class → stock search orientation (Unsplash vocabulary; content-pack
// adapters receive the same filter map).
const STOCK_ORIENTATION: Record<AssetAspect, string> = {
  wide: 'landscape',
  square: 'squarish',
  tall: 'portrait',
};

type AssetNeed = AssetNeedRequest;

interface AssetRequestInput {
  type: 'asset-request';
  assetNeeds: AssetNeed[];
  referenceFileIds?: string[];
  /** Conductor regenerateAsset dispatch: same resolve path, harder no-text prompt. */
  regenerate?: boolean;
}

@Injectable()
export class AiDesignerAssetService implements OnModuleInit {
  private readonly _logger = new Logger(AiDesignerAssetService.name);

  constructor(
    private readonly _aiDefaults: AiDefaultsService,
    private readonly _fileService: FileService,
    private readonly _storageService: StorageService,
    private readonly _stockMedia: StockMediaService
  ) {}

  onModuleInit() {
    registerInProcessAgent('asset', this._handler.bind(this));
  }

  private _handler: InProcessHandler = async (
    context: ContextPacket
  ): Promise<AgentResponse> => {
    const orgId =
      context.metadata && typeof context.metadata.orgId === 'string'
        ? context.metadata.orgId
        : '';

    if (!orgId) {
      return {
        content: JSON.stringify({
          type: 'error',
          message: 'Asset agent could not run: missing orgId in agent context metadata.',
        }),
        workflow_complete: false,
      };
    }

    const payload = parseAgentInput<AssetRequestInput>(context.raw_input);
    if (isAgentInputError(payload)) {
      return {
        content: JSON.stringify(payload),
        workflow_complete: false,
      };
    }

    const assetNeeds = payload.assetNeeds.slice(0, MAX_ASSET_NEEDS);
    if (payload.assetNeeds.length > MAX_ASSET_NEEDS) {
      this._logger.warn(
        `Asset request contained ${payload.assetNeeds.length} needs; clamping to ${MAX_ASSET_NEEDS}.`,
        AiDesignerAssetService.name
      );
    }

    const assets: Record<string, AssetResult> = {};

    await Promise.all(
      assetNeeds.map(async (need) => {
        const result = payload.regenerate
          ? await this.regenerateForSlot(orgId, need)
          : await this._resolveAsset(orgId, need);
        if (result) {
          assets[assetKey(need.slotId, need.aspect)] = result;
        }
      })
    );

    return {
      content: JSON.stringify({
        type: 'assets',
        assets,
      }),
      workflow_complete: false,
    };
  };

  /**
   * Regeneration entry for the conductor's regenerateAsset fix (a critic
   * flagged baked-in text/logos in the previous asset): same resolve path —
   * generate with retry, stock fallback, gradient last resort — but the
   * generation prompt carries the strengthened no-text negative. The
   * initial-compose prompt path is untouched.
   */
  async regenerateForSlot(
    orgId: string,
    need: AssetNeed
  ): Promise<AssetResult | null> {
    return this._resolveAsset(orgId, need, true);
  }

  private async _resolveAsset(
    orgId: string,
    need: AssetNeed,
    regenerate = false
  ): Promise<AssetResult | null> {
    if (need.prefer === 'generate' || need.prefer === 'either') {
      // One retry before stock: transient provider failures (rate limits,
      // timeouts) are the common case and a second attempt usually lands.
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const url = await this._generateImageWithTimeout(orgId, need, regenerate);
          if (url.startsWith('https:')) {
            const file = await this._fileService.importFromUrl(orgId, {
              url,
              name: need.brief.slice(0, 40),
            });
            return this._toResult(need, file, 'generate');
          }
          if (url.startsWith('data:')) {
            const file = await this._importDataUrl(orgId, url, need.brief);
            if (file) return this._toResult(need, file, 'generate');
          }
          // An unusable URL shape won't change on a retry — go to stock.
          break;
        } catch (err) {
          // Swallow provider/timeout/capability errors and try stock — but say
          // so: a silent fallthrough here renders flat backgrounds with zero
          // diagnostic trail.
          this._logger.warn(
            `Asset generate failed for slot ${assetKey(need.slotId, need.aspect)} (attempt ${attempt}/2): ${(err as Error).message}${attempt < 2 ? '; retrying once.' : '; trying stock.'}`
          );
        }
      }
    }

    const stock = await this._tryStock(orgId, need);
    if (stock) return stock;

    this._logger.warn(
      `Asset for slot ${assetKey(need.slotId, need.aspect)} fell back to gradient (generate + stock both unavailable).`
    );
    return this._fallbackGradient(orgId, need);
  }

  private async _generateImageWithTimeout(
    orgId: string,
    need: AssetNeed,
    regenerate = false
  ): Promise<string> {
    const raw = Number(process.env.AI_DESIGNER_ASSET_TIMEOUT_MS);
    const timeoutMs = Number.isFinite(raw) && raw > 0 ? raw : 90_000;
    return raceWithTimeout(
      this._aiDefaults.textToImage(orgId, this._buildPrompt(need, regenerate), {
        aspect: need.aspect,
      }),
      timeoutMs,
      { label: 'Asset generation' }
    );
  }

  // Brief + a short (≤2 sentence) layout suffix for background/hero slots:
  // the aspect's composition framing plus where the copy will sit, so the
  // model leaves that region calm. Non-hero slots get the bare brief. Every
  // generated prompt gets the no-baked-in-text suffix (stock searches don't —
  // they query by brief, not generate); regenerations append the harder
  // negative on top.
  private _buildPrompt(need: AssetNeed, regenerate = false): string {
    const noText = regenerate
      ? `${NO_BAKED_IN_TEXT_SUFFIX} ${REGENERATE_NO_TEXT_SUFFIX}`
      : NO_BAKED_IN_TEXT_SUFFIX;
    if (!need.heroLayout) return `${need.brief} ${noText}`;
    const parts: string[] = [];
    if (need.aspect) parts.push(ASPECT_COMPOSITION[need.aspect]);
    const textSpace = LAYOUT_TEXT_SPACE[need.heroLayout];
    if (textSpace) parts.push(textSpace);
    return parts.length > 0
      ? `${need.brief} ${parts.join(' ')} ${noText}`
      : `${need.brief} ${noText}`;
  }

  private async _tryStock(
    orgId: string,
    need: AssetNeed
  ): Promise<AssetResult | null> {
    try {
      const response = await this._stockMedia.searchPhotos(
        orgId,
        need.brief,
        1,
        need.aspect ? STOCK_ORIENTATION[need.aspect] : undefined
      );
      const item = response.results[0];
      if (!item) {
        return null;
      }

      const file = await this._fileService.importFromUrl(orgId, {
        url: item.url,
        name: need.brief.slice(0, 40),
        source: item.source,
        attribution: item.attribution,
      });

      return this._toResult(need, file, 'stock', this._stockFocalPoint(item));
    } catch {
      return null;
    }
  }

  // Stock providers don't currently return a focal point; pass one through if
  // a provider ever does — the composer defaults to center otherwise.
  private _stockFocalPoint(item: unknown): { x: number; y: number } | undefined {
    const fp = (item as { focalPoint?: { x?: unknown; y?: unknown } })?.focalPoint;
    if (typeof fp?.x === 'number' && typeof fp?.y === 'number') {
      return { x: fp.x, y: fp.y };
    }
    return undefined;
  }

  private async _importDataUrl(
    orgId: string,
    dataUrl: string,
    brief: string
  ): Promise<{ id: string; path: string } | null> {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;

    const mime = match[1] || 'image/png';
    if (!ALLOWED_DATA_URL_MIME_TYPES.has(mime)) return null;
    // Reject before decoding: base64 expands ~4/3, so a payload string longer
    // than this cannot decode under the byte cap.
    if (match[2].length > (MAX_DATA_URL_MEDIA_BYTES / 3) * 4) return null;
    try {
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length > MAX_DATA_URL_MEDIA_BYTES) return null;
      const adapter = await this._storageService.getLocalAdapterForOrg(orgId, true);
      const path = await adapter.writeBuffer(buffer, mime);
      const file = await this._fileService.saveGeneratedMedia(orgId, {
        name: brief.slice(0, 40) || 'ai-asset',
        path,
        type: mime,
        folderId: null,
        fileSize: buffer.length,
      });
      return { id: file.id, path: file.path };
    } catch {
      return null;
    }
  }

  private async _fallbackGradient(
    orgId: string,
    need: AssetNeed
  ): Promise<AssetResult | null> {
    try {
      const size = 512;
      const svg = this._buildFallbackSvg(need.brief, size);
      const buffer = await sharp(Buffer.from(svg))
        .resize(size, size, { fit: 'fill' })
        .png()
        .toBuffer();

      const adapter = await this._storageService.getLocalAdapterForOrg(orgId, true);
      const path = await adapter.writeBuffer(buffer, 'image/png');
      const file = await this._fileService.saveGeneratedMedia(orgId, {
        name: `${need.brief.slice(0, 40)}-fallback`,
        path,
        type: 'image/png',
        folderId: null,
        fileSize: buffer.length,
      });

      return this._toResult(need, file, 'gradient');
    } catch (err) {
      // The last-resort fallback failed: the slot gets NOTHING. This is an
      // error-level event (sharp/storage broken), not routine degradation —
      // the conductor surfaces the missing asset to the user via its
      // missing-asset note.
      this._logger.error(
        `Gradient fallback failed for slot ${assetKey(need.slotId, need.aspect)}: ${(err as Error)?.message ?? err}`,
        (err as Error)?.stack,
        AiDesignerAssetService.name
      );
      return null;
    }
  }

  private _buildFallbackSvg(brief: string, size: number): string {
    const { from, to } = this._colorsFromBrief(brief);
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${from}"/>
      <stop offset="100%" stop-color="${to}"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#g)"/>
</svg>`;
  }

  private _colorsFromBrief(brief: string): { from: string; to: string } {
    const lower = brief.toLowerCase();
    if (lower.includes('blue') || lower.includes('professional')) {
      return { from: '#2B5CD3', to: '#d4e0f0' };
    }
    if (lower.includes('warm') || lower.includes('sunset')) {
      return { from: '#f59e0b', to: '#ef4444' };
    }
    if (lower.includes('dark') || lower.includes('night')) {
      return { from: '#111827', to: '#374151' };
    }
    return { from: '#e5e7eb', to: '#9ca3af' };
  }

  private _toResult(
    need: AssetNeed,
    file: { id: string; path: string },
    source: AssetResult['source'],
    focalPoint?: { x: number; y: number }
  ): AssetResult {
    return {
      slotId: need.slotId,
      fileId: file.id,
      path: file.path,
      type: 'image',
      source,
      aspect: need.aspect,
      focalPoint,
    };
  }
}
