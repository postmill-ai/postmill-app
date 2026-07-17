import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@gitroom/helpers/utils/timer', () => ({
  timer: vi.fn(async () => {}),
}));
import {
  InstagramProvider,
  INSTAGRAM_MAX_MEDIA_UPLOAD_POLL_ATTEMPTS,
  INSTAGRAM_MAX_CAROUSEL_CONTAINER_POLL_ATTEMPTS,
  INSTAGRAM_MAX_PAGES_PAGINATION_DEPTH,
} from './instagram-base';
import { setSocialFetchPorts, SocialFetchPorts } from '../social-base';
import { Integration } from '@prisma/client';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function setupPorts(
  fetchMock: (url: string, init?: RequestInit) => Promise<Response>
): SocialFetchPorts {
  return {
    getVpnDispatcher: () => undefined,
    ssrfSafeDispatcher: {} as any,
    isSafePublicHttpsUrl: async () => true,
    undiciFetch: fetchMock as any,
    RefreshTokenError: class extends Error {},
    BadBodyError: class extends Error {},
    timer: vi.fn(async () => {}),
    sharp: undefined as any,
    readOrFetch: vi.fn(async () => Buffer.from('')),
    safeFetch: fetchMock as any,
  };
}

describe('InstagramProvider', () => {
  let provider: InstagramProvider;

  beforeEach(() => {
    provider = new InstagramProvider();
  });

  afterEach(() => {
    // Reset ports between tests so later specs get a clean mock.
    setSocialFetchPorts({} as SocialFetchPorts);
  });

  describe('POLL-02 — single-media upload IN_PROGRESS polling cap', () => {
    it('stops polling after the max attempt cap and rejects with a terminal error', async () => {
      const undiciFetch = vi.fn(async (url: string) => {
        if (url.includes('/media?') && !url.includes('/media_publish')) {
          return jsonResponse({ id: 'MEDIA_1' });
        }
        // status poll — always IN_PROGRESS
        return jsonResponse({ status_code: 'IN_PROGRESS' });
      });
      setSocialFetchPorts(setupPorts(undiciFetch));

      const postDetails = [
        {
          id: 'post1',
          message: 'hello',
          settings: {},
          media: [{ path: 'https://cdn.example.com/image.jpg' }],
        },
      ] as any;

      await expect(
        provider.post('igId', 'access___user', postDetails, {} as Integration)
      ).rejects.toThrow(/exceeded/);

      const statusPolls = undiciFetch.mock.calls.filter(([url]) =>
        (url as string).includes('fields=status_code')
      );
      expect(statusPolls.length).toBe(INSTAGRAM_MAX_MEDIA_UPLOAD_POLL_ATTEMPTS);
    });
  });

  describe('POLL-03 — carousel IN_PROGRESS polling cap', () => {
    it('stops polling the carousel container after the max attempt cap', async () => {
      let mediaIndex = 0;
      const undiciFetch = vi.fn(async (url: string, init?: RequestInit) => {
        const method = (init as any)?.method ?? 'GET';

        // media creation POSTs
        if (url.includes('/media?') && method === 'POST') {
          if (url.includes('media_type=CAROUSEL')) {
            return jsonResponse({ id: 'CAROUSEL_CONTAINER_1' });
          }
          return jsonResponse({ id: `MEDIA_${++mediaIndex}` });
        }

        // media_publish POSTs
        if (url.includes('/media_publish') && method === 'POST') {
          return jsonResponse({ id: 'PUBLISHED_1' });
        }

        // status polls for individual media items — finish immediately
        if (url.includes('fields=status_code') && !url.includes('CAROUSEL_CONTAINER')) {
          return jsonResponse({ status_code: 'FINISHED' });
        }

        // carousel container status poll — never finishes
        return jsonResponse({ status_code: 'IN_PROGRESS' });
      });
      setSocialFetchPorts(setupPorts(undiciFetch));

      const postDetails = [
        {
          id: 'post2',
          message: 'carousel',
          settings: {},
          media: [
            { path: 'https://cdn.example.com/a.jpg' },
            { path: 'https://cdn.example.com/b.jpg' },
          ],
        },
      ] as any;

      await expect(
        provider.post('igId', 'access___user', postDetails, {} as Integration)
      ).rejects.toThrow(/exceeded/);

      const carouselStatusPolls = undiciFetch.mock.calls.filter(([url]) => {
        const u = url as string;
        return u.includes('fields=status_code') && u.includes('CAROUSEL_CONTAINER');
      });
      expect(carouselStatusPolls.length).toBe(
        INSTAGRAM_MAX_CAROUSEL_CONTAINER_POLL_ATTEMPTS
      );
    });
  });

  describe('POLL-10 — pages() pagination cap', () => {
    it('stops the page-discovery loop after the configured page cap', async () => {
      const undiciFetch = vi.fn(async (url: string) => {
        const u = url as string;

        if (u.includes('/me/accounts')) {
          return jsonResponse({
            data: [
              {
                id: 'PAGE_1',
                instagram_business_account: { id: 'IG_1' },
                username: 'page1',
                name: 'Page 1',
                picture: { data: { url: 'https://example.com/p1.jpg' } },
              },
            ],
            paging: {
              next: 'https://graph.facebook.com/v20.0/me/accounts?next=1',
            },
          });
        }

        if (u.includes('/me/businesses')) {
          return jsonResponse({ data: [], paging: {} });
        }

        if (u.includes('/IG_1?fields=name,profile_picture_url')) {
          return jsonResponse({
            name: 'IG Page',
            profile_picture_url: 'https://example.com/ig.jpg',
          });
        }

        return jsonResponse({});
      });
      setSocialFetchPorts(setupPorts(undiciFetch));

      const result = await provider.pages('access___user');
      expect(result.length).toBeGreaterThan(0);

      const accountCalls = undiciFetch.mock.calls.filter(([url]) =>
        (url as string).includes('/me/accounts')
      );
      expect(accountCalls.length).toBe(INSTAGRAM_MAX_PAGES_PAGINATION_DEPTH);
    });
  });

  describe('FETCH-03 — page/analytics calls route through this.fetch()', () => {
    it('routes analytics() calls through this.fetch()', async () => {
      const undiciFetch = vi.fn(async () => jsonResponse({ data: [] }));
      setSocialFetchPorts(setupPorts(undiciFetch));

      await provider.analytics('igId', 'access___user', 30);

      const insightCalls = undiciFetch.mock.calls.filter(([url]) =>
        (url as string).includes('/insights')
      );
      expect(insightCalls.length).toBe(2);
      expect(insightCalls.every(([url]) => (url as string).startsWith('https://'))).toBe(true);
    });

    it('routes pages() calls through this.fetch()', async () => {
      const undiciFetch = vi.fn(async (url: string) => {
        const u = url as string;
        if (u.includes('/me/accounts')) {
          return jsonResponse({
            data: [
              {
                id: 'PAGE_1',
                instagram_business_account: { id: 'IG_1' },
                username: 'page1',
                name: 'Page 1',
                picture: { data: { url: 'https://example.com/p1.jpg' } },
              },
            ],
            paging: {},
          });
        }
        if (u.includes('/me/businesses')) {
          return jsonResponse({ data: [], paging: {} });
        }
        if (u.includes('/IG_1?fields=name,profile_picture_url')) {
          return jsonResponse({
            name: 'IG Page',
            profile_picture_url: 'https://example.com/ig.jpg',
          });
        }
        return jsonResponse({});
      });
      setSocialFetchPorts(setupPorts(undiciFetch));

      await provider.pages('access___user');

      const accountCalls = undiciFetch.mock.calls.filter(([url]) =>
        (url as string).includes('/me/accounts')
      );
      expect(accountCalls.length).toBeGreaterThan(0);
    });
  });
});
