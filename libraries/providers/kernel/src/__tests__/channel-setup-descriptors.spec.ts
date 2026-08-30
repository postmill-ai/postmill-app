import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Channel setup descriptor guard — every social adapter carries a
 * `setupDescriptor: ChannelSetupDescriptor` that drives the per-tenant
 * "Add channel" config form (`setup` in IntegrationManager.getSocialProviderCatalog
 * → apps/frontend channel-edit.modal.tsx). The descriptor's authType must match
 * the adapter's real connect flow, or the form renders the wrong fields
 * (e.g. an OAuth-shaped fallback for an account/instance-based channel).
 *
 * Grep-based (like oauth-state.guard.spec.ts): importing the adapters would
 * pull heavy SDKs (sharp, node-telegram-bot-api, …) into the kernel suite.
 */

const providersRoot = path.resolve(__dirname, '../../..');

const collectSocialAdapterSources = (): string[] => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === 'node_modules' || entry === 'dist') continue;
        walk(full);
        continue;
      }
      if (entry === 'social.adapter.ts') {
        files.push(full);
      }
    }
  };
  walk(providersRoot);
  return files.sort();
};

// The `setupDescriptor = { ... };` class-member block (two-space indent).
const extractDescriptorBlock = (source: string): string | null => {
  const start = source.indexOf('setupDescriptor');
  if (start === -1) return null;
  const end = source.indexOf('\n  };', start);
  return end === -1 ? null : source.slice(start, end);
};

const extractAuthType = (block: string): string | null =>
  block.match(/authType:\s*'(oauth1|oauth2|token|direct)'/)?.[1] || null;

// Body of the adapter's own generateAuthUrl (family re-exports like mastodon
// have none in the package file — the base is checked separately).
const extractGenerateAuthUrlBody = (source: string): string | null => {
  const start = source.indexOf('generateAuthUrl(');
  if (start === -1) return null;
  const end = source.indexOf('\n  }', start);
  return end === -1 ? null : source.slice(start, end);
};

// authType determined from each adapter's real connect flow (see the 16
// channel descriptors added after the 2026-08-27 channel onboarding sweep).
const EXPECTED_AUTH_TYPES: Record<string, string> = {
  dribbble: 'oauth2', // dribbble.com/oauth/authorize + code exchange
  gmb: 'oauth2', // google OAuth2Client generateAuthUrl + code exchange
  kick: 'oauth2', // id.kick.com/oauth/authorize (PKCE) + code exchange
  'linkedin-page': 'oauth2', // linkedin.com/oauth/v2/authorization + companies() second step
  mewe: 'oauth2', // {instance}/login?client_id&redirect_uri + token exchange
  twitch: 'oauth2', // id.twitch.tv/oauth2/authorize + code exchange
  vk: 'oauth2', // id.vk.com/authorize (PKCE, Application ID only)
  whop: 'oauth2', // api.whop.com/oauth/authorize (PKCE, Client ID only)
  wrapcast: 'token', // Neynar sign-in in the composer; org config stores Neynar Client ID + API Key, no callback
  lemmy: 'direct', // customFields: service/identifier/password
  listmonk: 'direct', // customFields: url/username/password
  moltbook: 'direct', // composer agent-registration + claim flow (isWeb3)
  nostr: 'direct', // customFields: private key
  peertube: 'direct', // customFields: instance/username/password
  pixelfed: 'direct', // customFields: instance/access token
  skool: 'direct', // isChromeExtension session-cookie capture
  akkoma: 'direct', // externalUrl dynamic app registration (Mastodon-API family)
  friendica: 'direct', // externalUrl dynamic app registration (Mastodon-API family)
  gotosocial: 'direct', // externalUrl dynamic app registration (Mastodon-API family)
};

describe('channel setup descriptors — completeness and authType consistency', () => {
  const files = collectSocialAdapterSources();
  const read = (file: string) => readFileSync(file, 'utf8');

  it('every social adapter declares a setupDescriptor', () => {
    expect(files.length).toBeGreaterThan(30);

    const missing = files
      .filter((file) => !extractDescriptorBlock(read(file)))
      .map((file) => path.relative(providersRoot, file));
    expect(missing).toEqual([]);
  });

  it.each(Object.entries(EXPECTED_AUTH_TYPES))(
    '%s declares the authType of its real connect flow',
    (pkg, authType) => {
      const file = path.join(providersRoot, pkg, 'src/v1/social.adapter.ts');
      const block = extractDescriptorBlock(read(file));
      expect(block, `${pkg} has no setupDescriptor`).not.toBeNull();
      expect(extractAuthType(block!)).toBe(authType);
    }
  );

  it('callbackInstructions is declared exactly for oauth1/oauth2 descriptors', () => {
    const violations: string[] = [];
    for (const file of files) {
      const block = extractDescriptorBlock(read(file));
      if (!block) continue;
      const rel = path.relative(providersRoot, file);
      const authType = extractAuthType(block);
      expect(authType, `${rel}: unknown/missing authType`).not.toBeNull();
      const declaresCallback = block.includes('callbackInstructions');
      if (
        (authType === 'oauth1' || authType === 'oauth2') !== declaresCallback
      ) {
        violations.push(`${rel} authType=${authType} callbackInstructions=${declaresCallback}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('direct descriptors are guidance-only (empty credentialFields)', () => {
    const violations: string[] = [];
    for (const file of files) {
      const block = extractDescriptorBlock(read(file));
      if (!block || extractAuthType(block) !== 'direct') continue;
      if (!block.includes('credentialFields: []')) {
        violations.push(path.relative(providersRoot, file));
      }
    }
    expect(violations).toEqual([]);
  });

  it('descriptor credentialFields map onto clientId/clientSecret, or are optional extras', () => {
    // Extra keys (e.g. Meta FBfB `configId`) are allowed only when marked
    // `optional: true` — they persist into the org config's encrypted
    // additionalConfig JSON, and an empty value must never be required.
    const violations: string[] = [];
    for (const file of files) {
      const block = extractDescriptorBlock(read(file));
      if (!block) continue;
      for (const fieldMatch of block.matchAll(/\{[^{}]*\}/g)) {
        const field = fieldMatch[0];
        const key = field.match(/key:\s*'([^']+)'/)?.[1];
        if (!key || key === 'clientId' || key === 'clientSecret') continue;
        if (!/optional:\s*true/.test(field)) {
          violations.push(`${path.relative(providersRoot, file)}: key '${key}'`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('direct channels connect without a developer app (customFields / externalUrl / extension / web3)', () => {
    const violations: string[] = [];
    for (const file of files) {
      const source = read(file);
      const block = extractDescriptorBlock(source);
      if (!block || extractAuthType(block) !== 'direct') continue;
      const hasDirectFlow =
        source.includes('customFields') ||
        source.includes('externalUrl') ||
        source.includes('isChromeExtension') ||
        source.includes('isWeb3');
      if (!hasDirectFlow) {
        violations.push(path.relative(providersRoot, file));
      }
    }
    expect(violations).toEqual([]);
  });

  it('adapters whose generateAuthUrl builds a real authorize URL are not direct/token', () => {
    const violations: string[] = [];
    for (const file of files) {
      const source = read(file);
      const block = extractDescriptorBlock(source);
      const body = extractGenerateAuthUrlBody(source);
      if (!block || !body) continue;
      const authType = extractAuthType(block);
      // A literal URL in generateAuthUrl means a real OAuth redirect flow.
      if (body.includes('http') && (authType === 'direct' || authType === 'token')) {
        violations.push(`${path.relative(providersRoot, file)} authType=${authType}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
