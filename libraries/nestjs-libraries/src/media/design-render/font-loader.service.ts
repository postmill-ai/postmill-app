import { Injectable, Logger } from '@nestjs/common';
import { BrandsService } from '@postmill-ai/nestjs-libraries/brands/brands.service';
import { safeFetch } from '@postmill-ai/nestjs-libraries/dtos/webhooks/safe.fetch';
import { registerFont } from 'canvas';
import {
  catalogWeights,
  googleFontsUrl,
  isCatalogFamily,
} from '../designer-doc/font-catalog';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

interface FontCacheEntry {
  family: string;
  filePath: string;
}

/** Neutralize a fileId before it becomes a temp filename (no path traversal / separators). */
export function safeFileId(fileId: string): string {
  return String(fileId).replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Insert into a process-wide cache with an LRU-ish bound: a re-insert
 * refreshes recency, and the oldest entries are evicted past `max` (Map
 * iteration is insertion-ordered). The font caches below grow with every
 * org×family a render touches, so without a bound a long-lived process
 * serving many orgs grows them forever. Eviction only forfeits the
 * "already downloaded" marker — the font stays registered with node-canvas
 * and on disk, so an evicted family is re-fetched on its next render, never
 * broken.
 */
export function boundedCacheSet<K, V>(
  map: Map<K, V>,
  key: K,
  value: V,
  max: number
): void {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > max) {
    map.delete(map.keys().next().value as K);
  }
}

// Mirror of the curated Designer font catalog from
// apps/frontend/src/components/media-tools/designer/fonts.ts.
// The backend registers these on demand from Google Fonts so exports render
// with the same glyphs as the canvas.
export interface CuratedFont {
  family: string;
  weights: number[];
}

export const CURATED_FONTS: CuratedFont[] = [
  { family: 'Inter', weights: [300, 400, 500, 600, 700] },
  { family: 'Roboto', weights: [300, 400, 500, 700] },
  { family: 'Open Sans', weights: [300, 400, 500, 600, 700, 800] },
  { family: 'Montserrat', weights: [300, 400, 500, 600, 700, 800, 900] },
  { family: 'Poppins', weights: [300, 400, 500, 600, 700] },
  { family: 'Lato', weights: [300, 400, 700, 900] },
  { family: 'Raleway', weights: [300, 400, 500, 600, 700, 800] },
  { family: 'Nunito', weights: [300, 400, 500, 600, 700, 800, 900] },
  { family: 'Nunito Sans', weights: [300, 400, 500, 600, 700, 800, 900] },
  { family: 'Source Sans 3', weights: [300, 400, 500, 600, 700] },
  { family: 'Figtree', weights: [300, 400, 500, 600, 700, 800] },
  { family: 'Plus Jakarta Sans', weights: [300, 400, 500, 600, 700, 800] },
  { family: 'DM Sans', weights: [400, 500, 700] },
  { family: 'Manrope', weights: [300, 400, 500, 600, 700, 800] },
  { family: 'Be Vietnam Pro', weights: [300, 400, 500, 600, 700, 800] },
  { family: 'Lexend', weights: [300, 400, 500, 600, 700] },
  { family: 'Merriweather', weights: [300, 400, 700, 900] },
  { family: 'Playfair Display', weights: [400, 500, 600, 700, 800, 900] },
  { family: 'Lora', weights: [400, 500, 600, 700] },
  { family: 'Source Serif 4', weights: [300, 400, 500, 600, 700] },
  { family: 'Libre Baskerville', weights: [400, 700] },
  { family: 'Crimson Text', weights: [400, 600, 700] },
  { family: 'Cormorant Garamond', weights: [300, 400, 500, 600, 700] },
  { family: 'Noto Serif', weights: [400, 700] },
  { family: 'Zilla Slab', weights: [300, 400, 500, 600, 700] },
  { family: 'Bebas Neue', weights: [400] },
  { family: 'Oswald', weights: [300, 400, 500, 600, 700] },
  { family: 'Anton', weights: [400] },
  { family: 'Abril Fatface', weights: [400] },
  { family: 'Lobster', weights: [400] },
  { family: 'Pacifico', weights: [400] },
  { family: 'Righteous', weights: [400] },
  { family: 'Permanent Marker', weights: [400] },
  { family: 'Caveat', weights: [400, 500, 600, 700] },
  { family: 'Shadows Into Light', weights: [400] },
  { family: 'Dancing Script', weights: [400, 500, 600, 700] },
  { family: 'Great Vibes', weights: [400] },
  { family: 'JetBrains Mono', weights: [300, 400, 500, 600, 700, 800] },
  { family: 'Fira Code', weights: [300, 400, 500, 600, 700] },
  { family: 'Source Code Pro', weights: [300, 400, 500, 600, 700] },
  { family: 'IBM Plex Mono', weights: [300, 400, 500, 600, 700] },
  { family: 'Space Mono', weights: [400, 700] },
  { family: 'Courier Prime', weights: [400, 700] },
  { family: 'Roboto Condensed', weights: [300, 400, 500, 600, 700] },
  { family: 'Archivo Narrow', weights: [400, 500, 600, 700] },
  { family: 'Barlow Condensed', weights: [300, 400, 500, 600, 700] },
  { family: 'Bodoni Moda', weights: [400, 500, 600, 700, 800, 900] },
  { family: 'Prata', weights: [400] },
  { family: 'Fjalla One', weights: [400] },
  { family: 'Rozha One', weights: [400] },
];

