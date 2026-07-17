import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('sharp', () => ({
  default: vi.fn(function() {
    return { metadata: vi.fn().mockResolvedValue({ width: 800, height: 600 }) };
  }),
}));

vi.mock('@gitroom/helpers/utils/timer', () => ({
  timer: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@gitroom/helpers/utils/read.or.fetch', () => ({
  readOrFetch: vi.fn().mockResolvedValue(Buffer.from('fake-image-data')),
}));

vi.mock('@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch', () => ({
  safeFetch: vi.fn((url: string, options?: RequestInit) => fetch(url, options)),
}));

import {
  SocialAbstract,
  NotEnoughScopes,
} from './social.abstract';
import { setSocialFetchPorts } from '@gitroom/provider-kernel';
import sharp from 'sharp';
import { timer } from '@gitroom/helpers/utils/timer';
import { readOrFetch } from '@gitroom/helpers/utils/read.or.fetch';
import {
  RefreshTokenError,
  BadBodyError,
} from '@gitroom/nestjs-libraries/inngest/errors';

// SocialAbstract was relocated into the kernel (step 7.5.2) and dereferences its
// security/runtime primitives from injected ports. Wire them with the mocked
// modules above so behaviour is identical to the pre-relocation direct imports.
setSocialFetchPorts({
  getVpnDispatcher: () => undefined,
  ssrfSafeDispatcher: undefined,
  isSafePublicHttpsUrl: async () => true,
  undiciFetch: ((...args: any[]) => (globalThis.fetch as any)(...args)) as any,
  RefreshTokenError,
  BadBodyError,
  timer,
  sharp,
  readOrFetch,
  safeFetch: (async () => ({})) as any,
});

class TestProvider extends SocialAbstract {
  identifier = 'test';
  maxConcurrentJob = 2;

  handleErrors(body: string, status: number) {
    if (body.includes('refresh_me')) return { type: 'refresh-token' as const, value: 'Need refresh' };
    if (body.includes('retry_me')) return { type: 'retry' as const, value: 'Retry later' };
    if (body.includes('bad_me')) return { type: 'bad-body' as const, value: 'Bad request' };
    return undefined;
  }
}

describe('RefreshTokenError', () => {
  it('is a retryable Error carrying identifier/json/body', () => {
    const err = new RefreshTokenError('x-id', '{"key":"val"}', 'body-content', 'Token expired');
    expect(err.message).toBe('Token expired');
    expect(err.identifier).toBe('x-id');
    expect(err.json).toBe('{"key":"val"}');
    expect(err.body).toBe('body-content');
  });
});

describe('BadBodyError', () => {
  it('is a non-retryable Inngest error carrying identifier/json/body', () => {
    const err = new BadBodyError('x-id', '{"key":"val"}', 'body-content', 'Invalid request');
    expect(err.message).toBe('Invalid request');
    expect(err.identifier).toBe('x-id');
    expect(err.json).toBe('{"key":"val"}');
    expect(err.body).toBe('body-content');
  });
});

describe('NotEnoughScopes', () => {
  it('has a default message', () => {
    const err = new NotEnoughScopes();
    expect(err.message).toContain('Not enough scopes');
  });

  it('accepts a custom message', () => {
    const err = new NotEnoughScopes('Custom missing scopes');
    expect(err.message).toBe('Custom missing scopes');
  });
});

