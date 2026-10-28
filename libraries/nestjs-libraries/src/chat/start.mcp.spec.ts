import { describe, expect, it, vi, afterEach } from 'vitest';

const mcpServerConfigs = vi.hoisted(() => ({ captured: [] as any[] }));

vi.mock('@mastra/mcp', () => ({
  MCPServer: class MockMCPServer {
    constructor(config: any) {
      mcpServerConfigs.captured.push(config);
    }
  },
}));

vi.mock('@postmill-ai/nestjs-libraries/chat/mastra.service', () => ({
  MastraService: class MockMastraService {},
}));

// start.mcp now statically imports LoadToolsService (for the in-repo tool union),
// which transitively pulls mastra.store's eager PostgresStore. Stub both so the
// suite doesn't need a live DATABASE_URL at import time.
vi.mock('@postmill-ai/nestjs-libraries/chat/mastra.store', () => ({
  pStore: { _type: 'mock.mastra.store' },
}));
vi.mock('@postmill-ai/nestjs-libraries/chat/load.tools.service', () => ({
  LoadToolsService: class MockLoadToolsService {
    async loadTools() {
      return {};
    }
  },
  SUPERVISOR_TOOL_NAMES: ['integrationList'],
}));

vi.mock('@postmill-ai/nestjs-libraries/database/prisma/organizations/organization.service', () => ({
  OrganizationService: class MockOrganizationService {},
}));

vi.mock('@postmill-ai/nestjs-libraries/database/prisma/oauth/oauth.service', () => ({
  OAuthService: class MockOAuthService {},
}));

vi.mock('@postmill-ai/nestjs-libraries/ai/ai-settings.manager', () => ({
  AiSettingsManager: class MockAiSettingsManager {},
}));

vi.mock('@postmill-ai/nestjs-libraries/ai/governance/idempotency.factory', () => ({
  IdempotencyFactory: class MockIdempotencyFactory {},
}));

vi.mock('@postmill-ai/nestjs-libraries/ai/governance/budget.service', () => ({
  BudgetService: class MockBudgetService {},
}));

