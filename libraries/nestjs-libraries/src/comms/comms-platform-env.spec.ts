import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  COMMS_PLATFORM_ENV_MAPPINGS,
  getCommsPlatformCredentials,
  getCommsPlatformDefinition,
  getTelegramPlatformWebhookSecret,
  isCommsPlatformConfigured,
} from './comms-platform-env';

const ALL_VARS = COMMS_PLATFORM_ENV_MAPPINGS.flatMap((m) =>
  m.credentialEnvs.map((c) => c.env),
);
const saved: Record<string, string | undefined> = Object.fromEntries(
  ALL_VARS.map((v) => [v, process.env[v]]),
);

beforeEach(() => {
  for (const v of ALL_VARS) delete process.env[v];
});

afterAll(() => {
  for (const v of ALL_VARS) {
    if (saved[v] === undefined) delete process.env[v];
    else process.env[v] = saved[v];
  }
});

describe('comms-platform-env', () => {
  it('resolves the slack platform app only when all three vars are present', () => {
    process.env.SLACK_ID = 'sid';
    process.env.SLACK_SECRET = 'ssec';
    expect(isCommsPlatformConfigured('slack')).toBe(false);
    process.env.SLACK_SIGNING_SECRET = 'ssign';
    expect(isCommsPlatformConfigured('slack')).toBe(true);
    expect(getCommsPlatformCredentials('slack')).toEqual({
      clientId: 'sid',
      clientSecret: 'ssec',
      signingSecret: 'ssign',
    });
  });

  it('maps discord env vars onto the credential keys', () => {
    process.env.DISCORD_CLIENT_ID = 'app-1';
    process.env.DISCORD_BOT_TOKEN = 'bot-1';
    expect(getCommsPlatformCredentials('discord')).toBeUndefined();
    process.env.DISCORD_PUBLIC_KEY = 'pk-1';
    expect(getCommsPlatformCredentials('discord')).toEqual({
      applicationId: 'app-1',
      botToken: 'bot-1',
      publicKey: 'pk-1',
    });
  });

  it('maps telegram (token-only) and line credentials', () => {
    process.env.TELEGRAM_TOKEN = 'tg-1';
    expect(getCommsPlatformCredentials('telegram')).toEqual({ botToken: 'tg-1' });
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'cat-1';
    expect(isCommsPlatformConfigured('line')).toBe(false);
    process.env.LINE_CHANNEL_SECRET = 'cs-1';
    expect(getCommsPlatformCredentials('line')).toEqual({
      channelAccessToken: 'cat-1',
      channelSecret: 'cs-1',
    });
  });

  it('has no platform mapping for matrix or unknown providers', () => {
    expect(getCommsPlatformDefinition('matrix')).toBeUndefined();
    expect(getCommsPlatformCredentials('matrix')).toBeUndefined();
    expect(isCommsPlatformConfigured('nope')).toBe(false);
    expect(getCommsPlatformDefinition('slack')?.platformConnect).toBe('oauth');
    expect(getCommsPlatformDefinition('line')?.platformConnect).toBe('env');
  });

  it('derives the telegram platform webhook secret deterministically from the token', () => {
    expect(getTelegramPlatformWebhookSecret()).toBeUndefined();
    process.env.TELEGRAM_TOKEN = 'tg-1';
    const first = getTelegramPlatformWebhookSecret();
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(getTelegramPlatformWebhookSecret()).toBe(first);
    process.env.TELEGRAM_TOKEN = 'tg-2';
    expect(getTelegramPlatformWebhookSecret()).not.toBe(first);
  });
});
