import { describe, expect, it } from 'vitest';
import { falDescriptor } from './fal/descriptor';
import { FAL_PIKA_TABS } from './fal/tabs';
import { pikaDescriptor } from './pika/descriptor';
import { COMPACT_STUDIO_REGISTRY, hasCompactStudio } from './studio-kit/compact-registry';
import { buildBody, defaultsFor } from './studio-kit/studio-form-utils';
import { studioFieldVisible } from './studio-kit/types';

const modelIds = () => falDescriptor.tabs.flatMap((tab) => {
  if (tab.model) return [tab.model];
  const model = tab.fields.find((field) => field.type === 'select' && field.name === 'model');
  return model?.options?.map((option) => option.value) ?? [];
});

describe('canonical fal.ai studio', () => {
  it('exposes every implemented fal model with unique tab keys', () => {
    expect(falDescriptor.provider).toBe('fal');
    expect(falDescriptor.title).toBe('fal.ai');
    expect(falDescriptor.landing?.website).toBe('https://fal.ai');
    expect(new Set(falDescriptor.tabs.map((tab) => tab.key)).size).toBe(falDescriptor.tabs.length);
    expect(modelIds()).toEqual(expect.arrayContaining([
      'fal-ai/flux/schnell',
      'fal-ai/stable-audio',
      'fal-ai/kling-video/v2.5-turbo/pro/text-to-video',
      'fal-ai/kling-video/v2.6/pro/text-to-video',
      'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
      'fal-ai/kling-video/v2.6/pro/image-to-video',
      'fal-ai/pika/v2.2/text-to-video',
      'fal-ai/pika/v2.2/image-to-video',
    ]));
    expect(modelIds()).toHaveLength(8);
    expect(modelIds()).not.toEqual(expect.arrayContaining([
      'fal-ai/kling-video/v1.6/standard/text-to-video',
      'fal-ai/kling-video/v1.6/pro/text-to-video',
      'fal-ai/kling-video/v2/master/text-to-video',
      'fal-ai/kling-video/v1.6/standard/image-to-video',
      'fal-ai/kling-video/v1.6/pro/image-to-video',
      'fal-ai/kling-video/v2/master/image-to-video',
    ]));
  });

  it('defaults to Kling 2.5 and only shows/submits model-supported fields', () => {
    for (const tab of falDescriptor.tabs.filter(({ key }) => key === 'text-to-video' || key === 'image-to-video')) {
      const operation = tab.key;
      const v25 = `fal-ai/kling-video/v2.5-turbo/pro/${operation}`;
      const v26 = `fal-ai/kling-video/v2.6/pro/${operation}`;
      const defaults = defaultsFor(tab);
      const cfgScale = tab.fields.find((field) => field.name === 'cfg_scale')!;
      const generateAudio = tab.fields.find((field) => field.name === 'generate_audio')!;

      expect(defaults.model).toBe(v25);
      expect(studioFieldVisible(cfgScale, defaults)).toBe(true);
      expect(studioFieldVisible(generateAudio, defaults)).toBe(false);
      expect(buildBody(tab, defaults).input.cfg_scale).toBe(0.5);
      expect(buildBody(tab, defaults).input.generate_audio).toBeUndefined();

      const v26Values = { ...defaults, model: v26 };
      expect(studioFieldVisible(cfgScale, v26Values)).toBe(false);
      expect(studioFieldVisible(generateAudio, v26Values)).toBe(true);
      expect(buildBody(tab, v26Values).input.cfg_scale).toBeUndefined();
      expect(buildBody(tab, v26Values).input.generate_audio).toBe(false);
    }
  });

  it('keeps Pika fal-backed and shares the standalone studio tab definitions', () => {
    expect(pikaDescriptor.provider).toBe('fal');
    expect(pikaDescriptor.tabs).toBe(FAL_PIKA_TABS);
    expect(pikaDescriptor.landing?.description).toContain('configured fal.ai connection');
    expect(pikaDescriptor.landing?.description).toContain('no separate Pika credentials');
  });

  it('registers fal and direct Kling in compact Designer studios without duplicate Pika tabs', () => {
    expect(COMPACT_STUDIO_REGISTRY.fal.title).toBe('fal.ai');
    expect(COMPACT_STUDIO_REGISTRY.kling.title).toBe('Kling AI');
    expect(hasCompactStudio('fal', 'image')).toBe(true);
    expect(hasCompactStudio('fal', 'audio')).toBe(true);
    expect(hasCompactStudio('kling', 'image')).toBe(true);
    expect(hasCompactStudio('kling', 'video')).toBe(true);
    for (const model of [
      'fal-ai/pika/v2.2/text-to-video',
      'fal-ai/pika/v2.2/image-to-video',
    ]) {
      expect(COMPACT_STUDIO_REGISTRY.fal.tabs.filter(({ tab }) => tab.model === model)).toHaveLength(1);
    }
  });
});
