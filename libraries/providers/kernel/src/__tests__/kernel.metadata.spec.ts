import { describe, it, expect } from 'vitest';
import { ProviderKernel } from '../kernel';
import { providerModules } from '@gitroom/backend/providers.generated';
import {
  AI_MODEL_CATEGORIES,
  AI_MEDIA_CATEGORIES,
} from '@gitroom/nestjs-libraries/ai/defaults/default-categories';
import { LANGUAGE_CODES } from '../domains/languages';

// Orchestration categories have no model catalog by design — they reuse another
// operation's pipeline (image-slide/image-focal-point → the image pipeline,
// video-caption → STT). Mirrored verbatim from the completeness gate in
// libraries/nestjs-libraries/src/ai/defaults/media-defaults-completeness.spec.ts;
// keep the two lists in lockstep.
const ORCHESTRATION_CATEGORIES = new Set([
  'image-focal-point',
  'image-slide',
  'video-caption',
]);

describe('ProviderKernel metadata conformance', () => {
  const kernel = new ProviderKernel();
  for (const mod of providerModules) {
    kernel.register(mod);
  }

  it('registers the real provider set', () => {
    expect(providerModules.length).toBeGreaterThan(0);
    expect(kernel.listManifests().length).toBe(providerModules.length);
  });

  it('returns metadata via getMetadata for a sample provider', () => {
    const ai = kernel.getMetadata('ai', 'openai', 'v1');
    expect(ai).toBeDefined();
    expect(ai?.id).toBe('openai');

    const media = kernel.getMetadata('media', 'openai', 'v1');
    expect(media).toBeDefined();
    expect(media?.id).toBe('openai');
  });

  it('includes metadata in listManifests results', () => {
    const manifests = kernel.listManifests();
    const withMetadata = manifests.filter((m) => m.metadata);
    expect(withMetadata.length).toBe(providerModules.length);
  });

  describe.each(providerModules)(
    '$manifest.domain/$manifest.providerId@$manifest.version',
    (mod) => {
      it('has metadata whose id matches the manifest providerId', () => {
        expect(mod.metadata, 'module.metadata must be defined').toBeDefined();
        expect(mod.metadata!.id).toBe(mod.manifest.providerId);
      });

      it('declares only known model categories', () => {
        const declared = mod.metadata?.modelCategories ?? [];
        for (const cat of declared) {
          expect(
            AI_MODEL_CATEGORIES,
            `unknown model category: ${cat}`,
          ).toContain(cat);
        }
      });

      it('declares only known media categories', () => {
        const declared = mod.metadata?.mediaCategories ?? [];
        for (const cat of declared) {
          expect(
            AI_MEDIA_CATEGORIES,
            `unknown media category: ${cat}`,
          ).toContain(cat);
        }
      });

      it('backs every declared media category with a model catalog', () => {
        const declared = mod.metadata?.mediaCategories ?? [];
        for (const cat of declared) {
          // Orchestration categories are model-less by design (see set above).
          if (ORCHESTRATION_CATEGORIES.has(cat)) continue;
          const hasStaticModels = (mod.metadata?.mediaModels?.[cat]?.length ?? 0) > 0;
          const canEnumerate =
            mod.metadata?.hasModelList === true ||
            mod.metadata?.kind === 'action';
          expect(
            hasStaticModels || canEnumerate,
            `media category '${cat}' is declared but has no static models and no live enumeration`,
          ).toBe(true);
        }
      });

      it('has well-formed mediaModels when present', () => {
        const models = mod.metadata?.mediaModels ?? {};
        const allowedFieldTypes = new Set(['select', 'number', 'toggle', 'text']);
        for (const [category, list] of Object.entries(models)) {
          expect(Array.isArray(list), `mediaModels[${category}] must be an array`).toBe(true);
          for (const m of list) {
            expect(typeof m.id, 'model id must be a string').toBe('string');
            expect(m.id.length, 'model id must be non-empty').toBeGreaterThan(0);
            expect(typeof m.label, 'model label must be a string').toBe('string');
            const fields = m.fields ?? [];
            expect(Array.isArray(fields), 'model fields must be an array').toBe(true);
            for (const f of fields) {
              expect(typeof f.name, 'field name must be a string').toBe('string');
              expect(allowedFieldTypes.has(f.type), `unknown field type: ${f.type}`).toBe(true);
              if (f.type === 'select') {
                expect(Array.isArray(f.options), 'select field must have options array').toBe(true);
                expect(f.options.length, 'select field options must not be empty').toBeGreaterThan(0);
              }
            }
          }
        }
      });

      it('uses known language codes for localized description', () => {
        const description = mod.metadata?.description ?? {};
        for (const code of Object.keys(description)) {
          expect(
            LANGUAGE_CODES,
            `unknown language code in description: ${code}`,
          ).toContain(code);
        }
      });
    },
  );
});
