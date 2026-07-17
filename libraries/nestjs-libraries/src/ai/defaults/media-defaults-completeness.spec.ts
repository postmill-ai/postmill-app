import { describe, it, expect } from 'vitest';
import type { ProviderMetadata } from '@gitroom/provider-kernel';

/**
 * Plan §6.1 — Media-defaults completeness gate.
 *
 * For every registered media provider P (metadata.domains includes 'media') and
 * each declared media category C in P.mediaCategories, the category must have a
 * resolvable model source, i.e. ANY of:
 *   1. C is an orchestration category (no model list by design), OR
 *   2. P is `kind: 'action'` — model-less by design. The catalog
 *      (`media-defaults.controller.ts`: `if (c.metadata.kind === 'action')`) emits a
 *      provider-level option (no model) and the resolver returns `model: null`, so EVERY
 *      category an action provider declares is sourced via that provider-level option.
 *      This subsumes the avatar/caption action providers (HeyGen/D-ID/Hedra/Tavus →
 *      video-avatar, Deepgram → video-caption) AND single-endpoint generators that take
 *      no model param (Ideogram → text/image-to-image, Reel.Farm → text/image-to-video).
 *      Every model-BEARING provider is `kind: 'direct'` or `'hub'`, so this exemption can
 *      never hide a provider that ought to declare `mediaModels`. OR
 *   3. P declares a non-empty static `mediaModels[C]` catalog, OR
 *   4. P is one of the live-`listModels` hubs (catalog is fetched at runtime).
 * Otherwise the provider declares a model-category with no source — FAIL.
 *
 * Enumeration mirrors the generator (`scripts/generate-studio-descriptor-registry.mjs`),
 * which scans `libraries/providers/*\/src/v1/metadata.ts`. We do the same here with
 * Vite's `import.meta.glob` rather than booting the Nest kernel (no DI needed — the
 * metadata is static truth authored per package), and filter to `domains: ['media']`.
 */

// Sets mirrored verbatim from the generator's completeness logic.
const ORCHESTRATION_CATEGORIES = new Set([
  'image-focal-point',
  'image-slide',
  'video-caption',
]);

// The explicit 9 live-`listModels` hubs (NOT the `hasModelList` flag).
const LIVE_LISTMODELS_HUBS = new Set([
  'deepinfra',
  'fireworks',
  'gateway',
  'genviral',
  'groq',
  'openrouter',
  'siliconflow',
  'togetherai',
  'xai',
]);

const metadataModules = import.meta.glob<{ metadata: ProviderMetadata }>(
  '../../../../providers/*/src/v1/metadata.ts',
  { eager: true },
);

const mediaProviders: ProviderMetadata[] = Object.values(metadataModules)
  .map((m) => m.metadata)
  .filter((md): md is ProviderMetadata => !!md && (md.domains ?? []).includes('media'));

function hasModelSource(md: ProviderMetadata, category: string): boolean {
  if (ORCHESTRATION_CATEGORIES.has(category)) return true;
  // Action providers are model-less by design — the catalog gives them a provider-level
  // option (no model) for every category they declare. (Mirrors the runtime
  // `if (c.metadata.kind === 'action')` branch in media-defaults.controller.ts.)
  if (md.kind === 'action') return true;
  const models = md.mediaModels?.[category];
  if (Array.isArray(models) && models.length > 0) return true;
  if (LIVE_LISTMODELS_HUBS.has(md.id)) return true;
  return false;
}

describe('Media defaults completeness (plan §6.1)', () => {
  it('enumerates the registered media providers', () => {
    // Sanity: the glob actually resolved real provider metadata.
    expect(mediaProviders.length).toBeGreaterThan(20);
    expect(mediaProviders.some((md) => md.id === 'openai')).toBe(true);
  });

  it('every declared media category resolves to a model source', () => {
    const violations: string[] = [];
    for (const md of mediaProviders) {
      for (const category of md.mediaCategories ?? []) {
        if (!hasModelSource(md, category)) {
          violations.push(
            `${md.id} declares media category '${category}' with no model source`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
