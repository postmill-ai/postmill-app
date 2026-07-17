import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

import {
  UpsertMediaConfigDto,
  SetMediaStorageDto,
  UpsertVpnConfigDto,
  UpsertContentPackConfigDto,
} from '@gitroom/nestjs-libraries/dtos/providers/provider-config.dtos';
import {
  SaveAiProviderDto,
  UpsertOrgProviderConfigDto,
} from '@gitroom/nestjs-libraries/dtos/providers/admin-ai-settings.dtos';

// PROVIDER_REMEDIATION 3.4: the global pipe runs whitelist + forbidNonWhitelisted.
// Replicate those options here to prove the promoted DTOs strip/reject unknown fields
// while preserving the exact runtime shape the services consume.
const PIPE = { whitelist: true, forbidNonWhitelisted: true } as const;

describe('promoted provider DTOs (3.4)', () => {
  it('SaveAiProviderDto accepts the known shape', async () => {
    const dto = plainToInstance(SaveAiProviderDto, {
      enabled: true,
      credentials: { apiKey: 'sk' },
      defaultModel: 'gpt-4o',
      reasoningModel: 'o1',
      extraConfig: { baseURL: 'https://x' },
    });
    expect(await validate(dto, PIPE)).toHaveLength(0);
  });

  it('SaveAiProviderDto rejects an unknown field', async () => {
    const dto = plainToInstance(SaveAiProviderDto, { enabled: true, evil: 'x' });
    const errors = await validate(dto, PIPE);
    expect(errors.some((e) => e.property === 'evil')).toBe(true);
  });

  it('SaveAiProviderDto rejects a wrong-typed credentials blob', async () => {
    const dto = plainToInstance(SaveAiProviderDto, { credentials: 'not-an-object' });
    expect((await validate(dto, PIPE)).length).toBeGreaterThan(0);
  });

  it('SetMediaStorageDto requires storageProviderId', async () => {
    const dto = plainToInstance(SetMediaStorageDto, { storageRootFolderId: 'f' });
    const errors = await validate(dto, PIPE);
    expect(errors.some((e) => e.property === 'storageProviderId')).toBe(true);
  });

  it('UpsertVpnConfigDto validates regions as a string array', async () => {
    const ok = plainToInstance(UpsertVpnConfigDto, { regions: ['us', 'eu'], enabled: true });
    expect(await validate(ok, PIPE)).toHaveLength(0);
    const bad = plainToInstance(UpsertVpnConfigDto, { regions: [1, 2] as any });
    expect((await validate(bad, PIPE)).length).toBeGreaterThan(0);
  });

  it('UpsertMediaConfigDto + UpsertContentPackConfigDto + UpsertOrgProviderConfigDto accept known shapes', async () => {
    expect(
      await validate(
        plainToInstance(UpsertMediaConfigDto, { credentials: { apiKey: 'k' }, enabled: true, version: 'v1' }),
        PIPE,
      ),
    ).toHaveLength(0);
    expect(
      await validate(
        plainToInstance(UpsertContentPackConfigDto, { credentials: { apiKey: 'k' }, extraConfig: { a: 1 } }),
        PIPE,
      ),
    ).toHaveLength(0);
    expect(
      await validate(
        plainToInstance(UpsertOrgProviderConfigDto, { enabled: true, credentials: { apiKey: 'k' } }),
        PIPE,
      ),
    ).toHaveLength(0);
  });
});
