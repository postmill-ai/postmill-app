// Platform-owned comms-app credentials, read from the deployment environment.
//
// Mirrors `integrations/channel-env-credentials.ts`: when the operator sets a
// comms provider's platform-app keys in the environment, every org can connect
// that provider with a single click (OAuth for Slack, env pull for Discord/
// Telegram/LINE) instead of entering per-org credentials. Presence-based +
// opt-in: if a provider's vars are unset, behaviour is unchanged (per-org
// manual entry only). Nothing is seeded into the database at boot — env is
// resolved live, per request, and persisted only when an org explicitly
// connects (platform-connect / the Slack OAuth callback).

import { hmacSha256Hex } from '@postmill-ai/provider-kernel';

export type CommsPlatformConnect = 'oauth' | 'env';

interface CommsPlatformEnvMapping {
  identifier: string;
  platformConnect: CommsPlatformConnect;
  // env var → credential key, resolved into the provider's credential bag.
  // platformConfigured requires ALL of them present.
  credentialEnvs: Array<{ env: string; key: string }>;
  // True when the operator must paste the platform webhook URL into the
  // vendor console (Slack/Discord/LINE); false when Postmill registers it
  // programmatically (Telegram setWebhook).
  manualWebhookUrl: boolean;
}

export const COMMS_PLATFORM_ENV_MAPPINGS: CommsPlatformEnvMapping[] = [
  {
    identifier: 'slack',
    platformConnect: 'oauth',
    manualWebhookUrl: true,
    credentialEnvs: [
      { env: 'SLACK_ID', key: 'clientId' },
      { env: 'SLACK_SECRET', key: 'clientSecret' },
      { env: 'SLACK_SIGNING_SECRET', key: 'signingSecret' },
    ],
  },
  {
    identifier: 'discord',
    platformConnect: 'env',
    manualWebhookUrl: true,
    credentialEnvs: [
      { env: 'DISCORD_CLIENT_ID', key: 'applicationId' },
      { env: 'DISCORD_BOT_TOKEN', key: 'botToken' },
      { env: 'DISCORD_PUBLIC_KEY', key: 'publicKey' },
    ],
  },
  {
    identifier: 'telegram',
    platformConnect: 'env',
    manualWebhookUrl: false,
    credentialEnvs: [{ env: 'TELEGRAM_TOKEN', key: 'botToken' }],
  },
  {
    identifier: 'line',
    platformConnect: 'env',
    manualWebhookUrl: true,
    credentialEnvs: [
      { env: 'LINE_CHANNEL_ACCESS_TOKEN', key: 'channelAccessToken' },
      { env: 'LINE_CHANNEL_SECRET', key: 'channelSecret' },
    ],
  },
];

const MAP_BY_IDENTIFIER: Record<string, CommsPlatformEnvMapping> =
  Object.fromEntries(COMMS_PLATFORM_ENV_MAPPINGS.map((m) => [m.identifier, m]));

export function getCommsPlatformDefinition(
  identifier: string,
): CommsPlatformEnvMapping | undefined {
  return MAP_BY_IDENTIFIER[identifier];
}

// Resolve a provider's platform-app credentials from the environment.
// Returns undefined when the provider has no platform mapping or any of its
// required env vars is unset.
export function getCommsPlatformCredentials(
  identifier: string,
): Record<string, string> | undefined {
  const mapping = MAP_BY_IDENTIFIER[identifier];
  if (!mapping) return undefined;
  const credentials: Record<string, string> = {};
  for (const { env, key } of mapping.credentialEnvs) {
    const value = process.env[env];
    if (!value) return undefined;
    credentials[key] = value;
  }
  return credentials;
}

// True when the deployment env provides a usable platform app for this provider.
export function isCommsPlatformConfigured(identifier: string): boolean {
  return getCommsPlatformCredentials(identifier) !== undefined;
}

// Static salt for the derived Telegram platform webhook secret. Telegram
// echoes this value back in X-Telegram-Bot-Api-Secret-Token; deriving it
// deterministically from the bot token keeps `registerWebhook` and inbound
// verification in agreement without another env var or stored secret.
const TELEGRAM_PLATFORM_WEBHOOK_SALT = 'postmill-comms-platform-webhook';

export function getTelegramPlatformWebhookSecret(): string | undefined {
  const token = process.env.TELEGRAM_TOKEN;
  if (!token) return undefined;
  return hmacSha256Hex(TELEGRAM_PLATFORM_WEBHOOK_SALT, token);
}
