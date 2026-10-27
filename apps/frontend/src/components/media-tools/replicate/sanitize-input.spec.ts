import { describe, it, expect } from 'vitest';
import { sanitizeModelInput } from './sanitize-input';
import type { InputSchema } from './field-classification';

const schema: InputSchema = {
  required: ['prompt'],
  properties: {
    prompt: { type: 'string' },
    end_image: { type: 'string', format: 'uri' },
    mode: { type: 'string', enum: ['std', 'pro'], default: 'std' },
    seed: { type: 'integer' },
  },
};

describe('sanitizeModelInput', () => {
  it('drops empty-string/null/undefined OPTIONAL fields so an unset control is never sent', () => {
    // Regression: kling-v2.1 i2v rejected `end_image: ''` with "end_image
    // requires mode 'pro'" — the empty string counted as a SET end image.
    expect(
      sanitizeModelInput(
        { prompt: 'a cat', end_image: '', seed: undefined, negative_prompt: null },
        schema
      )
    ).toEqual({ prompt: 'a cat' });
  });

  it('keeps falsy-but-real values (0, false) and required fields even when empty', () => {
    expect(
      sanitizeModelInput({ prompt: '', seed: 0, enhance: false }, schema)
    ).toEqual({ prompt: '', seed: 0, enhance: false });
  });

  it("forces mode: 'pro' when end_image has a value and the schema has a mode field", () => {
    expect(
      sanitizeModelInput(
        { prompt: 'x', end_image: 'https://cdn.example.com/img.png', mode: 'std' },
        schema
      )
    ).toEqual({ prompt: 'x', end_image: 'https://cdn.example.com/img.png', mode: 'pro' });
  });

  it('treats a file object with fileId/url as a set end_image', () => {
    const out = sanitizeModelInput({ end_image: { fileId: 'f1', url: '/u/1' } }, schema);
    expect(out.mode).toBe('pro');
  });

  it('does not force a mode the enum does not offer', () => {
    const noPro: InputSchema = {
      properties: { end_image: { type: 'string' }, mode: { type: 'string', enum: ['std'] } },
    };
    const out = sanitizeModelInput({ end_image: 'x', mode: 'std' }, noPro);
    expect(out.mode).toBe('std');
  });

  it('leaves schemas without a mode field alone', () => {
    const noMode: InputSchema = { properties: { end_image: { type: 'string' } } };
    expect(sanitizeModelInput({ end_image: 'x' }, noMode)).toEqual({ end_image: 'x' });
  });

  it('drops empty optional arrays but retains populated arrays', () => {
    const arraySchema: InputSchema = {
      properties: {
        reference_images: { type: 'array', items: { type: 'string', format: 'uri' } },
      },
    };
    expect(sanitizeModelInput({ reference_images: [] }, arraySchema)).toEqual({});
    const references = [{ fileId: 'f1' }, { fileId: 'f2' }];
    expect(sanitizeModelInput({ reference_images: references }, arraySchema)).toEqual({
      reference_images: references,
    });
  });

  it('keeps an empty required array so required-field validation can report it', () => {
    const requiredArray: InputSchema = {
      required: ['reference_images'],
      properties: { reference_images: { type: 'array' } },
    };
    expect(sanitizeModelInput({ reference_images: [] }, requiredArray)).toEqual({
      reference_images: [],
    });
  });
});
