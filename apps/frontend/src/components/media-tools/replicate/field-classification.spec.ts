import { describe, it, expect } from 'vitest';
import { classifySchema } from './field-classification';

describe('classifySchema prompt-role detection', () => {
  it('classifies plain and prefixed prompt fields as prompt role', () => {
    const { primary } = classifySchema(
      {
        properties: {
          prompt: { type: 'string' },
          negative_prompt: { type: 'string' },
          text: { type: 'string' },
        },
      },
      new Set()
    );
    expect(primary.map((f) => [f.name, f.role])).toEqual([
      ['prompt', 'prompt'],
      ['negative_prompt', 'negative'],
      ['text', 'prompt'],
    ]);
  });

  it('classifies letter-suffixed prompt fields (prompt_a / prompt_b) as prompt role', () => {
    // riffusion-style schemas split the prompt across prompt_a/prompt_b —
    // these used to fall through to Advanced, leaving the compact embed with
    // no prompt field to drive from the dialog.
    const { primary, advanced } = classifySchema(
      {
        properties: {
          prompt_a: { type: 'string' },
          prompt_b: { type: 'string' },
          seed: { type: 'integer' },
        },
      },
      new Set()
    );
    expect(primary.map((f) => f.name)).toEqual(['prompt_a', 'prompt_b']);
    expect(primary.every((f) => f.role === 'prompt')).toBe(true);
    expect(advanced.map((f) => f.name)).toEqual(['seed']);
  });

  it('keeps the primary ordering (prompts first, x-order tie-break) with suffixed fields', () => {
    const { primary } = classifySchema(
      {
        properties: {
          image: { type: 'string', format: 'uri', 'x-order': 0 },
          prompt_b: { type: 'string', 'x-order': 2 },
          prompt_a: { type: 'string', 'x-order': 1 },
        },
      },
      new Set()
    );
    // prompts (role order 1) before files (role order 2); x-order breaks ties.
    expect(primary.map((f) => f.name)).toEqual(['prompt_a', 'prompt_b', 'image']);
  });

  it('does not treat arbitrary suffixes as prompt fields', () => {
    const { primary, advanced } = classifySchema(
      {
        properties: {
          prompt_strength: { type: 'number' },
          prompt_2: { type: 'string' },
        },
      },
      new Set()
    );
    expect(primary).toEqual([]);
    expect(advanced.map((f) => f.name).sort()).toEqual(['prompt_2', 'prompt_strength']);
  });

  it('keeps duration visible after file inputs and classifies URI arrays as files', () => {
    const { primary, advanced } = classifySchema(
      {
        properties: {
          duration: { type: 'integer', enum: [4, 6, 8] },
          reference_images: { type: 'array', items: { type: 'string', format: 'uri' } },
          prompt: { type: 'string' },
          aspect_ratio: { type: 'string', enum: ['16:9', '9:16'] },
        },
      },
      new Set()
    );

    expect(primary.map((field) => [field.name, field.role])).toEqual([
      ['prompt', 'prompt'],
      ['reference_images', 'file'],
      ['duration', 'duration'],
    ]);
    expect(advanced.map((field) => field.name)).toEqual(['aspect_ratio']);
  });
});
