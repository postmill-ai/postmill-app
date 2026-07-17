import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The auth-context module reads request-scoped values from AsyncLocalStorage via
// async.storage. Mock that module so we can drive getAuth/getUserId/getAccess.
vi.mock('@gitroom/nestjs-libraries/chat/async.storage', () => ({
  getAuth: vi.fn(() => undefined),
  getUserId: vi.fn(() => undefined),
  getAccess: vi.fn(() => undefined),
}));

import { checkAuth } from './auth.context';
import * as storage from './async.storage';

class FakeRequestContext {
  private store = new Map<string, string>();
  get(key: string) {
    return this.store.get(key);
  }
  set(key: string, value: string) {
    this.store.set(key, value);
  }
}

describe('checkAuth — MCP auth wrapper unwrapping', () => {
  beforeEach(() => {
    vi.mocked(storage.getAuth).mockReturnValue(undefined as any);
    vi.mocked(storage.getUserId).mockReturnValue(undefined as any);
    vi.mocked(storage.getAccess).mockReturnValue(undefined as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('unwraps the { org, userId, role } wrapper from mcp.extra.authInfo to the bare org', () => {
    const requestContext = new FakeRequestContext();
    const context = {
      requestContext,
      mcp: { extra: { authInfo: { org: { id: 'o1', name: 'Acme' }, userId: 'u1', role: 'admin' } } },
    };

    checkAuth({}, context);

    const stored = JSON.parse(requestContext.get('organization')!);
    expect(stored).toEqual({ id: 'o1', name: 'Acme' });
    expect(stored.id).toBe('o1');
  });

  it('passes a bare org (copilot/ALS path) through unchanged', () => {
    vi.mocked(storage.getAuth).mockReturnValue({ id: 'o2', name: 'Bare' } as any);
    const requestContext = new FakeRequestContext();
    const context = { requestContext };

    checkAuth({}, context);

    expect(JSON.parse(requestContext.get('organization')!)).toEqual({
      id: 'o2',
      name: 'Bare',
    });
  });

  it('defaults access mode to headless when none resolved', () => {
    vi.mocked(storage.getAuth).mockReturnValue({ id: 'o3' } as any);
    const requestContext = new FakeRequestContext();
    checkAuth({}, { requestContext });
    expect(JSON.parse(requestContext.get('access')!)).toEqual({ mode: 'headless' });
  });
});