interface HasFontFamily {
  fontFamily?: string;
  fontWeight?: number;
  richText?: Array<{ fontFamily?: string; fontWeight?: number }>;
}

@Injectable()
export class FontLoaderService {
  private readonly _logger = new Logger(FontLoaderService.name);
  // Map caches font families per org; concurrency-safe only under single-threaded renders.
  private readonly _cache = new Map<string, FontCacheEntry>();
  private readonly _curatedLoaded = new Set<string>();
  // family → failure timestamp. A failed Google Fonts fetch is retried after
  // CURATED_RETRY_MS instead of blacklisting the family for the process
  // lifetime; the current render still falls back to sans-serif.
  private static readonly CURATED_RETRY_MS = 15 * 60_000;
  private readonly _curatedFailed = new Map<string, number>();
  private readonly _tempDir = path.join(os.tmpdir(), 'postmill-fonts');
  /**
   * Font file locations: `org:<orgId>:<family>|<weight>` for per-org custom
   * fonts, `g:<family>|<weight>` for curated Google fonts.
   *
   * The loader downloads every font a render uses and then only hands it to
   * node-canvas; nothing could ask WHERE a family lives. Convert-to-outlines
   * needs the file itself, because glyph contours come from the font's own
   * tables and no canvas API exposes them.
   *
   * The org prefix is load-bearing: this map is process-wide, and without it
   * org A's uploaded brand font would be resolvable — and outline-able — by
   * any org that guessed its family name. Curated fonts are public and shared.
   */
  private readonly _files = new Map<string, string>();
  /**
   * Bound on the process-wide `_cache`/`_files` maps (see `boundedCacheSet`).
   * Note: `registerFont` itself is GLOBAL in node-canvas — a family registered
   * for one org is resolvable by name process-wide (glyphs only; the file path
   * stays org-scoped via `_files`). That is an accepted tradeoff: family names
   * collide harmlessly across tenants, and there is no unregister API to pair
   * with eviction.
   */
  private static readonly MAX_FONT_CACHE_ENTRIES = 500;
  private _dirEnsured = false;

  constructor(private _brandsService: BrandsService) {}

  async loadOrgFonts(orgId: string): Promise<void> {
    const fonts = await this._brandsService.getCustomFonts(orgId);
    if (!fonts.length) return;

    await this._ensureTempDir();

    for (const font of fonts) {
      const cacheKey = `${orgId}:${font.fileId}`;
      if (this._cache.has(cacheKey)) continue;

      try {
        const res = await safeFetch(font.path);
        if (!res.ok) {
          this._logger.warn(`Failed to download font ${font.family}: ${res.status}`);
          continue;
        }
        const buffer = Buffer.from(await res.arrayBuffer());
        let ext = '.ttf';
        try {
          ext = path.extname(new URL(font.path).pathname) || '.ttf';
        } catch {
          const match = font.path.match(/\.(\w{2,5})(\?|$)/);
          if (match) ext = '.' + match[1];
        }
        const tmpPath = path.join(this._tempDir, `${safeFileId(font.fileId)}${ext}`);
        await fs.writeFile(tmpPath, buffer);

        registerFont(tmpPath, { family: font.family, weight: String(font.weights?.[0] || '400') });

        boundedCacheSet(
          this._cache,
          cacheKey,
          { family: font.family, filePath: tmpPath },
          FontLoaderService.MAX_FONT_CACHE_ENTRIES
        );
        boundedCacheSet(
          this._files,
          `org:${orgId}:${font.family}|${font.weights?.[0] || 400}`,
          tmpPath,
          FontLoaderService.MAX_FONT_CACHE_ENTRIES
        );
        this._logger.log(`Registered font ${font.family} for org ${orgId}`);
      } catch (err) {
        this._logger.warn(`Failed to register font ${font.family}: ${(err as Error)?.message}`);
      }
    }
  }

