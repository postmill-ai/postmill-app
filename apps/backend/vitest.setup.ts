// Set encryption key for tests
process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-only';
process.env.FRONTEND_URL = 'http://localhost:5000';

// Wire the kernel SocialAbstract security ports for tests (the social base lives in
// the kernel; the real SSRF/VPN/error primitives stay in nestjs-libraries and are
// injected at runtime by DatabaseModule.onModuleInit — replicate that here so any
// spec whose graph eagerly imports relocated social providers can construct/fetch).
// Import from the specific social-base module (not the kernel barrel) so family
// bases aren't pre-loaded before a spec's vi.mock hoists.
import { setSocialFetchPorts } from '../../libraries/providers/kernel/src/domains/social-base';
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
  timer: (async (): Promise<any> => undefined) as any,
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
