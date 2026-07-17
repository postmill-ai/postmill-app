import { describe, it, expect, vi } from 'vitest';
import { SocialProviderKernelAdapter } from '../social-bridge';

// Minimal ProviderRuntimeContext — the bridge only reads `credentials`; the other
// ports are never touched, so stubs are sufficient.
function makeCtx(credentials: Record<string, string> = {}): any {
  return {
    credentials,
    encryption: {},
    fetch: vi.fn(),
    logger: {},
    telemetry: {},
  };
}

// A legacy SocialProvider stub. Only the always-present methods are supplied by
// default; optional capabilities are added via `overrides` to exercise the
// conditional-assignment branch.
function baseProvider(overrides: Record<string, any> = {}): any {
  return {
    identifier: 'demo',
    name: 'Demo',
    editor: 'normal',
    maxConcurrentJob: 1,
    isBetweenSteps: false,
    scopes: [],
    maxLength: () => 100,
    checkValidity: async () => true as const,
    authenticate: vi.fn(async () => ({ accessToken: 'a', id: '1', name: 'n', username: 'u' })),
    refreshToken: vi.fn(async () => ({ accessToken: 'a', id: '1', name: 'n', username: 'u' })),
    generateAuthUrl: vi.fn(async () => ({ url: '', codeVerifier: '', state: '' })),
    post: vi.fn(async () => []),
    ...overrides,
  };
}

describe('SocialProviderKernelAdapter (2.6)', () => {
  describe('optional capabilities are assigned conditionally', () => {
    it('leaves an unsupported optional capability undefined so presence-probing skips it', () => {
      const provider = baseProvider(); // no fetchComments / comment / analytics / …
      const adapter = new SocialProviderKernelAdapter(provider, makeCtx());

      expect(adapter.fetchComments).toBeUndefined();
      expect(adapter.comment).toBeUndefined();
      expect(adapter.analytics).toBeUndefined();
      expect(adapter.replyToComment).toBeUndefined();
      expect(adapter.likeComment).toBeUndefined();
      expect(adapter.postAnalytics).toBeUndefined();
      expect(adapter.reConnect).toBeUndefined();
      expect(adapter.mention).toBeUndefined();
      expect(adapter.externalUrl).toBeUndefined();
    });

    it('exposes and delegates an optional capability the provider implements', async () => {
      const fetchComments = vi.fn(async () => ({ comments: [] }));
      const provider = baseProvider({ fetchComments });
      const adapter = new SocialProviderKernelAdapter(provider, makeCtx());

      expect(typeof adapter.fetchComments).toBe('function');
      await adapter.fetchComments!('id', 'tok', 'post', undefined, {} as any);
      expect(fetchComments).toHaveBeenCalledTimes(1);
    });
  });

  describe('credential precedence (clientInformation wins over context)', () => {
    const explicit = {
      client_id: 'explicit-id',
      client_secret: 'explicit-secret',
      instanceUrl: '',
    };

    it('uses the explicit per-call clientInformation even when the context carries an empty creds object', async () => {
      // The RuntimeContextFactory default is `credentials: {}` — this must be
      // treated as absent, never discarding the resolved clientInformation.
      const provider = baseProvider();
      const adapter = new SocialProviderKernelAdapter(provider, makeCtx({}));

      await adapter.post('id', 'tok', [], {} as any, explicit as any);

      const passed = provider.post.mock.calls[0][4];
      expect(passed).toEqual(explicit);
    });

    it('uses the explicit clientInformation even when the context has real credentials', async () => {
      const provider = baseProvider();
      const adapter = new SocialProviderKernelAdapter(
        provider,
        makeCtx({ client_id: 'ctx-id', client_secret: 'ctx-secret' })
      );

      await adapter.authenticate({ code: 'c', codeVerifier: 'v' }, explicit as any);

      const passed = provider.authenticate.mock.calls[0][1];
      expect(passed).toEqual(explicit);
    });

    it('falls back to the context credentials when no explicit clientInformation is supplied', async () => {
      const provider = baseProvider();
      const adapter = new SocialProviderKernelAdapter(
        provider,
        makeCtx({ client_id: 'ctx-id', client_secret: 'ctx-secret' })
      );

      await adapter.generateAuthUrl();

      const passed = provider.generateAuthUrl.mock.calls[0][0];
      expect(passed).toMatchObject({
        client_id: 'ctx-id',
        client_secret: 'ctx-secret',
      });
    });

    it('passes undefined creds when both the explicit arg and the context are empty', async () => {
      const provider = baseProvider();
      const adapter = new SocialProviderKernelAdapter(provider, makeCtx({}));

      await adapter.generateAuthUrl();

      expect(provider.generateAuthUrl.mock.calls[0][0]).toBeUndefined();
    });
  });
});
