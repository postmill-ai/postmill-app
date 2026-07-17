import { describe, it, expect } from 'vitest';
import {
  convertReplicateInputSchema,
  ReplicateInputSchema,
} from './replicate-schema-to-model-fields';

describe('convertReplicateInputSchema', () => {
  it('converts a flux-like schema to ModelField[]', () => {
    const schema: ReplicateInputSchema = {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: {
          type: 'string',
          title: 'Prompt',
          description: 'Text prompt',
          'x-order': 0,
        },
        aspect_ratio: {
          type: 'string',
          title: 'Aspect ratio',
          default: '1:1',
          enum: ['1:1', '16:9', '9:16'],
          'x-order': 2,
        },
        output_format: {
          type: 'string',
          title: 'Output format',
          default: 'png',
          enum: ['png', 'webp', 'jpg'],
          'x-order': 3,
        },
        seed: {
          type: 'integer',
          title: 'Seed',
          default: 42,
          minimum: 0,
          maximum: 2147483647,
          'x-order': 4,
        },
        guidance: {
          type: 'number',
          title: 'Guidance scale',
          default: 3.5,
          minimum: 1,
          maximum: 10,
          'x-order': 5,
        },
        negative_prompt: {
          type: 'string',
          title: 'Negative prompt',
          'x-order': 1,
        },
      },
    };

    const fields = convertReplicateInputSchema(schema);

    // Runtime input fields are skipped.
    expect(fields.find((f) => f.name === 'prompt')).toBeUndefined();

    // Enum -> select with options and default.
    const aspect = fields.find((f) => f.name === 'aspect_ratio');
    expect(aspect).toEqual({
      name: 'aspect_ratio',
      type: 'select',
      label: 'Aspect ratio',
      default: '1:1',
      options: [
        { value: '1:1', label: '1:1' },
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
      ],
    });

    // Integer -> number with step 1.
    const seed = fields.find((f) => f.name === 'seed');
    expect(seed?.type).toBe('number');
    expect(seed?.min).toBe(0);
    expect(seed?.max).toBe(2147483647);
    expect(seed?.step).toBe(1);
    expect(seed?.default).toBe(42);

    // Number -> number with step 0.1.
    const guidance = fields.find((f) => f.name === 'guidance');
    expect(guidance?.type).toBe('number');
    expect(guidance?.step).toBe(0.1);
    expect(guidance?.default).toBe(3.5);

    // Text field is preserved.
    expect(fields.find((f) => f.name === 'negative_prompt')).toBeDefined();

    // Order follows x-order.
    expect(fields.map((f) => f.name)).toEqual([
      'negative_prompt',
      'aspect_ratio',
      'output_format',
      'seed',
      'guidance',
    ]);
  });

  it('skips nested / URI / media fields', () => {
    const schema: ReplicateInputSchema = {
      type: 'object',
      properties: {
        image: {
          type: 'string',
          format: 'uri',
          title: 'Image',
        },
        mask: {
          type: 'string',
          title: 'Mask',
        },
        nested: {
          type: 'object',
          title: 'Nested',
          properties: {},
        },
        list: {
          type: 'array',
          title: 'List',
        },
      },
    };

    const fields = convertReplicateInputSchema(schema);
    expect(fields.map((f) => f.name)).toEqual([]);
  });

  it('inlines $ref enum components', () => {
    const input: ReplicateInputSchema = {
      type: 'object',
      properties: {
        aspect_ratio: {
          allOf: [{ $ref: '#/components/schemas/AspectRatio' }],
          default: '16:9',
          title: 'Aspect ratio',
        },
      },
    };
    const schemas = {
      AspectRatio: {
        type: 'string',
        enum: ['16:9', '1:1'],
      },
    };

    const fields = convertReplicateInputSchema(input, schemas);
    expect(fields[0]).toEqual({
      name: 'aspect_ratio',
      type: 'select',
      label: 'Aspect ratio',
      default: '16:9',
      options: [
        { value: '16:9', label: '16:9' },
        { value: '1:1', label: '1:1' },
      ],
    });
  });
});
