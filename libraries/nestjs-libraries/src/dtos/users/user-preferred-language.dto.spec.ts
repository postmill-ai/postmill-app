import { describe, expect, it } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UserPreferredLanguageDto } from './user-preferred-language.dto';
import { CreateOrgUserDto } from '../auth/create.org.user.dto';

describe('preferred language DTO validation', () => {
  it('accepts a supported user language', async () => {
    const dto = plainToInstance(UserPreferredLanguageDto, { preferredLanguage: 'fr' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects an unsupported user language', async () => {
    const dto = plainToInstance(UserPreferredLanguageDto, { preferredLanguage: 'xx' });
    expect((await validate(dto)).map((error) => error.property)).toContain('preferredLanguage');
  });

  it('keeps registration language optional but validates it when supplied', async () => {
    const base = {
      password: 'secret',
      provider: 'LOCAL',
      email: 'owner@example.com',
      company: 'Example',
      name: 'Owner',
    };
    expect(await validate(plainToInstance(CreateOrgUserDto, base))).toHaveLength(0);
    expect(await validate(plainToInstance(CreateOrgUserDto, { ...base, preferredLanguage: 'de' }))).toHaveLength(0);
    expect((await validate(plainToInstance(CreateOrgUserDto, { ...base, preferredLanguage: 'de-DE' }))).length).toBeGreaterThan(0);
  });
});