  async preregisterDefaultWeights(orgId: string, fontFamily: string, weights: number[]): Promise<void> {
    const fonts = await this._brandsService.getCustomFonts(orgId);
    const font = fonts.find((f: any) => f.family === fontFamily);
    if (!font) return;

    await this._ensureTempDir();

    for (const weight of weights) {
      const cacheKey = `${orgId}:${font.fileId}:${weight}`;
      if (this._cache.has(cacheKey)) continue;

      if (weight === (font.weights?.[0] || 400)) continue;

      try {
        const res = await safeFetch(font.path);
        if (!res.ok) continue;
        const buffer = Buffer.from(await res.arrayBuffer());
        let ext = '.ttf';
        try {
          ext = path.extname(new URL(font.path).pathname) || '.ttf';
        } catch {
          const match = font.path.match(/\.(\w{2,5})(\?|$)/);
          if (match) ext = '.' + match[1];
        }
        const tmpPath = path.join(this._tempDir, `${safeFileId(font.fileId)}_${weight}${ext}`);
        await fs.writeFile(tmpPath, buffer);

        registerFont(tmpPath, { family: font.family, weight: String(weight) });

        boundedCacheSet(
          this._cache,
          cacheKey,
          { family: font.family, filePath: tmpPath },
          FontLoaderService.MAX_FONT_CACHE_ENTRIES
        );
        boundedCacheSet(
          this._files,
          `org:${orgId}:${font.family}|${weight}`,
          tmpPath,
          FontLoaderService.MAX_FONT_CACHE_ENTRIES
        );
      } catch (err) {
        this._logger.warn(`Failed to register font weight ${weight} for ${fontFamily}: ${(err as Error)?.message}`);
      }
    }
  }

  // Register curated Designer fonts that are actually used in the rendered
  // document. Fonts are downloaded from Google Fonts on demand and cached in
  // the process temp dir. Failures are logged but do not break the render.
  async loadCuratedFonts(elements: HasFontFamily[]): Promise<void> {
    const used = new Map<string, Set<number>>();
    for (const el of elements) {
      if (!el) continue;
      this._collectFontUsage(el, used);
      for (const run of el.richText || []) {
        this._collectFontUsage(run, used);
      }
    }

    if (used.size === 0) return;
    await this._ensureTempDir();

    for (const [family, weights] of used) {
      if (this._curatedLoaded.has(family)) continue;
      const failedAt = this._curatedFailed.get(family);
      if (
        failedAt !== undefined &&
        Date.now() - failedAt < FontLoaderService.CURATED_RETRY_MS
      ) {
        continue;
      }
      await this._loadCuratedFontFamily(family, Array.from(weights));
    }
  }

  private _collectFontUsage(
    item: { fontFamily?: string; fontWeight?: number },
    used: Map<string, Set<number>>,
  ): void {
    const family = item.fontFamily;
    if (!family) return;
    // The catalog is the allowlist, not a curated shortlist: the picker can
    // reach every family Google serves, and one missing here would silently
    // export in a fallback face. It still gates the fetch — the family name
    // goes into a URL, so it is checked rather than trusted.
    if (!isCatalogFamily(family)) return;
    if (!used.has(family)) used.set(family, new Set());
    used.get(family)!.add(item.fontWeight ?? 400);
  }

