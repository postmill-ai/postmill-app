import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { OAuthLinkQueryDto } from './oauth-link-query.dto';

describe('OAuthLinkQueryDto', () => {
  it('accepts known OAuth query parameters', async () => {
    const dto = plainToInstance(OAuthLinkQueryDto, {
      redirect_uri: 'https://app.example.com/callback',
      state: 'login',
      publicKey: 'abc123',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects an unknown query parameter under whitelist', async () => {
    const dto = plainToInstance(OAuthLinkQueryDto, {
      redirect_uri: 'https://app.example.com/callback',
      unknown_field: 'x',
    });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.length).toBeGreaterThan(0);
    const propertyNames = errors.map((e) => e.property);
    expect(propertyNames).toContain('unknown_field');
  });

  it('rejects a redirect_uri that is too long', async () => {
    const dto = plainToInstance(OAuthLinkQueryDto, {
      redirect_uri: 'https://example.com/' + 'x'.repeat(3000),
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('redirect_uri');
  });

  it('accepts an empty query object', async () => {
    const dto = plainToInstance(OAuthLinkQueryDto, {});
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
