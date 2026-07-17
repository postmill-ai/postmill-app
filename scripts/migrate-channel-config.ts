/**
 * Migration script: Populates ProviderConfiguration table from environment variables.
 *
 * Run with: npx ts-node scripts/migrate-channel-config.ts
 * (Requires DATABASE_URL and JWT_SECRET to be set in .env)
 *
 * This migration is idempotent and can be run multiple times. Channel credentials are stored in the DB
 * and can be managed via the admin UI at /admin/channels.
 */

import { PrismaClient } from '@prisma/client';
import { AuthService } from '@gitroom/helpers/auth/auth.service';

const prisma = new PrismaClient();

interface ProviderMapping {
  identifier: string;
  name: string;
  clientIdEnv: string;
  clientSecretEnv?: string;
  redirectUriEnv?: string;
}

const PROVIDER_MAPPINGS: ProviderMapping[] = [
  { identifier: 'x', name: 'X', clientIdEnv: 'X_API_KEY', clientSecretEnv: 'X_API_SECRET', redirectUriEnv: 'X_URL' },
  { identifier: 'linkedin', name: 'LinkedIn', clientIdEnv: 'LINKEDIN_CLIENT_ID', clientSecretEnv: 'LINKEDIN_CLIENT_SECRET' },
  { identifier: 'linkedin-page', name: 'LinkedIn Page', clientIdEnv: 'LINKEDIN_CLIENT_ID', clientSecretEnv: 'LINKEDIN_CLIENT_SECRET' },
  { identifier: 'reddit', name: 'Reddit', clientIdEnv: 'REDDIT_CLIENT_ID', clientSecretEnv: 'REDDIT_CLIENT_SECRET' },
  { identifier: 'discord', name: 'Discord', clientIdEnv: 'DISCORD_CLIENT_ID', clientSecretEnv: 'DISCORD_CLIENT_SECRET' },
  { identifier: 'slack', name: 'Slack', clientIdEnv: 'SLACK_ID', clientSecretEnv: 'SLACK_SECRET' },
  { identifier: 'tiktok', name: 'TikTok', clientIdEnv: 'TIKTOK_CLIENT_ID', clientSecretEnv: 'TIKTOK_CLIENT_SECRET' },
  { identifier: 'pinterest', name: 'Pinterest', clientIdEnv: 'PINTEREST_CLIENT_ID', clientSecretEnv: 'PINTEREST_CLIENT_SECRET' },
  { identifier: 'dribbble', name: 'Dribbble', clientIdEnv: 'DRIBBBLE_CLIENT_ID', clientSecretEnv: 'DRIBBBLE_CLIENT_SECRET' },
  { identifier: 'youtube', name: 'YouTube', clientIdEnv: 'YOUTUBE_CLIENT_ID', clientSecretEnv: 'YOUTUBE_CLIENT_SECRET' },
  { identifier: 'threads', name: 'Threads', clientIdEnv: 'THREADS_APP_ID', clientSecretEnv: 'THREADS_APP_SECRET' },
  { identifier: 'facebook', name: 'Facebook', clientIdEnv: 'FACEBOOK_APP_ID', clientSecretEnv: 'FACEBOOK_APP_SECRET' },
  { identifier: 'instagram', name: 'Instagram', clientIdEnv: 'FACEBOOK_APP_ID', clientSecretEnv: 'FACEBOOK_APP_SECRET' },
  { identifier: 'instagram-standalone', name: 'Instagram Standalone', clientIdEnv: 'INSTAGRAM_APP_ID', clientSecretEnv: 'INSTAGRAM_APP_SECRET' },
  { identifier: 'twitch', name: 'Twitch', clientIdEnv: 'TWITCH_CLIENT_ID', clientSecretEnv: 'TWITCH_CLIENT_SECRET' },
  { identifier: 'vk', name: 'VK', clientIdEnv: 'VK_ID' },
  { identifier: 'whop', name: 'Whop', clientIdEnv: 'WHOP_CLIENT_ID' },
  { identifier: 'mastodon', name: 'Mastodon', clientIdEnv: 'MASTODON_CLIENT_ID', clientSecretEnv: 'MASTODON_CLIENT_SECRET', redirectUriEnv: 'MASTODON_URL' },
  { identifier: 'mewe', name: 'MeWe', clientIdEnv: 'MEWE_APP_ID', clientSecretEnv: 'MEWE_API_KEY', redirectUriEnv: 'MEWE_HOST' },
  { identifier: 'kick', name: 'Kick', clientIdEnv: 'KICK_CLIENT_ID', clientSecretEnv: 'KICK_SECRET' },
  { identifier: 'gmb', name: 'Google My Business', clientIdEnv: 'GOOGLE_GMB_CLIENT_ID', clientSecretEnv: 'GOOGLE_GMB_CLIENT_SECRET' },
  { identifier: 'wrapcast', name: 'Farcaster', clientIdEnv: 'NEYNAR_CLIENT_ID', clientSecretEnv: 'NEYNAR_SECRET_KEY' },
  { identifier: 'telegram', name: 'Telegram', clientIdEnv: 'TELEGRAM_TOKEN' },
  { identifier: 'oauth_custom', name: 'Custom OAuth', clientIdEnv: 'POSTMILL_OAUTH_CLIENT_ID', clientSecretEnv: 'POSTMILL_OAUTH_CLIENT_SECRET' },
];

