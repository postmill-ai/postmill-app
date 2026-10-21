import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { GenerateSlideDto } from './generate-slide.dto';

/**
 * The global validation pipe rejects unknown fields, so the slideshow dialog's
 * fit/aspect/canvas fields must be declared here — and the both-or-nothing
 * width/height pairing enforced (a lone dimension would silently skip frame
 * normalization server-side).
 */
const validate = (body: Record<string, unknown>) => {
  const dto = plainToInstance(GenerateSlideDto, body);
  return { dto, errors: validateSync(dto) };
};

describe('GenerateSlideDto', () => {
  it('accepts the legacy bare call (backward compatible)', () => {
    expect(validate({}).errors).toHaveLength(0);
    expect(validate({ prompt: 'A slideshow' }).errors).toHaveLength(0);
  });

  it('accepts a full fit + canvas request', () => {
    const { dto, errors } = validate({
      prompt: 'A slideshow',
      fitMode: 'contain',
      aspect: 'wide',
      width: 1920,
      height: 1080,
    });
    expect(errors).toHaveLength(0);
    expect(dto.fitMode).toBe('contain');
    expect(dto.width).toBe(1920);
  });

  it('rejects unknown fitMode / aspect values', () => {
    expect(validate({ fitMode: 'stretch' }).errors).not.toHaveLength(0);
    expect(validate({ aspect: 'panoramic' }).errors).not.toHaveLength(0);
  });

  it('rejects a lone width or a lone height', () => {
    expect(validate({ width: 1920 }).errors).not.toHaveLength(0);
    expect(validate({ height: 1080 }).errors).not.toHaveLength(0);
  });

  it('rejects out-of-range or non-integer dimensions', () => {
    expect(validate({ width: 8, height: 1080 }).errors).not.toHaveLength(0);
    expect(validate({ width: 1920, height: 20000 }).errors).not.toHaveLength(0);
    expect(validate({ width: 1920.5, height: 1080 }).errors).not.toHaveLength(0);
  });
});
