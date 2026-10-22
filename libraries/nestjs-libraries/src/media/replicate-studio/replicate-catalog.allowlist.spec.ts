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

  // Category-curation guards. The allowlist is the single source of truth for
  // the Replicate studio's picker; a model filed under the wrong category
  // produces a picker that asks for the wrong source media and a generation
  // that 422s.
  it('keeps the strictly-image-to-video kling-v2.1 OUT of text-to-video', () => {
    // Live Replicate schema: kwaivgi/kling-v2.1 REQUIRES `start_image` — it can
    // never serve a prompt-only text-to-video call.
    expect(MODEL_ALLOWLIST['text-to-video']).not.toContain('kwaivgi/kling-v2.1');
    expect(MODEL_ALLOWLIST['image-to-video']).toContain('kwaivgi/kling-v2.1');
    // The t2v-capable Kling (verified live: only `prompt` is required) is the
    // text-to-video entry.
    expect(MODEL_ALLOWLIST['text-to-video']).toContain('kwaivgi/kling-v2.5-turbo-pro');
  });

  it('keeps the retired google/veo-3 OUT of the catalog in favor of google/veo-3.1', () => {
    // veo-3 was retired upstream (prod jobs 404'd from aiplatform.googleapis.com).
    const allAllowlisted = new Set(Object.values(MODEL_ALLOWLIST).flat());
    expect(allAllowlisted.has('google/veo-3')).toBe(false);
    expect(MODEL_ALLOWLIST['text-to-video']).toContain('google/veo-3.1');
    expect(OFFICIAL_MODELS.has('google/veo-3.1')).toBe(true);
    expect(OFFICIAL_MODELS.has('google/veo-3')).toBe(false);
  });

  it('lists only models with a real `video` input under video-to-video', () => {
    // seedance-1-pro has no video input (t2v/i2v only) — the picker asked for
    // an IMAGE and generation 422'd. wan-2.7-videoedit takes a required `video`
    // uri input (verified against the live Replicate schema); the picker's
    // inferAcceptType keys off the field name containing "video".
    expect(MODEL_ALLOWLIST['video-to-video']).toEqual(['wan-video/wan-2.7-videoedit']);
    expect(MODEL_ALLOWLIST['video-to-video']).not.toContain('bytedance/seedance-1-pro');
  });
});