vi.mock('@postmill-ai/nestjs-libraries/redis/redis.service', () => ({
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

import {
  startMcp,
  createMcpScopeStrategy,
  requireScopes,
  mapPersistedScopes,
} from './start.mcp';
import { FeatureFlagsService } from '@postmill-ai/nestjs-libraries/feature-flags';
import { MastraService } from '@postmill-ai/nestjs-libraries/chat/mastra.service';
import { LoadToolsService } from '@postmill-ai/nestjs-libraries/chat/load.tools.service';
import { AiSettingsManager } from '@postmill-ai/nestjs-libraries/ai/ai-settings.manager';
import { IdempotencyFactory } from '@postmill-ai/nestjs-libraries/ai/governance/idempotency.factory';
import { requireWrite } from './tools/tool.helpers';

// The per-tool write gate reads `access.scopes` — the exact set the entrypoints
// pass through from the strategy's authResult.
const mcpToolContext = (scopes: string[] | undefined) => ({
  requestContext: new Map([['access', JSON.stringify({ mode: 'mcp', scopes })]]),
});

describe('startMcp auth helpers', () => {
  const authenticate = (tokenScopes: string[], mcpSettings: any) =>
    createMcpScopeStrategy(
      vi.fn().mockResolvedValue({ auth: { id: 'org-1' }, scopes: tokenScopes }),
      mcpSettings,
    ).authenticate({ headers: { authorization: 'Bearer token' } } as any);

  it('accepts a read-only token when allowedScopes includes write/admin scopes', async () => {
    // allowedScopes is a ceiling, not a requirement — a read-only pos_ token or a
    // member's API key must still connect when the admin allows write scopes.
    const result = await authenticate(['mcp:read'], {
      allowedScopes: ['mcp:read', 'mcp:posts:write', 'mcp:admin'],
    });

    expect(result.authenticated).toBe(true);
    expect(result.principal).toBe('org-1');
    expect(result.scopes).toEqual(['mcp:read']);
  });

  it('does not grant configured scopes to a token that does not have them', async () => {
    const result = await authenticate(['mcp:read'], { allowedScopes: ['mcp:posts:write'] });

    // The token never held mcp:posts:write, so the write-tool gate still rejects it.
    expect(result.authenticated).toBe(true);
    expect(result.scopes).not.toContain('mcp:posts:write');
    expect(() => requireWrite(mcpToolContext(result.scopes))).toThrow(/mcp:posts:write/);
  });

  it('keeps a write scope the token holds when allowedScopes permits it', async () => {
    const result = await authenticate(['mcp:read', 'mcp:posts:write'], {
      allowedScopes: ['mcp:posts:write'],
    });

    expect(result.authenticated).toBe(true);
    expect(result.scopes).toEqual(expect.arrayContaining(['mcp:read', 'mcp:posts:write']));
    expect(() => requireWrite(mcpToolContext(result.scopes))).not.toThrow();
  });

  it('strips a scope the token holds that is outside allowedScopes', async () => {
    const result = await authenticate(['mcp:read', 'mcp:posts:write'], {
      allowedScopes: ['mcp:read'],
    });

    expect(result.authenticated).toBe(true);
    expect(result.scopes).toEqual(['mcp:read']);
    expect(() => requireWrite(mcpToolContext(result.scopes))).toThrow(/mcp:posts:write/);
  });

  it('applies no ceiling when allowedScopes is not configured', async () => {
    const result = await authenticate(['mcp:read', 'mcp:posts:write'], {});

    expect(result.authenticated).toBe(true);
    expect(result.scopes).toEqual(['mcp:read', 'mcp:posts:write']);
  });

  it('still requires mcp:read', async () => {
    const result = await authenticate(['mcp:posts:write'], {
      allowedScopes: ['mcp:read', 'mcp:posts:write'],
    });

    expect(result.authenticated).toBe(false);
    expect(result.reason).toContain('mcp:read');
  });

  it('requires every requested scope', () => {
    expect(requireScopes({ authenticated: true, scopes: ['mcp:read'] }, ['mcp:read'])).toBe(true);
    expect(requireScopes({ authenticated: true, scopes: ['mcp:read'] }, ['mcp:read', 'mcp:admin'])).toBe(false);
  });
});

describe('startMcp feature-flag scoping', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mcpServerConfigs.captured.length = 0;
  });

  const makeApp = (isDisabled: (flag: string) => boolean) => {
    const mounts: string[] = [];
    const mastraFn = vi.fn(async () => ({
      getAgent: () => ({ __getStaticAgents: () => ({}) }),
    }));
    const app = {
      get: (token: any) => {
        if (token === FeatureFlagsService) return { isDisabled };
        if (token === MastraService) return { mastra: mastraFn };
        if (token === AiSettingsManager) return { getSettings: async () => ({}) };
        if (token === LoadToolsService) return { loadTools: async () => ({ toolA: {} }) };
        if (token === IdempotencyFactory) return { getMiddleware: () => null };
        return {};
      },
      use: (path: string | string[]) => {
        mounts.push(...(Array.isArray(path) ? path : [path]));
      },
    } as any;
    return { app, mounts, mastraFn };
  };

  it('keeps the MCP surface mounted when only the agent is disabled', async () => {
    vi.stubEnv('BACKEND_URL', 'http://localhost:3000');
    const { app, mounts, mastraFn } = makeApp((flag) => flag === 'agent');

    await startMcp(app);

    expect(mounts).toEqual(
      expect.arrayContaining([
        '/mcp',
        '/mcp-oauth',
        '/mcp/:id',
        '/sse/:id',
        '/message/:id',
        '/.well-known/oauth-protected-resource',
        '/.well-known/oauth-authorization-server',
      ])
    );
    const config = mcpServerConfigs.captured.at(-1);
    expect(config.tools).toEqual({ toolA: {} });
    expect(config.agents).toEqual({});
    expect(mastraFn).not.toHaveBeenCalled();
  });

  it('advertises the Mastra agents when the agent is enabled', async () => {
    vi.stubEnv('BACKEND_URL', 'http://localhost:3000');
    const { app, mastraFn } = makeApp(() => false);

    await startMcp(app);

    expect(mastraFn).toHaveBeenCalled();
    expect(mcpServerConfigs.captured.at(-1).agents).toHaveProperty('postmill');
  });

  it('mounts nothing when MCP itself is disabled', async () => {
    const { app, mounts } = makeApp((flag) => flag === 'mcp');

    await startMcp(app);

    expect(mounts).toEqual([]);
    expect(mcpServerConfigs.captured).toEqual([]);
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
