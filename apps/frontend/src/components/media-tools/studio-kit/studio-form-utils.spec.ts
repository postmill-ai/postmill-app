import { describe, expect, it } from 'vitest';
import { elevenlabsDescriptor } from '../elevenlabs/descriptor';
import { buildBody, defaultsFor, validateStudioValues } from './studio-form-utils';
import type { StudioFieldValue, StudioTab } from './types';

const imageVideoTab = elevenlabsDescriptor.tabs.find((tab) => tab.key === 'image-to-video') as StudioTab;
const file = (fileId: string): StudioFieldValue => ({ fileId, url: `/files/${fileId}`, type: 'image' });

describe('ElevenLabs Veo studio input validation', () => {
  it('exposes frame/reference inputs for both Veo model IDs', () => {
    const model = imageVideoTab.fields.find((field) => field.name === 'model');
    expect(model?.type).toBe('select');
    expect(model?.type === 'select' && model.options?.map((option) => option.value)).toEqual([
      'veo-3.1-fast-generate-001',
      'veo-3.1-generate-001',
    ]);
    expect(imageVideoTab.fields.filter((field) => field.type === 'media')).toHaveLength(5);
  });

  it('accepts start/end frames without references', () => {
    const values = {
      ...defaultsFor(imageVideoTab),
      start_frame: file('start'),
      end_frame: file('end'),
    };
    expect(validateStudioValues('elevenlabs', imageVideoTab, values)).toBeNull();
  });

  it('accepts up to three subject/style references only at eight seconds', () => {
    const values = {
      ...defaultsFor(imageVideoTab),
      reference_image_1: file('subject'),
      reference_image_1_role: 'subject',
      reference_image_2: file('style'),
      reference_image_2_role: 'style',
      reference_image_3: file('subject-2'),
      reference_image_3_role: 'subject',
    };
    expect(validateStudioValues('elevenlabs', imageVideoTab, values)).toBeNull();
    expect(validateStudioValues('elevenlabs', imageVideoTab, { ...values, duration_secs: 6 })).toMatch(/8-second/);
  });

  it('rejects an end frame without a start frame', () => {
    const values = { ...defaultsFor(imageVideoTab), end_frame: file('end') };
    expect(validateStudioValues('elevenlabs', imageVideoTab, values)).toMatch(/requires a start frame/);
  });

  it('rejects every frame/reference combination before body construction', () => {
    const values = {
      ...defaultsFor(imageVideoTab),
      start_frame: file('start'),
      reference_image_1: file('ref'),
    };
    expect(validateStudioValues('elevenlabs', imageVideoTab, values)).toMatch(/cannot be combined/);
  });

  it('keeps reference Files in mediaInputs and role tags in native input', () => {
    const body = buildBody(imageVideoTab, {
      ...defaultsFor(imageVideoTab),
      model: 'veo-3.1-generate-001',
      prompt: 'animate this',
      reference_image_1: file('file-subject'),
      reference_image_1_role: 'subject',
      reference_image_2: file('file-style'),
      reference_image_2_role: 'style',
    });
    expect(body).toMatchObject({
      operation: 'video',
      model: 'veo-3.1-generate-001',
      input: {
        prompt: 'animate this',
        duration_secs: 8,
        reference_image_1_role: 'subject',
        reference_image_2_role: 'style',
      },
      mediaInputs: {
        reference_image_1: 'file-subject',
        reference_image_2: 'file-style',
      },
    });
    expect(body.input.reference_image_1).toBeUndefined();
    expect(body.input.reference_image_2).toBeUndefined();
  });
});
