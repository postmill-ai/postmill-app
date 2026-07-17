import 'reflect-metadata';
import { vi } from 'vitest';

// Set encryption key for tests
process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-only';

// Provider/HTTP code now calls undici's own `fetch` (not the global one) so the SSRF
// `Agent` dispatcher works — Node 22's built-in fetch is undici v6 and rejects the npm
// undici v8 Agent with `invalid onRequestStart method`. Tests stub `globalThis.fetch`;
// route undici.fetch back to it so those stubs keep intercepting.
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    fetch: (...args: any[]) => (globalThis.fetch as any)(...args),
  };
});

// SocialAbstract was relocated into the kernel (step 7.5.2) and dereferences its
// security/runtime primitives from injected ports. Wire them for tests so the
// behaviour matches the pre-relocation direct imports: fetch/safeFetch route to
// the per-test `globalThis.fetch` stub, sharp resolves at call time so per-file
// `vi.mock('sharp')` still applies, timer is a no-op (instant retries), and the
// real error classes are used so `instanceof`/`toThrow` assertions hold.
// Import from the specific module (NOT the kernel barrel) so this setup file does
// not eagerly load the family-base providers — that would cache their direct
// `@gitroom/helpers` imports before a spec's `vi.mock(...)` hoists.
import { setSocialFetchPorts } from '../providers/kernel/src/domains/social-base';
import {
  RefreshTokenError,
  BadBodyError,
} from '@gitroom/nestjs-libraries/inngest/errors';

setSocialFetchPorts({
  getVpnDispatcher: () => undefined,
  ssrfSafeDispatcher: undefined,
  isSafePublicHttpsUrl: async () => true,
  undiciFetch: ((...args: any[]) => (globalThis.fetch as any)(...args)) as any,
  RefreshTokenError,
  BadBodyError,
  timer: (async () => undefined) as any,
  // A static sharp stub (per-file vi.mock('sharp') cannot reach a port wrapper).
  // Mirrors the common spec mock (800x600 + chained transforms); no spec depends
  // on sharp returning other dimensions or failing on dims.
  sharp: ((_buf: any) => ({
    metadata: async () => ({ width: 800, height: 600 }),
    toFormat: () => ({
      resize: () => ({ toBuffer: async () => Buffer.from('image') }),
      toBuffer: async () => Buffer.from('image'),
    }),
    resize: () => ({ gif: () => ({ toBuffer: async () => Buffer.from('gif') }) }),
    gif: () => ({ toBuffer: async () => Buffer.from('gif') }),
  })) as any,
  readOrFetch: (async () => Buffer.from('data')) as any,
  safeFetch: ((...args: any[]) => (globalThis.fetch as any)(...args)) as any,
});
