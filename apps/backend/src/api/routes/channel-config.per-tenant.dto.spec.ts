import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

import {
  UpdateChannelConfigDto,
  CreateChannelConfigDto,
} from './channel-config.per-tenant.dto';

// Mirror the global ValidationPipe options so these tests prove the DTOs behave
// under whitelist + forbidNonWhitelisted.
const PIPE = { whitelist: true, forbidNonWhitelisted: true } as const;

describe('UpdateChannelConfigDto', () => {
  it('accepts a minimal valid update body', async () => {
    const dto = plainToInstance(UpdateChannelConfigDto, { enabled: true });
    expect(await validate(dto, PIPE)).toHaveLength(0);
  });

  it('accepts the full valid shape including nested vpnSelection', async () => {
    const dto = plainToInstance(UpdateChannelConfigDto, {
      name: 'My X config',
      enabled: true,
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'https://example.com/callback',
      scopes: 'read,write',
      additionalConfig: '{"key":"value"}',
      setupNotes: 'notes',
      vpnSelection: { enabled: true, identifier: 'vpn', regionId: 'us', vpnVersion: 'v1' },
      version: 'v1',
    });
    expect(await validate(dto, PIPE)).toHaveLength(0);
  });

  it('rejects unknown fields', async () => {
    const dto = plainToInstance(UpdateChannelConfigDto, { enabled: true, evil: 'x' });
    const errors = await validate(dto, PIPE);
    expect(errors.some((e) => e.property === 'evil')).toBe(true);
  });

  it('rejects a wrong-typed enabled value', async () => {
    const dto = plainToInstance(UpdateChannelConfigDto, { enabled: 'not-boolean' });
    const errors = await validate(dto, PIPE);
    expect(errors.some((e) => e.property === 'enabled')).toBe(true);
  });

  it('rejects a non-string clientSecret', async () => {
    const dto = plainToInstance(UpdateChannelConfigDto, { clientSecret: 123 });
    expect((await validate(dto, PIPE)).length).toBeGreaterThan(0);
  });

  it('rejects an invalid redirectUri', async () => {
    const dto = plainToInstance(UpdateChannelConfigDto, { redirectUri: 'not-a-url' });
    const errors = await validate(dto, PIPE);
    expect(errors.some((e) => e.property === 'redirectUri')).toBe(true);
  });

  it('rejects invalid additionalConfig JSON', async () => {
    const dto = plainToInstance(UpdateChannelConfigDto, { additionalConfig: 'not-json' });
    const errors = await validate(dto, PIPE);
    expect(errors.some((e) => e.property === 'additionalConfig')).toBe(true);
  });

  it('allows empty additionalConfig without JSON validation', async () => {
    const dto = plainToInstance(UpdateChannelConfigDto, { additionalConfig: '' });
    expect(await validate(dto, PIPE)).toHaveLength(0);
  });

  it('allows vpnSelection to be null', async () => {
    const dto = plainToInstance(UpdateChannelConfigDto, { vpnSelection: null });
    expect(await validate(dto, PIPE)).toHaveLength(0);
  });

  it('validates nested vpnSelection fields', async () => {
    const dto = plainToInstance(UpdateChannelConfigDto, {
      vpnSelection: { enabled: 'not-boolean' },
    });
    const errors = await validate(dto, PIPE);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'vpnSelection')).toBe(true);
  });
});

describe('CreateChannelConfigDto', () => {
  it('requires identifier and name', async () => {
    const dto = plainToInstance(CreateChannelConfigDto, { enabled: true });
    const errors = await validate(dto, PIPE);
    expect(errors.some((e) => e.property === 'identifier')).toBe(true);
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('accepts a valid create body', async () => {
    const dto = plainToInstance(CreateChannelConfigDto, {
      identifier: 'x',
      name: 'My X config',
      enabled: true,
      redirectUri: 'https://example.com/callback',
      additionalConfig: '{"key":"value"}',
      vpnSelection: { enabled: false },
    });
    expect(await validate(dto, PIPE)).toHaveLength(0);
  });
});
