import { describe, expect, it, vi } from 'vitest';

vi.mock('@mastra/mcp', () => ({
  MCPServer: class MockMCPServer {},
}));

vi.mock('@gitroom/nestjs-libraries/chat/mastra.service', () => ({
  MastraService: class MockMastraService {},
}));

// start.mcp now statically imports LoadToolsService (for the in-repo tool union),
// which transitively pulls mastra.store's eager PostgresStore. Stub both so the
// suite doesn't need a live DATABASE_URL at import time.
vi.mock('@gitroom/nestjs-libraries/chat/mastra.store', () => ({
  pStore: { _type: 'mock.mastra.store' },
}));
vi.mock('@gitroom/nestjs-libraries/chat/load.tools.service', () => ({
  LoadToolsService: class MockLoadToolsService {
    async loadTools() {
      return {};
    }
  },
  SUPERVISOR_TOOL_NAMES: ['integrationList', 'groupList'],
}));

vi.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.service', () => ({
  OrganizationService: class MockOrganizationService {},
}));

vi.mock('@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service', () => ({
  OAuthService: class MockOAuthService {},
}));

vi.mock('@gitroom/nestjs-libraries/ai/ai-settings.manager', () => ({
  AiSettingsManager: class MockAiSettingsManager {},
}));

vi.mock('@gitroom/nestjs-libraries/ai/governance/idempotency.factory', () => ({
  IdempotencyFactory: class MockIdempotencyFactory {},
}));

vi.mock('@gitroom/nestjs-libraries/ai/governance/budget.service', () => ({
  BudgetService: class MockBudgetService {},
}));

vi.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    incr: vi.fn(),
    pexpire: vi.fn(),
  },
}));

vi.mock('./async.storage', () => ({
  runWithContext: vi.fn(),
}));

vi.mock('./oauth-middleware', () => ({
  createOAuthMiddleware: vi.fn(),
}));

vi.mock('./oauth-types', () => ({
  extractBearerToken: vi.fn(),
}));

import { createMcpScopeStrategy, requireScopes, mapPersistedScopes } from './start.mcp';

describe('startMcp auth helpers', () => {
  it('does not grant configured scopes to a token that does not have them', async () => {
    const strategy = createMcpScopeStrategy(
      vi.fn().mockResolvedValue({
        auth: { id: 'org-1' },
        scopes: ['mcp:read'],
      }),
      { allowedScopes: ['mcp:admin'] },
    );

    const result = await strategy.authenticate({
      headers: { authorization: 'Bearer token' },
    } as any);

    expect(result.authenticated).toBe(false);
    expect(result.scopes).toEqual(['mcp:read']);
    expect(result.reason).toContain('mcp:admin');
  });

  it('authenticates when the resolved token scopes satisfy configured requirements', async () => {
    const strategy = createMcpScopeStrategy(
      vi.fn().mockResolvedValue({
        auth: { id: 'org-1' },
        scopes: ['mcp:read', 'mcp:posts:write'],
      }),
      { allowedScopes: ['mcp:posts:write'] },
    );

    const result = await strategy.authenticate({
      headers: { authorization: 'Bearer token' },
    } as any);

    expect(result.authenticated).toBe(true);
    expect(result.principal).toBe('org-1');
  });

  it('requires every requested scope', () => {
    expect(requireScopes({ authenticated: true, scopes: ['mcp:read'] }, ['mcp:read'])).toBe(true);
    expect(requireScopes({ authenticated: true, scopes: ['mcp:read'] }, ['mcp:read', 'mcp:admin'])).toBe(false);
  });
});

describe('mapPersistedScopes (OAuth granted-scope mapping)', () => {
  it('floors an empty/absent scope to mcp:read (legacy rows)', () => {
    expect(mapPersistedScopes(null)).toEqual(['mcp:read']);
    expect(mapPersistedScopes('')).toEqual(['mcp:read']);
    expect(mapPersistedScopes(undefined)).toEqual(['mcp:read']);
  });

  it('maps a granted write scope through (space or comma separated)', () => {
    expect(mapPersistedScopes('mcp:read mcp:posts:write')).toContain('mcp:posts:write');
    expect(mapPersistedScopes('mcp:posts:write,mcp:admin')).toEqual(
      expect.arrayContaining(['mcp:read', 'mcp:posts:write', 'mcp:admin'])
    );
  });

  it('drops unknown scopes and always keeps the mcp:read floor', () => {
    const result = mapPersistedScopes('bogus:scope mcp:posts:write');
    expect(result).toContain('mcp:read');
    expect(result).toContain('mcp:posts:write');
    expect(result).not.toContain('bogus:scope');
  });
});
