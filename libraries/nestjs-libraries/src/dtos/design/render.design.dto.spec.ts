import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { RenderDesignDto } from './render.design.dto';

const validateDto = async (input: Record<string, unknown>) =>
  validate(plainToInstance(RenderDesignDto, input));

describe('RenderDesignDto raster formats', () => {
  it.each(['png', 'jpeg', 'webp', 'pdf'])('accepts %s', async (format) => {
    expect(await validateDto({ doc: {}, format, quality: 0.7 })).toHaveLength(0);
  });

  it('rejects unsupported formats and out-of-range quality', async () => {
    expect((await validateDto({ doc: {}, format: 'gif' })).length).toBeGreaterThan(0);
    expect((await validateDto({ doc: {}, quality: 0 })).length).toBeGreaterThan(0);
    expect((await validateDto({ doc: {}, quality: 1.1 })).length).toBeGreaterThan(0);
  });
});
