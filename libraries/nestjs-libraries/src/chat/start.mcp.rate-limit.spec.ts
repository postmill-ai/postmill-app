import { describe, expect, it, vi, afterEach } from 'vitest';

// Same import-time stubs as start.mcp.spec.ts — start.mcp statically imports
// LoadToolsService/Mastra/Redis, so the suite must not need live infra.

vi.mock('@mastra/mcp', () => ({
  MCPServer: class MockMCPServer {},
}));

vi.mock('@gitroom/nestjs-libraries/chat/mastra.service', () => ({
  MastraService: class MockMastraService {},
}));

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

import { mcpRateLimitKey } from './start.mcp';

afterEach(() => {
  vi.unstubAllEnvs();
});

// F9/D4: MCP rate-limit keys resolve the client IP exactly like the HTTP
// throttler and the WS gateway (TRUST_PROXY_HOPS, Nth-from-right XFF).
describe('mcpRateLimitKey (F9/D4)', () => {
  const req = (ip: string | undefined, xff?: string) =>
    ({ ip, headers: xff ? { 'x-forwarded-for': xff } : {} }) as any;

  it('keys on req.ip when TRUST_PROXY_HOPS is unset (spoofed XFF ignored)', () => {
    vi.stubEnv('TRUST_PROXY_HOPS', '');
    expect(mcpRateLimitKey('mcp', req('10.0.0.9', 'spoof-1'))).toBe(
      'mcp:10.0.0.9'
    );
    expect(mcpRateLimitKey('mcp-oauth', req('10.0.0.9', 'spoof-2'))).toBe(
      'mcp-oauth:10.0.0.9'
    );
  });

  it('hops=1: resolves the rightmost XFF entry for both entrypoint keys', () => {
    vi.stubEnv('TRUST_PROXY_HOPS', '1');
    expect(mcpRateLimitKey('mcp', req('10.0.0.9', '192.168.1.10'))).toBe(
      'mcp:192.168.1.10'
    );
    expect(
      mcpRateLimitKey('mcp-oauth', req('10.0.0.9', '192.168.1.11'))
    ).toBe('mcp-oauth:192.168.1.11');
  });

  it('hops=1: padded left-most attacker entries do not change the key', () => {
    vi.stubEnv('TRUST_PROXY_HOPS', '1');
    const plain = mcpRateLimitKey('mcp', req('10.0.0.9', '192.168.1.10'));
    const padded = mcpRateLimitKey(
      'mcp',
      req('10.0.0.9', 'evil-1, evil-2, 192.168.1.10')
    );
    expect(padded).toBe(plain);
  });

  it('overestimated hops (short chain) fall back to req.ip', () => {
    vi.stubEnv('TRUST_PROXY_HOPS', '2');
    expect(mcpRateLimitKey('mcp', req('10.0.0.9', '192.168.1.10'))).toBe(
      'mcp:10.0.0.9'
    );
  });

  it("falls back to 'unknown' when the socket address is absent", () => {
    vi.stubEnv('TRUST_PROXY_HOPS', '');
    expect(mcpRateLimitKey('mcp', req(undefined))).toBe('mcp:unknown');
  });
});
