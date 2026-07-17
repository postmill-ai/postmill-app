import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getEnvClientInfo,
  isEnvEnabled,
  getEnvEnabledIdentifiers,
} from './channel-env-credentials';

describe('channel-env-credentials', () => {
  const saved: Record<string, string | undefined> = {};
  const keys = [
    'LINKEDIN_CLIENT_ID',
    'LINKEDIN_CLIENT_SECRET',
    'TELEGRAM_TOKEN',
    'VK_ID',
    'X_API_KEY',
    'X_API_SECRET',
  ];

  beforeEach(() => {
    for (const k of keys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('returns undefined when the env var is unset', () => {
    expect(getEnvClientInfo('linkedin')).toBeUndefined();
    expect(isEnvEnabled('linkedin')).toBe(false);
  });

  it('resolves a client id/secret pair', () => {
    process.env.LINKEDIN_CLIENT_ID = 'cid';
    process.env.LINKEDIN_CLIENT_SECRET = 'csecret';
    expect(getEnvClientInfo('linkedin')).toEqual({
      client_id: 'cid',
      client_secret: 'csecret',
      instanceUrl: '',
    });
    expect(isEnvEnabled('linkedin')).toBe(true);
  });

  it('shares LINKEDIN_* across linkedin and linkedin-page', () => {
    process.env.LINKEDIN_CLIENT_ID = 'cid';
    process.env.LINKEDIN_CLIENT_SECRET = 'csecret';
    expect(getEnvClientInfo('linkedin-page')?.client_id).toBe('cid');
  });

  it('requires both halves of a pair (incomplete = undefined)', () => {
    process.env.X_API_KEY = 'only-key';
    expect(getEnvClientInfo('x')).toBeUndefined();
  });

  it('treats token-only providers as a token, not a client id', () => {
    process.env.TELEGRAM_TOKEN = 'bot-token';
    expect(getEnvClientInfo('telegram')).toEqual({
      client_id: '',
      client_secret: '',
      instanceUrl: '',
      token: 'bot-token',
    });
    expect(isEnvEnabled('telegram')).toBe(true);
  });

  it('allows id-only providers (vk) with no secret', () => {
    process.env.VK_ID = 'vkid';
    expect(getEnvClientInfo('vk')).toEqual({
      client_id: 'vkid',
      client_secret: '',
      instanceUrl: '',
    });
  });

  it('returns undefined for unmapped providers', () => {
    expect(getEnvClientInfo('bluesky')).toBeUndefined();
  });

  it('lists only env-enabled identifiers', () => {
    process.env.TELEGRAM_TOKEN = 'bot-token';
    process.env.VK_ID = 'vkid';
    const ids = getEnvEnabledIdentifiers();
    expect(ids).toContain('telegram');
    expect(ids).toContain('vk');
    expect(ids).not.toContain('linkedin');
  });
});