  private async _loadCuratedFontFamily(family: string, weights: number[]): Promise<void> {
    if (!isCatalogFamily(family)) return;

    // Narrowed to the weights Google actually serves for this family: asking
    // for one it does not have 400s the whole request.
    const toLoad = catalogWeights(family, weights);
    if (!toLoad.length) return;
    const cssUrl = googleFontsUrl(family, toLoad);

    try {
      const res = await safeFetch(cssUrl);
      if (!res.ok) {
        this._logger.warn(`Failed to fetch curated font CSS for ${family}: ${res.status}`);
        this._curatedFailed.set(family, Date.now());
        return;
      }

      const css = await res.text();
      const faceBlocks = css.match(/@font-face\s*\{[^}]+\}/g) || [];
      if (faceBlocks.length === 0) {
        this._curatedFailed.set(family, Date.now());
        return;
      }

      let registeredAny = false;
      for (const block of faceBlocks) {
        const faceFamily = this._extractCssValue(block, 'font-family');
        const faceWeight = this._extractCssValue(block, 'font-weight');
        const srcUrl = this._extractFirstUrl(block);
        if (!faceFamily || !srcUrl) continue;

        const fileRes = await safeFetch(srcUrl);
        if (!fileRes.ok) continue;

        const buffer = Buffer.from(await fileRes.arrayBuffer());
        const ext = path.extname(new URL(srcUrl).pathname) || '.woff2';
        const safeFamily = family.replace(/[^a-zA-Z0-9]/g, '_');
        const tmpPath = path.join(
          this._tempDir,
          `curated_${safeFamily}_${faceWeight || '400'}_${this._hash(srcUrl)}${ext}`,
        );
        await fs.writeFile(tmpPath, buffer);

        registerFont(tmpPath, {
          family: faceFamily.replace(/['"]/g, ''),
          weight: faceWeight || '400',
        });
        boundedCacheSet(
          this._files,
          `g:${family}|${faceWeight || 400}`,
          tmpPath,
          FontLoaderService.MAX_FONT_CACHE_ENTRIES
        );
        registeredAny = true;
      }

      if (registeredAny) {
        this._curatedLoaded.add(family);
        this._curatedFailed.delete(family);
        this._logger.log(`Registered curated font ${family}`);
      } else {
        this._curatedFailed.set(family, Date.now());
        this._logger.warn(`No font files could be registered for curated family ${family}`);
      }
    } catch (err) {
      this._curatedFailed.set(family, Date.now());
      this._logger.warn(`Failed to register curated font ${family}: ${(err as Error)?.message}`);
    }
  }

  /**
   * The file backing one family + weight, downloading it first if need be.
   *
   * Returns null for a family that could not be fetched, and for a WOFF2 —
   * whose tables are Brotli-compressed, so an outline parser would read
   * nonsense. Saying "not available" beats emitting wrong glyphs.
   */
  async resolveFontFile(
    orgId: string,
    family: string,
    weight = 400,
  ): Promise<string | null> {
    // The requesting org's own fonts, then the public curated set — NEVER
    // another org's uploads, which share this process-wide map.
    const prefixes = [`org:${orgId}:`, 'g:'];
    const lookup = (): string | undefined => {
      for (const prefix of prefixes) {
        const exact = this._files.get(`${prefix}${family}|${weight}`);
        if (exact) return exact;
      }
      // Fall back to any weight of the family — better the regular cut than
      // nothing at all.
      for (const prefix of prefixes) {
        const any = [...this._files.entries()].find(([k]) =>
          k.startsWith(`${prefix}${family}|`)
        );
        if (any) return any[1];
      }
      return undefined;
    };

    if (!lookup()) await this.loadOrgFonts(orgId).catch(() => undefined);
    if (!lookup()) {
      await this.loadCuratedFonts([{ fontFamily: family, fontWeight: weight }]).catch(
        () => undefined,
      );
    }
    const found = lookup();
    if (!found) return null;
    return /\.(ttf|otf)$/i.test(found) ? found : null;
  }

  private _extractCssValue(block: string, property: string): string | undefined {
    const regex = new RegExp(`${property}:\\s*([^;]+);`);
    const match = block.match(regex);
    return match?.[1]?.trim();
  }

  private _extractFirstUrl(block: string): string | undefined {
    const match = block.match(/url\(([^)]+)\)/);
    if (!match) return undefined;
    return match[1].replace(/['"]/g, '');
  }

  private _hash(input: string): string {
    let h = 0;
    for (let i = 0; i < input.length; i++) {
      h = (h << 5) - h + input.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h).toString(16);
  }

  private async _ensureTempDir(): Promise<void> {
    if (this._dirEnsured) return;
    await fs.mkdir(this._tempDir, { recursive: true });
    this._dirEnsured = true;
  }
}
