import 'reflect-metadata';
import { describe, it, expect } from 'vitest';

vi.mock('sharp', () => ({ default: vi.fn(function() { return { metadata: vi.fn() }; }) }));
vi.mock('ws', () => ({ default: class MockWs {} }));
vi.mock('@gitroom/helpers/utils/timer', () => ({ timer: vi.fn() }));
vi.mock('@gitroom/helpers/utils/read.or.fetch', () => ({ readOrFetch: vi.fn() }));
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(), ProviderConfiguration: class {}, Integration: class {} }));
vi.mock('@gitroom/helpers/auth/auth.service', () => ({ AuthService: { fixedEncryption: vi.fn((s: string) => s), fixedDecryption: vi.fn((s: string) => s) } }));
vi.mock('@gitroom/nestjs-libraries/database/prisma/provider-configs/provider-config.service', () => ({
  ProviderConfigService: vi.fn(() => ({ getAll: vi.fn().mockResolvedValue([]), getByIdentifier: vi.fn(), decryptConfig: vi.fn(() => ({})), upsert: vi.fn(), delete: vi.fn() })),
}));
vi.mock('@gitroom/nestjs-libraries/database/prisma/provider-configs/provider-config.repository', () => ({
  ProviderConfigRepository: vi.fn(() => ({ getAll: vi.fn(), getByIdentifier: vi.fn(), upsert: vi.fn(), delete: vi.fn(), setEnabled: vi.fn() })),
}));
vi.mock('@gitroom/nestjs-libraries/database/prisma/prisma.service', () => ({
  PrismaRepository: vi.fn(() => ({ model: {} })),
  PrismaService: class {},
}));
vi.mock('@gitroom/nestjs-libraries/integrations/credentials', () => ({
  getOrgCredential: () => 'mock-value',
  setCredentials: vi.fn(),
  getCredential: vi.fn(() => undefined),
  clearCredentials: vi.fn(),
  replaceCredentialsMap: vi.fn(),
}));

// The legacy in-memory social registry was removed; the ProviderKernel is the
// single source of truth. Source the raw provider singletons the same way the
// kernel does — from each relocated `@gitroom/provider-*` package's module(s).
import __m0 from '@gitroom/provider-bluesky';
import __m1 from '@gitroom/provider-devto';
import __m2 from '@gitroom/provider-discord';
import __m3 from '@gitroom/provider-dribbble';
import __m4 from '@gitroom/provider-facebook';
import __m5 from '@gitroom/provider-gmb';
import __m6 from '@gitroom/provider-hashnode';
import __m7 from '@gitroom/provider-instagram-standalone';
import __m8 from '@gitroom/provider-instagram';
import __m9 from '@gitroom/provider-kick';
import __m10 from '@gitroom/provider-lemmy';
import __m11 from '@gitroom/provider-linkedin-page';
import __m12 from '@gitroom/provider-linkedin';
import __m13 from '@gitroom/provider-listmonk';
import __m14 from '@gitroom/provider-mastodon';
import __m15 from '@gitroom/provider-medium';
import __m16 from '@gitroom/provider-mewe';
import __m17 from '@gitroom/provider-moltbook';
import __m18 from '@gitroom/provider-nostr';
import __m19 from '@gitroom/provider-peertube';
import __m20 from '@gitroom/provider-pinterest';
import __m21 from '@gitroom/provider-pixelfed';
import __m22 from '@gitroom/provider-reddit';
import __m23 from '@gitroom/provider-skool';
import __m24 from '@gitroom/provider-slack';
import __m25 from '@gitroom/provider-telegram';
import __m26 from '@gitroom/provider-threads';
import __m27 from '@gitroom/provider-tiktok';
import __m28 from '@gitroom/provider-tumblr';
import __m29 from '@gitroom/provider-twitch';
import __m30 from '@gitroom/provider-vk';
import __m31 from '@gitroom/provider-whop';
import __m32 from '@gitroom/provider-wordpress';
import __m33 from '@gitroom/provider-wrapcast';
import __m34 from '@gitroom/provider-x';
import __m35 from '@gitroom/provider-youtube';

// Minimal runtime context for creating the social bridge; only metadata getters
// (`identifier`, `name`, `maxConcurrentJob`, etc.) are exercised here.
const stubContext = {
  credentials: {},
  encryption: { encrypt: () => '', decrypt: () => '' },
  fetch: async () => new Response(),
  logger: { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  telemetry: { recordCall: () => {} },
} as any;

const socialProviders = [
  __m0, __m1, __m2, __m3, __m4, __m5, __m6, __m7, __m8, __m9,
  __m10, __m11, __m12, __m13, __m14, __m15, __m16, __m17, __m18, __m19,
  __m20, __m21, __m22, __m23, __m24, __m25, __m26, __m27, __m28, __m29,
  __m30, __m31, __m32, __m33, __m34, __m35,
]
  .flat()
  .filter(
    (m: any) => m && m.manifest?.domain === 'social' && typeof m.create === 'function'
  )
  .map((m: any) => m.create(stubContext).rawProvider);

describe('Provider structural validation', () => {
  it('has at least 30 providers', () => {
    expect(socialProviders.length).toBeGreaterThanOrEqual(30);
  });

  it('all identifiers are unique and lowercase', () => {
    const ids = socialProviders.map((p) => p.identifier);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it('all providers have name, editor, scopes, maxLength', () => {
    for (const p of socialProviders) {
      expect(p.name).toBeTruthy();
      expect(['none', 'normal', 'markdown', 'html']).toContain(p.editor);
      expect(Array.isArray(p.scopes)).toBe(true);
      expect(typeof p.maxLength).toBe('function');
      expect(p.maxConcurrentJob).toBeGreaterThan(0);
      expect(typeof p.isBetweenSteps).toBe('boolean');
    }
  });

  it('all providers have required methods', () => {
    for (const p of socialProviders) {
      expect(typeof p.authenticate).toBe('function');
      expect(typeof p.refreshToken).toBe('function');
      expect(typeof p.generateAuthUrl).toBe('function');
      expect(typeof p.post).toBe('function');
      expect(typeof p.checkValidity).toBe('function');
    }
  });

  it('optional properties have correct types', () => {
    for (const p of socialProviders) {
      if (p.isWeb3 !== undefined) expect(typeof p.isWeb3).toBe('boolean');
      if (p.isChromeExtension !== undefined) expect(typeof p.isChromeExtension).toBe('boolean');
      if (p.refreshCron !== undefined) expect(typeof p.refreshCron).toBe('boolean');
      if (p.oneTimeToken !== undefined) expect(typeof p.oneTimeToken).toBe('boolean');
      if (p.externalUrl) expect(typeof p.externalUrl).toBe('function');
      if (p.customFields) expect(typeof p.customFields).toBe('function');
    }
  });
});
