import { describe, it, expect } from 'vitest';
import type {
  ProviderMetadata,
  ModelField,
  MediaModelDef,
} from '@gitroom/provider-kernel';
import { LANGUAGE_CODES } from '@gitroom/provider-kernel';
import { languages } from '@gitroom/react-shared-libraries/translation/i18n.config';

/**
 * Plan §6.2 — Media-model schema well-formedness.
 *
 * Every `MediaModelDef` in a media provider's `mediaModels` catalog must be
 * well-formed (string id/label; each field a valid `ModelField`), every provider
 * that ships a `description` must carry a non-empty `description.en`, and
 * `LANGUAGE_CODES` must stay in lockstep with the UI i18n `languages` list.
 *
 * Enumeration mirrors the generator: glob `libraries/providers/*\/src/v1/metadata.ts`
 * and keep `domains: ['media']`.
 *
 * Note: an EMPTY `fields` array is VALID (well-formed) — e.g. replicate's snapshot
 * was generated without an API token, so its model fields are intentionally empty.
 */

const VALID_FIELD_TYPES = new Set<ModelField['type']>([
  'select',
  'number',
  'toggle',
  'text',
]);

const metadataModules = import.meta.glob<{ metadata: ProviderMetadata }>(
  '../../../../providers/*/src/v1/metadata.ts',
  { eager: true },
);

const mediaProviders: ProviderMetadata[] = Object.values(metadataModules)
  .map((m) => m.metadata)
  .filter((md): md is ProviderMetadata => !!md && (md.domains ?? []).includes('media'));

function checkField(loc: string, field: ModelField, errors: string[]) {
  if (!VALID_FIELD_TYPES.has(field.type)) {
    errors.push(`${loc}: invalid field type '${String(field.type)}'`);
  }
  if (typeof field.name !== 'string' || field.name.length === 0) {
    errors.push(`${loc}: field has empty/non-string name`);
  }
  if (field.type === 'select') {
    if (!Array.isArray(field.options) || field.options.length === 0) {
      errors.push(`${loc}: select field '${field.name}' missing options array`);
    } else {
      for (const opt of field.options) {
        if (typeof opt?.value !== 'string' || typeof opt?.label !== 'string') {
          errors.push(
            `${loc}: select field '${field.name}' has a malformed option`,
          );
        }
      }
    }
  }
  for (const key of ['min', 'max', 'step'] as const) {
    if (field[key] !== undefined && typeof field[key] !== 'number') {
      errors.push(`${loc}: field '${field.name}' ${key} is not a number`);
    }
  }
  if (
    typeof field.min === 'number' &&
    typeof field.max === 'number' &&
    field.min > field.max
  ) {
    errors.push(`${loc}: field '${field.name}' has min > max`);
  }
}

function checkModelDef(loc: string, def: MediaModelDef, errors: string[]) {
  if (typeof def.id !== 'string' || def.id.length === 0) {
    errors.push(`${loc}: model def has empty/non-string id`);
  }
  if (typeof def.label !== 'string' || def.label.length === 0) {
    errors.push(`${loc} (${def.id}): model def has empty/non-string label`);
  }
  if (def.fields !== undefined) {
    if (!Array.isArray(def.fields)) {
      errors.push(`${loc} (${def.id}): fields is not an array`);
      return;
    }
    // An empty fields array is valid (well-formed) — see replicate note above.
    def.fields.forEach((field, i) =>
      checkField(`${loc} (${def.id}).fields[${i}]`, field, errors),
    );
  }
}

describe('Media model schema well-formedness (plan §6.2)', () => {
  it('enumerates the registered media providers', () => {
    expect(mediaProviders.length).toBeGreaterThan(20);
  });

  it('every MediaModelDef and ModelField is well-formed', () => {
    const errors: string[] = [];
    for (const md of mediaProviders) {
      const mediaModels = md.mediaModels ?? {};
      for (const [category, defs] of Object.entries(mediaModels)) {
        if (!Array.isArray(defs)) {
          errors.push(`${md.id}.mediaModels['${category}'] is not an array`);
          continue;
        }
        defs.forEach((def, i) =>
          checkModelDef(`${md.id}.mediaModels['${category}'][${i}]`, def, errors),
        );
      }
    }
    expect(errors).toEqual([]);
  });

  it('every provider with a description has a non-empty description.en', () => {
    const errors: string[] = [];
    for (const md of mediaProviders) {
      if (md.description === undefined) continue;
      if (typeof md.description.en !== 'string' || md.description.en.length === 0) {
        errors.push(`${md.id}: description present but description.en is empty`);
      }
    }
    expect(errors).toEqual([]);
  });

  it('LANGUAGE_CODES matches the UI i18n languages exactly', () => {
    expect(LANGUAGE_CODES).toEqual(languages);
  });
});