const CUSTOM_FIELDS_PROVIDERS = [
  { identifier: 'bluesky', name: 'Bluesky' },
  { identifier: 'lemmy', name: 'Lemmy' },
  { identifier: 'wordpress', name: 'WordPress' },
  { identifier: 'devto', name: 'Dev.to' },
  { identifier: 'hashnode', name: 'Hashnode' },
  { identifier: 'medium', name: 'Medium' },
  { identifier: 'listmonk', name: 'ListMonk' },
  { identifier: 'nostr', name: 'Nostr' },
];

const CHROME_PROVIDERS = [
  'skool',
];

const WEB3_PROVIDERS: { identifier: string, name: string }[] = [
  { identifier: 'moltbook', name: 'Moltbook' },
];

async function main() {
  console.log('🚀 Starting channel config migration...\n');

  let migrated = 0;
  let skipped = 0;

  for (const mapping of PROVIDER_MAPPINGS) {
    const clientId = process.env[mapping.clientIdEnv];
    const clientSecret = mapping.clientSecretEnv ? process.env[mapping.clientSecretEnv] : '';
    const redirectUri = mapping.redirectUriEnv ? process.env[mapping.redirectUriEnv] : undefined;

    if (!clientId) {
      console.log(`  ⏭  ${mapping.name} (${mapping.identifier}): No credentials found in env, skipping`);
      skipped++;
      continue;
    }

    const encryptedClientId = AuthService.fixedEncryption(clientId);
    const encryptedClientSecret = AuthService.fixedEncryption(clientSecret);

    try {
      const baseData: Record<string, any> = {
        identifier: mapping.identifier,
        name: mapping.name,
        enabled: true,
        redirectUri: redirectUri || null,
      };

      if (mapping.identifier === 'telegram') {
        baseData.additionalConfig = JSON.stringify({ botToken: encryptedClientId });
        baseData.clientId = null;
        baseData.clientSecret = null;
      } else {
        baseData.clientId = encryptedClientId;
        baseData.clientSecret = encryptedClientSecret || null;
      }

      if (mapping.identifier === 'discord') {
        const discordBotToken = process.env.DISCORD_BOT_TOKEN_ID;
        if (discordBotToken) {
          baseData.additionalConfig = JSON.stringify({ botToken: AuthService.fixedEncryption(discordBotToken) });
        }
      }

      const updateData: Record<string, any> = {
        name: mapping.name,
        redirectUri: redirectUri || null,
      };

      if (mapping.identifier === 'telegram') {
        updateData.additionalConfig = baseData.additionalConfig;
        updateData.clientId = null;
        updateData.clientSecret = null;
      } else {
        updateData.clientId = encryptedClientId;
        updateData.clientSecret = encryptedClientSecret || null;
      }

      if (mapping.identifier === 'discord' && baseData.additionalConfig) {
        updateData.additionalConfig = baseData.additionalConfig;
      }

      await prisma.providerConfiguration.upsert({
        where: { identifier: mapping.identifier },
        create: { ...baseData },
        update: updateData,
      });

      console.log(`  ✅ ${mapping.name} (${mapping.identifier}): Migrated from env`);
      migrated++;
    } catch (err) {
      console.error(`Failed to migrate config for ${mapping.identifier}:`, err);
    }
  }

  for (const identifier of CHROME_PROVIDERS) {
    try {
      await prisma.providerConfiguration.upsert({
        where: { identifier },
        create: { identifier, name: identifier === 'skool' ? 'Skool' : identifier, enabled: !!process.env.EXTENSION_ID },
        update: { name: identifier === 'skool' ? 'Skool' : identifier },
      });
      console.log(`  ✅ ${identifier}: Configured`);
      migrated++;
    } catch (err) {
      console.error(`Failed to create config for ${identifier}:`, err);
    }
  }

  for (const provider of CUSTOM_FIELDS_PROVIDERS) {
    try {
      await prisma.providerConfiguration.upsert({
        where: { identifier: provider.identifier },
        create: { identifier: provider.identifier, name: provider.name, enabled: true },
        update: { name: provider.name },
      });
      console.log(`  ✅ ${provider.name} (${provider.identifier}): Configured`);
      migrated++;
    } catch (err) {
      console.error(`Failed to create config for ${provider.identifier}:`, err);
    }
  }

  for (const provider of WEB3_PROVIDERS) {
    try {
      await prisma.providerConfiguration.upsert({
        where: { identifier: provider.identifier },
        create: { identifier: provider.identifier, name: provider.name, enabled: true },
        update: { name: provider.name },
      });
      console.log(`  ✅ ${provider.name} (${provider.identifier}): Configured`);
      migrated++;
    } catch (err) {
      console.error(`Failed to create config for ${provider.identifier}:`, err);
    }
  }

  // Mastodon custom: stores MASTODON_URL in redirectUri
  const mastodonUrl = process.env.MASTODON_URL;
  if (mastodonUrl) {
    await prisma.providerConfiguration.upsert({
      where: { identifier: 'mastodon-custom' },
      create: { identifier: 'mastodon-custom', name: 'M. Instance', enabled: true, redirectUri: mastodonUrl },
      update: { redirectUri: mastodonUrl },
    });
    console.log(`  ✅ M. Instance (mastodon-custom): Configured`);
    migrated++;
  } else {
    skipped++;
  }

  console.log(`\n✨ Migration complete! ${migrated} providers migrated, ${skipped} skipped.\n`);
  console.log('You can now manage channel configurations via the admin UI at /admin/channels\n');
  console.log('After verifying everything works, you may remove the old env vars from your .env file.\n');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  prisma.$disconnect();
  process.exit(1);
});
