import { describe, it, expect } from 'vitest';
import {
  CATEGORIES,
  MODEL_ALLOWLIST,
  OFFICIAL_MODELS,
} from './replicate-catalog.allowlist';

describe('Replicate catalog allowlist', () => {
  it('has 19 categories', () => {
    expect(CATEGORIES).toHaveLength(19);
  });

  it('has at least one model in every non-local category', () => {
    const nonLocal = CATEGORIES.filter((c) => c.execution !== 'local');
    for (const category of nonLocal) {
      const models = MODEL_ALLOWLIST[category.key];
      expect(models?.length ?? 0).toBeGreaterThanOrEqual(1);
    }
  });

  it('includes every OFFICIAL_MODELS id in MODEL_ALLOWLIST', () => {
    const allAllowlisted = new Set(Object.values(MODEL_ALLOWLIST).flat());
    for (const officialId of OFFICIAL_MODELS) {
      expect(allAllowlisted.has(officialId)).toBe(true);
    }
  });
});
