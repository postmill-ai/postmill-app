// Platform-owned OAuth-app credentials, read from deployment environment.
//
// This powers the "click-connect" path: when the operator sets a provider's
// OAuth app keys in the environment, every org can connect that channel with a
// single click — no per-org key entry. A per-org `OrgProviderConfiguration`
// (Settings → Channels) always takes PRECEDENCE over these env values, so an org
// can bring its own app. When neither exists, the provider falls back to the
// per-org key form ("alternatively use keys").
//
// Presence-based + opt-in: if the env var is unset, behaviour is unchanged
// (per-org DB credentials only). Unlike the pre-v3.7.1 ChannelEnvMigrationService,
// nothing is seeded into the database — env is resolved live, per request, and
// never persisted to a tenant row.

interface ProviderEnvMapping {
  identifier: string;
  clientIdEnv: string;
  clientSecretEnv?: string;
  // Token-only providers (e.g. Telegram bots) carry a single token instead of a
  // client id/secret pair.
  isTokenOnly?: boolean;
}

export const CHANNEL_ENV_MAPPINGS: ProviderEnvMapping[] = [
  { identifier: 'x', clientIdEnv: 'X_API_KEY', clientSecretEnv: 'X_API_SECRET' },
  { identifier: 'linkedin', clientIdEnv: 'LINKEDIN_CLIENT_ID', clientSecretEnv: 'LINKEDIN_CLIENT_SECRET' },
  { identifier: 'linkedin-page', clientIdEnv: 'LINKEDIN_CLIENT_ID', clientSecretEnv: 'LINKEDIN_CLIENT_SECRET' },
  { identifier: 'facebook', clientIdEnv: 'FACEBOOK_APP_ID', clientSecretEnv: 'FACEBOOK_APP_SECRET' },
  { identifier: 'instagram', clientIdEnv: 'FACEBOOK_APP_ID', clientSecretEnv: 'FACEBOOK_APP_SECRET' },
  { identifier: 'instagram-standalone', clientIdEnv: 'INSTAGRAM_APP_ID', clientSecretEnv: 'INSTAGRAM_APP_SECRET' },
  { identifier: 'discord', clientIdEnv: 'DISCORD_CLIENT_ID', clientSecretEnv: 'DISCORD_CLIENT_SECRET' },
  { identifier: 'slack', clientIdEnv: 'SLACK_ID', clientSecretEnv: 'SLACK_SECRET' },
  { identifier: 'tiktok', clientIdEnv: 'TIKTOK_CLIENT_ID', clientSecretEnv: 'TIKTOK_CLIENT_SECRET' },
  { identifier: 'youtube', clientIdEnv: 'YOUTUBE_CLIENT_ID', clientSecretEnv: 'YOUTUBE_CLIENT_SECRET' },
  { identifier: 'pinterest', clientIdEnv: 'PINTEREST_CLIENT_ID', clientSecretEnv: 'PINTEREST_CLIENT_SECRET' },
  { identifier: 'reddit', clientIdEnv: 'REDDIT_CLIENT_ID', clientSecretEnv: 'REDDIT_CLIENT_SECRET' },
  { identifier: 'twitch', clientIdEnv: 'TWITCH_CLIENT_ID', clientSecretEnv: 'TWITCH_CLIENT_SECRET' },
  { identifier: 'threads', clientIdEnv: 'THREADS_APP_ID', clientSecretEnv: 'THREADS_APP_SECRET' },
  { identifier: 'dribbble', clientIdEnv: 'DRIBBBLE_CLIENT_ID', clientSecretEnv: 'DRIBBBLE_CLIENT_SECRET' },
  { identifier: 'mastodon', clientIdEnv: 'MASTODON_CLIENT_ID', clientSecretEnv: 'MASTODON_CLIENT_SECRET' },
  { identifier: 'mewe', clientIdEnv: 'MEWE_APP_ID', clientSecretEnv: 'MEWE_API_KEY' },
  { identifier: 'kick', clientIdEnv: 'KICK_CLIENT_ID', clientSecretEnv: 'KICK_SECRET' },
  { identifier: 'gmb', clientIdEnv: 'GOOGLE_GMB_CLIENT_ID', clientSecretEnv: 'GOOGLE_GMB_CLIENT_SECRET' },
  { identifier: 'wrapcast', clientIdEnv: 'NEYNAR_CLIENT_ID', clientSecretEnv: 'NEYNAR_SECRET_KEY' },
  { identifier: 'vk', clientIdEnv: 'VK_ID' },
  { identifier: 'whop', clientIdEnv: 'WHOP_CLIENT_ID' },
  { identifier: 'telegram', clientIdEnv: 'TELEGRAM_TOKEN', isTokenOnly: true },
  { identifier: 'oauth_custom', clientIdEnv: 'POSTMILL_OAUTH_CLIENT_ID', clientSecretEnv: 'POSTMILL_OAUTH_CLIENT_SECRET' },
];

const MAP_BY_IDENTIFIER: Record<string, ProviderEnvMapping> = Object.fromEntries(
  CHANNEL_ENV_MAPPINGS.map((m) => [m.identifier, m])
);

export interface EnvClientInfo {
  client_id: string;
  client_secret: string;
  instanceUrl: string;
  token?: string;
}

// Resolve a provider's platform OAuth-app credentials from the environment.
// Returns undefined when the env var is unset or the pair is incomplete.
export function getEnvClientInfo(identifier: string): EnvClientInfo | undefined {
  const mapping = MAP_BY_IDENTIFIER[identifier];
  if (!mapping) return undefined;

  const primary = process.env[mapping.clientIdEnv];
  if (!primary) return undefined;

  if (mapping.isTokenOnly) {
    return { client_id: '', client_secret: '', instanceUrl: '', token: primary };
  }

  const secret = mapping.clientSecretEnv ? process.env[mapping.clientSecretEnv] : undefined;
  // A few providers (vk, whop) are id-only; otherwise require both halves.
  if (mapping.clientSecretEnv && !secret) return undefined;

  return {
    client_id: primary,
    client_secret: secret || '',
    instanceUrl: '',
  };
}

// True when the deployment env provides a usable platform app for this provider.
export function isEnvEnabled(identifier: string): boolean {
  return getEnvClientInfo(identifier) !== undefined;
}

// All providers the deployment env enables for click-connect.
export function getEnvEnabledIdentifiers(): string[] {
  return CHANNEL_ENV_MAPPINGS.filter((m) => isEnvEnabled(m.identifier)).map(
    (m) => m.identifier
  );
}
