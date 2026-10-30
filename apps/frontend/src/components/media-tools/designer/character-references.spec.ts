import { describe, expect, it } from 'vitest';
import type { StudioFieldValue, StudioTab } from '../studio-kit/types';
import {
  descriptorCharacterReferences,
  replicateCharacterReferences,
  type CharacterReference,
} from './character-references';

const references: CharacterReference[] = [
  { fileId: 'file-1', src: 'https://example.com/character-1.png', name: 'One' },
  { fileId: 'file-2', src: 'https://example.com/character-2.png', name: 'Two' },
  { fileId: 'file-3', src: 'https://example.com/character-3.png', name: 'Three' },
  { fileId: 'file-4', src: 'https://example.com/character-4.png', name: 'Four' },
];

const tab = (key: string, model?: string): StudioTab => ({
  key,
  label: key,
  operation: 'video',
  model,
  fields: [],
});

const fileValue = (reference: CharacterReference) => ({
  fileId: reference.fileId,
  url: reference.src,
  type: 'image' as const,
});

describe('descriptorCharacterReferences', () => {
  it('returns values unchanged when there are no references', () => {
    const values = { prompt: 'A character waves', start_frame: fileValue(references[0]) };

    const result = descriptorCharacterReferences('minimax', tab('subject-reference'), values);

    expect(result.values).toBe(values);
    expect(result.hiddenFields).toEqual(new Set());
    expect(result.usesReferences).toBe(false);
  });

  it('maps the first MiniMax subject reference and preserves other values', () => {
    const values = { prompt: 'A character waves', duration: 6 };

    const result = descriptorCharacterReferences(
      'minimax',
      tab('subject-reference'),
      values,
      references
    );

    expect(result.values).toEqual({
      ...values,
      subject_image: fileValue(references[0]),
    });
    expect(result.hiddenFields).toEqual(new Set(['subject_image']));
    expect(result.usesReferences).toBe(true);
  });

  it.each(['veo-3.1-fast-generate-001', 'veo-3.1-generate-001'])(
    'maps ordered ElevenLabs subject images for %s and removes frames',
    (model) => {
      const values: Record<string, StudioFieldValue> = {
        model,
        prompt: 'The characters wave',
        start_frame: fileValue(references[2]),
        end_frame: fileValue(references[3]),
      };

      const result = descriptorCharacterReferences(
        'elevenlabs',
        tab('image-to-video'),
        values,
        references
      );

      expect(result.values).toEqual({
        model,
        prompt: 'The characters wave',
        reference_image_1: fileValue(references[0]),
        reference_image_1_role: 'subject',
        reference_image_2: fileValue(references[1]),
        reference_image_2_role: 'subject',
        reference_image_3: fileValue(references[2]),
        reference_image_3_role: 'subject',
      });
      expect(result.hiddenFields).toEqual(new Set([
        'start_frame',
        'end_frame',
        'reference_image_1',
        'reference_image_1_role',
        'reference_image_2',
        'reference_image_2_role',
        'reference_image_3',
        'reference_image_3_role',
      ]));
      expect(result.usesReferences).toBe(true);
      expect(values.start_frame).toEqual(fileValue(references[2]));
      expect(values.end_frame).toEqual(fileValue(references[3]));
    }
  );

  it('removes stale native ElevenLabs references when the shared set is shorter', () => {
    const result = descriptorCharacterReferences(
      'elevenlabs',
      tab('image-to-video'),
      {
        model: 'veo-3.1-generate-001',
        reference_image_2: fileValue(references[3]),
        reference_image_2_role: 'style',
        reference_image_3: fileValue(references[2]),
      },
      references.slice(0, 1)
    );

    expect(result.values).toEqual({
      model: 'veo-3.1-generate-001',
      reference_image_1: fileValue(references[0]),
      reference_image_1_role: 'subject',
    });
  });

  it.each([
    ['an unsupported provider', 'unknown', tab('image-to-video', 'veo-3.1-generate-001')],
    ['an unsupported MiniMax tab', 'minimax', tab('image-to-video')],
    ['an unsupported ElevenLabs model', 'elevenlabs', tab('image-to-video', 'other-model')],
    ['an unsupported ElevenLabs tab', 'elevenlabs', tab('text-to-video', 'veo-3.1-generate-001')],
  ])('returns values unchanged for %s', (_name, provider, studioTab) => {
    const values = { prompt: 'A character waves', start_frame: fileValue(references[0]) };

    const result = descriptorCharacterReferences(provider, studioTab, values, references);

    expect(result.values).toBe(values);
    expect(result.hiddenFields).toEqual(new Set());
    expect(result.usesReferences).toBe(false);
  });
});

describe('replicateCharacterReferences', () => {
  it('maps ordered Veo reference_images and caps them at three', () => {
    expect(replicateCharacterReferences('google/veo-3.1', references)).toEqual(
      references.slice(0, 3).map(fileValue)
    );
  });

  it('returns undefined without references or for an unsupported model', () => {
    expect(replicateCharacterReferences('google/veo-3.1')).toBeUndefined();
    expect(replicateCharacterReferences('google/veo-3.1', [])).toBeUndefined();
    expect(replicateCharacterReferences('google/veo-3', references)).toBeUndefined();
    expect(replicateCharacterReferences(undefined, references)).toBeUndefined();
  });
});
