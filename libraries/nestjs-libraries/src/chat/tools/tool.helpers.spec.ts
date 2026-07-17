import { describe, it, expect, vi } from 'vitest';
import {
  getAccess,
  requireWrite,
  requireRead,
  parseOrg,
  parseUser,
  guardOutbound,
} from './tool.helpers';

const makeContext = (access: { mode: string; scopes?: string[] }) => ({
  requestContext: {
    get: (key: string) => {
      if (key === 'access') return JSON.stringify(access);
      return undefined;
    },
  },
});

const makeOrgUserContext = () => ({
  requestContext: {
    get: (key: string) => {
      if (key === 'organization') return JSON.stringify({ id: 'org-1', name: 'Acme' });
      if (key === 'user') return JSON.stringify({ id: 'user-1' });
      return undefined;
    },
  },
});

describe('tool.helpers', () => {
  describe('getAccess', () => {
    it('parses access from requestContext', () => {
      const ctx = makeContext({ mode: 'mcp', scopes: ['mcp:read'] });
      expect(getAccess(ctx)).toEqual({ mode: 'mcp', scopes: ['mcp:read'] });
    });

    it('returns null when access is missing', () => {
      expect(getAccess({ requestContext: { get: () => undefined } })).toBeNull();
    });

    it('returns null when access is invalid JSON', () => {
      const ctx = {
        requestContext: {
          get: () => 'not-json',
        },
      };
      expect(getAccess(ctx)).toBeNull();
    });
  });

  describe('requireWrite', () => {
    it('allows user mode', () => {
      expect(() => requireWrite(makeContext({ mode: 'user' }))).not.toThrow();
    });

    it('allows mcp mode with mcp:posts:write scope', () => {
      expect(() =>
        requireWrite(makeContext({ mode: 'mcp', scopes: ['mcp:read', 'mcp:posts:write'] }))
      ).not.toThrow();
    });

    it('denies mcp mode without mcp:posts:write scope', () => {
      expect(() => requireWrite(makeContext({ mode: 'mcp', scopes: ['mcp:read'] }))).toThrow(
        'mcp:posts:write scope required'
      );
    });

    it('denies headless mode', () => {
      expect(() => requireWrite(makeContext({ mode: 'headless' }))).toThrow(
        'headless runs are read-only'
      );
    });

    it('denies by default when access is missing', () => {
      expect(() => requireWrite({ requestContext: { get: () => undefined } })).toThrow(
        'no access context'
      );
    });

    it('denies unrecognized modes', () => {
      expect(() => requireWrite(makeContext({ mode: 'unknown' }))).toThrow(
        "unrecognized mode 'unknown'"
      );
    });
  });

  describe('requireRead', () => {
    it('allows user mode', () => {
      expect(() => requireRead(makeContext({ mode: 'user' }))).not.toThrow();
    });

    it('allows headless mode', () => {
      expect(() => requireRead(makeContext({ mode: 'headless' }))).not.toThrow();
    });

    it('allows mcp mode with mcp:read scope', () => {
      expect(() => requireRead(makeContext({ mode: 'mcp', scopes: ['mcp:read'] }))).not.toThrow();
    });

    it('denies mcp mode without mcp:read scope', () => {
      expect(() => requireRead(makeContext({ mode: 'mcp', scopes: ['mcp:posts:write'] }))).toThrow(
        'mcp:read scope required'
      );
    });

    it('denies by default when access is missing', () => {
      expect(() => requireRead({ requestContext: { get: () => undefined } })).toThrow(
        'no access context'
      );
    });
  });

  describe('parseOrg', () => {
    it('parses organization context', () => {
      expect(parseOrg(makeOrgUserContext())).toEqual({ id: 'org-1', name: 'Acme' });
    });

    it('throws when organization is missing', () => {
      expect(() => parseOrg({ requestContext: { get: () => undefined } })).toThrow(
        'Organization context missing'
      );
    });

    it('throws when organization is invalid JSON', () => {
      const ctx = { requestContext: { get: () => 'not-json' } };
      expect(() => parseOrg(ctx)).toThrow('Organization context is not valid JSON');
    });

    it('throws when organization has no id (empty object)', () => {
      const ctx = { requestContext: { get: () => JSON.stringify({}) } };
      expect(() => parseOrg(ctx)).toThrow('Organization context missing id');
    });

    it('throws on the MCP auth wrapper shape (org nested, no top-level id)', () => {
      const ctx = {
        requestContext: {
          get: () =>
            JSON.stringify({ org: { id: 'o1' }, userId: 'u1', role: 'admin' }),
        },
      };
      expect(() => parseOrg(ctx)).toThrow('Organization context missing id');
    });
  });

  describe('parseUser', () => {
    it('parses user context', () => {
      expect(parseUser(makeOrgUserContext())).toEqual({ id: 'user-1' });
    });

    it('throws when user is missing', () => {
      expect(() => parseUser({ requestContext: { get: () => undefined } })).toThrow(
        'User context missing'
      );
    });

    it('throws when user has no id', () => {
      const ctx = { requestContext: { get: () => JSON.stringify({ name: 'no-id' }) } };
      expect(() => parseUser(ctx)).toThrow('User context missing id');
    });
  });

  describe('guardOutbound', () => {
    it('passes content through unchanged when no output chain is configured', async () => {
      const guardrailService = {
        checkOutput: vi.fn().mockResolvedValue('hello world'),
      };
      const result = await guardOutbound(guardrailService as any, 'hello world', {
        userId: 'user-1',
        orgId: 'org-1',
      });
      expect(result).toBe('hello world');
      expect(guardrailService.checkOutput).toHaveBeenCalledWith('hello world', {
        userId: 'user-1',
        orgId: 'org-1',
      });
    });

    it('returns transformed content when guardrail modifies it', async () => {
      const guardrailService = {
        checkOutput: vi.fn().mockResolvedValue('sanitized content'),
      };
      const result = await guardOutbound(guardrailService as any, 'raw content', {});
      expect(result).toBe('sanitized content');
    });

    it('rejects when guardrail blocks content', async () => {
      const guardrailService = {
        checkOutput: vi.fn().mockRejectedValue(new Error('Content blocked')),
      };
      await expect(guardOutbound(guardrailService as any, 'bad content', {})).rejects.toThrow(
        'Content blocked'
      );
    });
  });
});
