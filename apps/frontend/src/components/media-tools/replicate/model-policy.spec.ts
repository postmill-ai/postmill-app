import { describe, expect, it } from 'vitest';
import { schemaWithModelPolicy, validateModelInput } from './model-policy';
import { missingRequiredFields } from './use-generate';

const videoSchema = {
  properties: {
    prompt: { type: 'string' },
    duration: { type: 'integer', minimum: 2, maximum: 12, default: 6 },
  },
};

describe('Replicate model input policy', () => {
  it.each([
    ['google/veo-3.1', [4, 6, 8], 8],
    ['bytedance/seedance-1-pro', [5, 10], 5],
    ['kwaivgi/kling-v2.5-turbo-pro', [5, 10], 5],
  ])('applies the duration contract for %s', (modelId, choices, defaultValue) => {
    const schema = schemaWithModelPolicy(modelId, videoSchema)!;
    expect(schema.properties?.duration).toMatchObject({
      type: 'integer',
      enum: choices,
      default: defaultValue,
    });
    expect(schema.properties?.duration?.minimum).toBeUndefined();
    expect(schema.properties?.duration?.maximum).toBeUndefined();
  });

  it('shows Video-01 fixed duration without adding a submittable default', () => {
    const schema = schemaWithModelPolicy('minimax/video-01', { properties: {} })!;
    expect(schema.properties?.duration?.default).toBeUndefined();
    expect(validateModelInput('minimax/video-01', { duration: 6 })).toMatch('fixed duration');
  });

  it('accepts supported durations and numeric strings, rejecting legacy values', () => {
    expect(validateModelInput('google/veo-3.1', { duration: '6' })).toBeNull();
    expect(validateModelInput('bytedance/seedance-1-pro', { duration: 10 })).toBeNull();
    expect(validateModelInput('bytedance/seedance-1-pro', { duration: 6 })).toMatch('5 or 10');
    expect(validateModelInput('kwaivgi/kling-v2.5-turbo-pro', { duration: 2 })).toMatch('5 or 10');
  });

  it('treats empty references as unset and enforces Veo reference mode', () => {
    expect(validateModelInput('google/veo-3.1', { reference_images: [] })).toBeNull();
    expect(validateModelInput('google/veo-3.1', { reference_images: 'one,two' })).toMatch('array');
    expect(
      validateModelInput('google/veo-3.1', {
        reference_images: [{ fileId: 'f1' }],
        aspect_ratio: '9:16',
        duration: 8,
      })
    ).toMatch('16:9');
    expect(
      validateModelInput('google/veo-3.1', {
        reference_images: [{ fileId: 'f1' }],
        aspect_ratio: '16:9',
        duration: 6,
      })
    ).toMatch('8-second');
    expect(
      validateModelInput('google/veo-3.1', {
        reference_images: [{ fileId: 'f1' }],
        aspect_ratio: '16:9',
        duration: 8,
        last_frame: { fileId: 'last' },
      })
    ).toMatch('cannot be combined');
  });

  it('counts an empty required array as missing', () => {
    expect(
      missingRequiredFields({ required: ['reference_images'] }, { reference_images: [] })
    ).toEqual(['reference_images']);
    expect(
      missingRequiredFields(
        { required: ['reference_images'] },
        { reference_images: [{ fileId: 'f1' }] }
      )
    ).toEqual([]);
  });
});
