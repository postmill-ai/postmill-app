import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DefaultsSettingsValidator } from './defaults-settings.validator';

function makeValidator(metadata?: Record<string, unknown>) {
  const kernel = {
    getMetadata: vi.fn().mockImplementation((domain: string, providerId: string, version: string) => {
      return metadata?.[`${domain}:${providerId}:${version}`];
    }),
    latestActiveVersion: vi.fn().mockReturnValue('v1'),
  };
  return {
    validator: new DefaultsSettingsValidator(kernel as never),
    kernel,
  };
}

describe('DefaultsSettingsValidator', () => {
  let validator: DefaultsSettingsValidator;

  beforeEach(() => {
    ({ validator } = makeValidator());
  });

  describe('ai domain', () => {
    it('allows standard inference tunables and strips prompt', () => {
      expect(
        validator.validate('ai', 'low-reasoning', {
          prompt: 'ignored',
          temperature: 0.7,
          maxTokens: 100,
        }),
      ).toEqual({ temperature: 0.7, maxTokens: 100 });
    });

    it('rejects an unknown ai key', () => {
      expect(() =>
        validator.validate('ai', 'low-reasoning', { unknownKey: 'x' }),
      ).toThrowError(/Unknown ai default setting key/);
    });

    it('rejects model nested inside settings', () => {
      expect(() =>
        validator.validate('ai', 'low-reasoning', { model: 'gpt-4.1' }),
      ).toThrowError(/'model' must be provided as a top-level field/);
    });
  });

  describe('media domain — operation-scoped (F-4)', () => {
    it('accepts an image tunable for an image category', () => {
      expect(
        validator.validate('media', 'text-to-image', { cfg_scale: 7, width: 1024 }),
      ).toEqual({ cfg_scale: 7, width: 1024 });
    });

    it('rejects an image-only tunable for an audio category', () => {
      expect(() =>
        validator.validate('media', 'text-to-speech', { cfg_scale: 7 }),
      ).toThrowError(/Unknown media default setting key for category 'text-to-speech'/);
    });

    it('accepts an audio tunable for an audio category', () => {
      expect(
        validator.validate('media', 'text-to-speech', { voice: 'alloy', speed: 1.2 }),
      ).toEqual({ voice: 'alloy', speed: 1.2 });
    });

    it('rejects an audio-only tunable for an image category', () => {
      expect(() =>
        validator.validate('media', 'text-to-image', { voice: 'alloy' }),
      ).toThrowError(/Unknown media default setting key for category 'text-to-image'/);
    });

    it('accepts caption/STT tunables for video-caption only', () => {
      expect(
        validator.validate('media', 'video-caption', { smart_format: true, language: 'en' }),
      ).toEqual({ smart_format: true, language: 'en' });
      expect(() =>
        validator.validate('media', 'text-to-video', { smart_format: true }),
      ).toThrowError(/Unknown media default setting key for category 'text-to-video'/);
    });

    it('accepts video duration/fps for a video category', () => {
      expect(
        validator.validate('media', 'text-to-video', { duration: 5, fps: 24 }),
      ).toEqual({ duration: 5, fps: 24 });
    });

    it('strips prompt and rejects nested model for media too', () => {
      expect(validator.validate('media', 'text-to-image', { prompt: 'x', seed: 1 })).toEqual({
        seed: 1,
      });
      expect(() =>
        validator.validate('media', 'text-to-image', { model: 'sd3' }),
      ).toThrowError(/'model' must be provided as a top-level field/);
    });
  });

  describe('media domain — descriptor-aware (P7.3)', () => {
    it('accepts declared provider+operation fields', () => {
      expect(
        validator.validate(
          'media',
          'text-to-image',
          { seed: 42, prompt_extend: true, size: '1024x1024' },
          { providerId: 'qwen' },
        ),
      ).toEqual({ seed: 42, prompt_extend: true, size: '1024x1024' });
    });

    it('strips prompt when a descriptor is used', () => {
      expect(
        validator.validate(
          'media',
          'text-to-image',
          { prompt: 'ignored', size: '1024x1024' },
          { providerId: 'qwen' },
        ),
      ).toEqual({ size: '1024x1024' });
    });

    it('rejects a key not declared in the provider descriptor', () => {
      expect(() =>
        validator.validate(
          'media',
          'text-to-image',
          { cfg_scale: 7 },
          { providerId: 'qwen' },
        ),
      ).toThrowError(/Unknown media default setting key for category 'text-to-image'/);
    });

    it('picks the tab matching the fixed model id', () => {
      expect(
        validator.validate(
          'media',
          'text-to-image',
          { size: '1024x1024', style: 'vivid' },
          { providerId: 'openai', model: 'dall-e-3' },
        ),
      ).toEqual({ size: '1024x1024', style: 'vivid' });

      // `background` only exists on the gpt-image-1 tab.
      expect(() =>
        validator.validate(
          'media',
          'text-to-image',
          { background: 'transparent' },
          { providerId: 'openai', model: 'dall-e-3' },
        ),
      ).toThrowError(/Unknown media default setting key for category 'text-to-image'/);
    });

    it('excludes media-input fields from the allowed set', () => {
      expect(() =>
        validator.validate(
          'media',
          'image-to-video',
          { start_image_url: 'https://example.com/img.png' },
          { providerId: 'luma' },
        ),
      ).toThrowError(/Unknown media default setting key for category 'image-to-video'/);
    });

    it('validates against metadata model fields when no descriptor exists', () => {
      const { validator: v } = makeValidator({
        'media:replicate:v1': {
          mediaModels: {
            'text-to-image': [
              {
                id: 'black-forest-labs/flux-schnell',
                label: 'FLUX Schnell',
                fields: [
                  { name: 'aspect_ratio', type: 'select' },
                  { name: 'num_outputs', type: 'number' },
                  { name: 'seed', type: 'number' },
                ],
              },
            ],
          },
        },
      });

      expect(
        v.validate(
          'media',
          'text-to-image',
          { aspect_ratio: '1:1', seed: 42 },
          { providerId: 'replicate', model: 'black-forest-labs/flux-schnell' },
        ),
      ).toEqual({ aspect_ratio: '1:1', seed: 42 });

      expect(() =>
        v.validate(
          'media',
          'text-to-image',
          { cfg_scale: 7 },
          { providerId: 'replicate', model: 'black-forest-labs/flux-schnell' },
        ),
      ).toThrowError(/Unknown media default setting key for category 'text-to-image'/);
    });
  });
});
