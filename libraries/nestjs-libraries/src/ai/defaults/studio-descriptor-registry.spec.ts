import { describe, expect, it } from 'vitest';
import { STUDIO_DESCRIPTOR_REGISTRY } from './studio-descriptor-fields.generated';

describe('generated studio descriptor fields', () => {
  it('includes canonical fal image, video, and audio fields', () => {
    const fal = STUDIO_DESCRIPTOR_REGISTRY.fal;
    expect(fal.tabs.map((tab) => tab.key)).toEqual(expect.arrayContaining([
      'text-to-image',
      'text-to-video',
      'image-to-video',
      'pika-text-to-video',
      'pika-image-to-video',
      'text-to-music',
    ]));
    expect(fal.tabs.find((tab) => tab.key === 'text-to-image')?.model).toBe('fal-ai/flux/schnell');
    expect(fal.tabs.find((tab) => tab.key === 'text-to-music')?.model).toBe('fal-ai/stable-audio');
    for (const key of ['text-to-video', 'image-to-video']) {
      const fields = fal.tabs.find((tab) => tab.key === key)?.fields.map((field) => field.name);
      expect(fields).toEqual(expect.arrayContaining(['cfg_scale', 'generate_audio']));
    }
  });

  it('includes direct Kling descriptor fields', () => {
    expect(STUDIO_DESCRIPTOR_REGISTRY.kling.provider).toBe('kling');
    expect(STUDIO_DESCRIPTOR_REGISTRY.kling.tabs.map((tab) => tab.key)).toEqual([
      'text-to-video',
      'image-to-video',
      'text-to-image',
    ]);
  });
});
