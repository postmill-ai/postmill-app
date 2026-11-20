import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { OutpaintPageImageDto } from './outpaint-page.dto';

const validate = (body: Record<string, unknown>) => {
  const dto = plainToInstance(OutpaintPageImageDto, body);
  return { dto, errors: validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }) };
};

describe('OutpaintPageImageDto', () => {
  it('accepts an image and mask with an optional prompt', () => {
    const imageUrl = 'data:image/png;base64,iVBORw0KGgo=';
    const maskUrl = 'data:image/png;base64,iVBORw0KGgo=';
    expect(validate({ imageUrl, maskUrl }).errors).toHaveLength(0);
    const { dto, errors } = validate({ imageUrl, maskUrl, prompt: 'continue the studio backdrop' });
    expect(errors).toHaveLength(0);
    expect(dto.prompt).toBe('continue the studio backdrop');
  });

  it('requires valid image and mask sources', () => {
    expect(validate({ maskUrl: 'data:image/png;base64,iVBORw0KGgo=' }).errors).not.toHaveLength(0);
    expect(validate({ imageUrl: 'data:image/png;base64,iVBORw0KGgo=' }).errors).not.toHaveLength(0);
    expect(validate({ imageUrl: 'not-an-image', maskUrl: 'not-an-image' }).errors).not.toHaveLength(0);
  });

  it('rejects a client-supplied provider model', () => {
    expect(validate({
      imageUrl: 'data:image/png;base64,iVBORw0KGgo=',
      maskUrl: 'data:image/png;base64,iVBORw0KGgo=',
      model: 'black-forest-labs/flux-fill-pro',
    }).errors).not.toHaveLength(0);
  });

  it('rejects a non-string prompt', () => {
    expect(validate({
      imageUrl: 'data:image/png;base64,iVBORw0KGgo=',
      maskUrl: 'data:image/png;base64,iVBORw0KGgo=',
      prompt: 42,
    }).errors).not.toHaveLength(0);
  });
});