describe('SocialAbstract', () => {
  let provider: TestProvider;

  beforeEach(() => {
    provider = new TestProvider();
  });

  describe('handleErrors', () => {
    it('returns undefined by default', () => {
      const result = provider.handleErrors('some body', 200);
      expect(result).toBeUndefined();
    });
  });

  describe('checkValidity', () => {
    it('returns true by default', async () => {
      const result = await provider.checkValidity([], {}, []);
      expect(result).toBe(true);
    });
  });

  describe('getImageDimensions', () => {
    it('resolves HTTP URLs directly', async () => {
      const dims = await provider.getImageDimensions('https://example.com/img.png');
      expect(dims).toEqual({ width: 800, height: 600 });
    });

    it('prepends FRONTEND_URL for relative paths', async () => {
      process.env.FRONTEND_URL = 'http://test.local';
      const dims = await provider.getImageDimensions('uploads/img.png');
      expect(dims).toEqual({ width: 800, height: 600 });
    });
  });

  describe('mention', () => {
    it('returns {none: true} by default', async () => {
      const result = await provider.mention('token', { query: 'test' }, 'id', {} as any);
      expect(result).toEqual({ none: true });
    });
  });

  describe('runInConcurrent', () => {
    it('returns the function result on success', async () => {
      const result = await provider.runInConcurrent(async () => 'success');
      expect(result).toBe('success');
    });

    it('throws RefreshTokenError when handleErrors returns refresh-token', async () => {
      const fn = vi.fn().mockRejectedValue({ message: 'refresh_me' });
      await expect(provider.runInConcurrent(fn)).rejects.toThrow(RefreshTokenError);
    });

    it('throws BadBodyError when function fails and handleErrors returns non-refresh', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('bad_me'));
      await expect(provider.runInConcurrent(fn)).rejects.toThrow(BadBodyError);
    });

    it('throws BadBodyError when handleErrors returns undefined', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('some error'));
      await expect(provider.runInConcurrent(fn)).rejects.toThrow(BadBodyError);
    });
  });

  describe('fetch', () => {
    let originalFetch: any;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('returns response for status 200', async () => {
      const mockResponse = { status: 200, text: vi.fn() } as any;
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);
      const result = await provider.fetch('https://api.example.com');
      expect(result).toBe(mockResponse);
    });

    it('returns response for status 201', async () => {
      const mockResponse = { status: 201, text: vi.fn() } as any;
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);
      const result = await provider.fetch('https://api.example.com');
      expect(result).toBe(mockResponse);
    });

    it('throws BadBodyError after 3 retries', async () => {
      const mockResponse = { status: 500, text: vi.fn().mockResolvedValue('server error') };
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);
      await expect(provider.fetch('https://api.example.com')).rejects.toThrow(BadBodyError);
    });

    it('retries on status 429', async () => {
      const mockResponse = { status: 429, text: vi.fn().mockResolvedValue('rate limited') };
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);
      await expect(provider.fetch('https://api.example.com')).rejects.toThrow(BadBodyError);
    });

    it('retries on rate_limit_exceeded in body', async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          status: 403,
          text: vi.fn().mockResolvedValue('rate_limit_exceeded'),
        });
      });
      await expect(provider.fetch('https://api.example.com')).rejects.toThrow(BadBodyError);
      expect(callCount).toBeGreaterThan(1);
    });

    it('retries on handleErrors type retry', async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          status: 400,
          text: vi.fn().mockResolvedValue('retry_me'),
        });
      });
      await expect(provider.fetch('https://api.example.com')).rejects.toThrow(BadBodyError);
      expect(callCount).toBeGreaterThan(1);
    });

    it('throws RefreshTokenError on 401 when handleErrors returns refresh-token', async () => {
      const mockResponse = { status: 401, text: vi.fn().mockResolvedValue('refresh_me') };
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);
      await expect(provider.fetch('https://api.example.com', {}, 'x-id')).rejects.toThrow(RefreshTokenError);
    });

    it('throws RefreshTokenError on handleErrors type refresh-token regardless of status', async () => {
      const mockResponse = { status: 403, text: vi.fn().mockResolvedValue('refresh_me') };
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);
      await expect(provider.fetch('https://api.example.com', {}, 'x-id')).rejects.toThrow(RefreshTokenError);
    });

    it('throws BadBodyError for other error status codes', async () => {
      const mockResponse = { status: 400, text: vi.fn().mockResolvedValue('bad_me') };
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);
      await expect(provider.fetch('https://api.example.com', {}, 'x-id')).rejects.toThrow(BadBodyError);
    });

    it('handles response.text() failure gracefully', async () => {
      const mockResponse = { status: 400, text: vi.fn().mockRejectedValue(new Error('parse fail')) };
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);
      await expect(provider.fetch('https://api.example.com')).rejects.toThrow(BadBodyError);
    });

    it('retries on 500 when handleErrors returns undefined, exhausting retries', async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          status: 500,
          text: vi.fn().mockResolvedValue('server error'),
        });
      });
      await expect(provider.fetch('https://api.example.com')).rejects.toThrow(BadBodyError);
      expect(callCount).toBe(4);
    });

    it('passes the correct message to BadBodyError on retry exhaustion', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 429,
        text: vi.fn().mockResolvedValue('rate limited'),
      });
      try {
        await provider.fetch('https://api.example.com');
      } catch (err: any) {
        expect(err.message).toContain('Unknown Error');
      }
    });
  });

  describe('checkScopes', () => {
    it('returns true when got is an array with all required scopes', () => {
      expect(provider.checkScopes(['read', 'write'], ['read', 'write', 'delete'])).toBe(true);
    });

    it('throws NotEnoughScopes when got array is missing a required scope', () => {
      expect(() => provider.checkScopes(['read', 'write'], ['read'])).toThrow(NotEnoughScopes);
    });

    it('returns true when got is a comma-separated string with all required scopes', () => {
      expect(provider.checkScopes(['read', 'write'], 'read,write,delete')).toBe(true);
    });

    it('returns true when got is a space-separated string with all required scopes', () => {
      expect(provider.checkScopes(['read', 'write'], 'read write delete')).toBe(true);
    });

    it('throws NotEnoughScopes when got string is missing a required scope', () => {
      expect(() => provider.checkScopes(['read', 'write'], 'read')).toThrow(NotEnoughScopes);
    });

    it('handles URL-encoded scope strings', () => {
      const encoded = encodeURIComponent('read write');
      expect(provider.checkScopes(['read', 'write'], encoded)).toBe(true);
    });

    it('throws NotEnoughScopes for empty got array', () => {
      expect(() => provider.checkScopes(['read'], [])).toThrow(NotEnoughScopes);
    });

    it('throws NotEnoughScopes for empty got string', () => {
      expect(() => provider.checkScopes(['read'], '')).toThrow(NotEnoughScopes);
    });
  });
});
