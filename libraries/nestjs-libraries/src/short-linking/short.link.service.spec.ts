import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ShortLinkService } from './short.link.service';
import { ProviderResolutionService } from '@gitroom/nestjs-libraries/providers/provider-resolution.service';
import { OrgShortLinkSettingsService } from '@gitroom/nestjs-libraries/database/prisma/short-links/org-shortlink-settings.service';
import { OrgShortLinkSettingsRepository } from '@gitroom/nestjs-libraries/database/prisma/short-links/org-shortlink-settings.repository';
import type { ShortLinkAdapter, ShortLinkCapabilities, ShortLinkContext, ShortLinkStat } from './short-link.interface';

const mockCapabilities: ShortLinkCapabilities = {
  create: true,
  expand: true,
  statistics: true,
  bulkStatistics: true,
  customDomain: true,
};

const createMockAdapter = (
  id: string,
  opts?: {
    caps?: Partial<ShortLinkCapabilities>;
    domain?: string;
    createResult?: { shortUrl: string; providerLinkId?: string };
    statsResult?: ShortLinkStat[];
    listResult?: ShortLinkStat[];
    expandImpl?: (ctx: ShortLinkContext, shortUrl: string) => Promise<string>;
  },
): ShortLinkAdapter => ({
  identifier: id,
  name: `Adapter ${id}`,
  credentialFields: [],
  capabilities: { ...mockCapabilities, ...opts?.caps },
  authType: 'apiKey',
  resolveDomain: () => opts?.domain ?? id,
  validateCredentials: vi.fn().mockResolvedValue({ ok: true }),
  createShortLink: vi.fn().mockResolvedValue(opts?.createResult ?? { shortUrl: `https://${id}/abc` }),
  expandShortLink: vi.fn().mockImplementation(
    opts?.expandImpl ?? (async (_ctx, shortUrl) => shortUrl.replace(/short/, 'long')),
  ),
  linkStatistics: vi.fn().mockResolvedValue(opts?.statsResult ?? []),
  listLinks: vi.fn().mockResolvedValue(opts?.listResult ?? []),
});

const makeActiveProvider = (id: string, creds = { apiKey: 'key' }) => ({
  identifier: id,
  name: `Adapter ${id}`,
  capabilities: mockCapabilities,
  customDomain: undefined as string | undefined,
  credentials: creds,
  version: 'v1',
});

const registerAdapter = (map: Map<string, ShortLinkAdapter>, adapter: ShortLinkAdapter) => {
  map.set(adapter.identifier, adapter);
};

describe('ShortLinkService', () => {
  let service: ShortLinkService;
  let resolution: ProviderResolutionService;
  let settingsService: OrgShortLinkSettingsService;
  let repository: OrgShortLinkSettingsRepository;
  let adapterMap: Map<string, ShortLinkAdapter>;

  const orgId = 'org-1';

  beforeEach(() => {
    adapterMap = new Map();
    resolution = {
      resolveShortLink: vi.fn((identifier: string, options: { version?: string; credentials?: Record<string, string>; orgId?: string }) => {
        const adapter = adapterMap.get(identifier);
        if (!adapter) {
          throw new Error(`Short-link provider ${identifier} not found`);
        }
        return adapter;
      }),
    } as unknown as ProviderResolutionService;
    settingsService = {
      getActiveProvider: vi.fn(),
      getProviders: vi.fn(),
      upsert: vi.fn(),
      setActive: vi.fn(),
      delete: vi.fn(),
      testConnection: vi.fn(),
    } as any;
    repository = {
      recordLink: vi.fn().mockResolvedValue(undefined),
      getByOrg: vi.fn(),
      getByIdentifier: vi.fn(),
      getActive: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      setActive: vi.fn(),
      findLinkByShortUrl: vi.fn(),
      getLinksForOrg: vi.fn(),
      upsertSnapshotFull: vi.fn(),
      getSnapshotsForLinks: vi.fn(),
      pruneSnapshots: vi.fn(),
      getAggregatedClicks: vi.fn(),
    } as any;

    service = new ShortLinkService(settingsService as OrgShortLinkSettingsService, repository as OrgShortLinkSettingsRepository, resolution);
  });

  describe('askShortLinkedin', () => {
    it('returns false when no active provider', async () => {
      (settingsService.getActiveProvider as any).mockResolvedValue(null);
      const result = await service.askShortLinkedin(orgId, ['check https://example.com']);
      expect(result).toBe(false);
    });

    it('returns false when active provider adapter is not in registry', async () => {
      (settingsService.getActiveProvider as any).mockResolvedValue(makeActiveProvider('unknown'));
      const result = await service.askShortLinkedin(orgId, ['check https://example.com']);
      expect(result).toBe(false);
    });

    it('returns false when domain is empty', async () => {
      registerAdapter(adapterMap, createMockAdapter('bitly', { domain: 'empty' }));
      (settingsService.getActiveProvider as any).mockResolvedValue(makeActiveProvider('bitly'));
      const result = await service.askShortLinkedin(orgId, ['check https://example.com']);
      expect(result).toBe(false);
    });

    it('returns false when messages contain no URLs', async () => {
      registerAdapter(adapterMap, createMockAdapter('bitly', { domain: 'bit.ly' }));
      (settingsService.getActiveProvider as any).mockResolvedValue(makeActiveProvider('bitly'));
      const result = await service.askShortLinkedin(orgId, ['hello world']);
      expect(result).toBe(false);
    });

    it('returns false when all URLs are already short links', async () => {
      registerAdapter(adapterMap, createMockAdapter('bitly', { domain: 'bit.ly' }));
      (settingsService.getActiveProvider as any).mockResolvedValue(makeActiveProvider('bitly'));
      const result = await service.askShortLinkedin(orgId, ['check https://bit.ly/abc']);
      expect(result).toBe(false);
    });

    it('returns true when there is a URL not pointing to the short-link domain', async () => {
      registerAdapter(adapterMap, createMockAdapter('bitly', { domain: 'bit.ly' }));
      (settingsService.getActiveProvider as any).mockResolvedValue(makeActiveProvider('bitly'));
      const result = await service.askShortLinkedin(orgId, ['check https://example.com/page']);
      expect(result).toBe(true);
    });

    it('passes orgId to getActiveProvider', async () => {
      (settingsService.getActiveProvider as any).mockResolvedValue(null);
      await service.askShortLinkedin(orgId, ['']);
      expect(settingsService.getActiveProvider).toHaveBeenCalledWith(orgId);
    });
  });

  describe('convertTextToShortLinks', () => {
    it('returns original messages when no active provider (passthrough)', async () => {
      (settingsService.getActiveProvider as any).mockResolvedValue(null);
      const messages = ['check https://example.com/long'];
      const result = await service.convertTextToShortLinks(orgId, messages);
      expect(result).toEqual(messages);
    });

    it('returns original messages when adapter not in registry', async () => {
      (settingsService.getActiveProvider as any).mockResolvedValue(makeActiveProvider('missing'));
      const messages = ['check https://example.com/long'];
      const result = await service.convertTextToShortLinks(orgId, messages);
      expect(result).toEqual(messages);
    });

    it('shortens URLs and records links in the ledger', async () => {
      const adapter = createMockAdapter('bitly', {
        domain: 'bit.ly',
        createResult: { shortUrl: 'https://bit.ly/short1', providerLinkId: 'lnk_1' },
      });
      adapterMap.set(adapter.identifier, adapter);
      (settingsService.getActiveProvider as any).mockResolvedValue(makeActiveProvider('bitly'));

      const result = await service.convertTextToShortLinks(orgId, ['check https://example.com/long']);
      expect(result[0]).toContain('https://bit.ly/short1');
      expect(repository.recordLink).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: orgId,
          provider: 'bitly',
          shortUrl: 'https://bit.ly/short1',
          originalUrl: 'https://example.com/long',
          providerLinkId: 'lnk_1',
        }),
      );
    });

    it('skips URLs that are already short links on the same domain', async () => {
      const adapter = createMockAdapter('bitly', { domain: 'bit.ly' });
      adapterMap.set(adapter.identifier, adapter);
      (settingsService.getActiveProvider as any).mockResolvedValue(makeActiveProvider('bitly'));

      const result = await service.convertTextToShortLinks(orgId, ['check https://bit.ly/already-short']);
      expect(result[0]).toBe('check https://bit.ly/already-short');
      expect(repository.recordLink).not.toHaveBeenCalled();
      expect(adapter.createShortLink).not.toHaveBeenCalled();
    });

    it('handles multiple URLs in a single message', async () => {
      const shortCount = { a: false, b: false };
      const adapter = createMockAdapter('bitly', { domain: 'bit.ly' });
      adapter.createShortLink = async (_ctx, url) => {
        if (url === 'https://a.com') { shortCount.a = true; return { shortUrl: 'https://bit.ly/a' }; }
        if (url === 'https://b.com') { shortCount.b = true; return { shortUrl: 'https://bit.ly/b' }; }
        return { shortUrl: `https://bit.ly/other` };
      };
      adapterMap.set(adapter.identifier, adapter);
      (settingsService.getActiveProvider as any).mockResolvedValue(makeActiveProvider('bitly'));

      const result = await service.convertTextToShortLinks(orgId, ['see https://a.com and https://b.com']);
      expect(shortCount.a).toBe(true);
      expect(shortCount.b).toBe(true);
      expect(result[0]).toContain('https://bit.ly/a');
      expect(result[0]).toContain('https://bit.ly/b');
    });

    it('falls back to original URL on shorten failure', async () => {
      const adapter = createMockAdapter('bitly', { domain: 'bit.ly' });
      adapter.createShortLink = async () => { throw new Error('API error'); };
      adapterMap.set(adapter.identifier, adapter);
      (settingsService.getActiveProvider as any).mockResolvedValue(makeActiveProvider('bitly'));

      const result = await service.convertTextToShortLinks(orgId, ['check https://example.com/long']);
      expect(result[0]).toContain('https://example.com/long');
    });

    it('handles ledger recording failure gracefully', async () => {
      const adapter = createMockAdapter('bitly', {
        domain: 'bit.ly',
        createResult: { shortUrl: 'https://bit.ly/short1' },
      });
      adapterMap.set(adapter.identifier, adapter);
      (settingsService.getActiveProvider as any).mockResolvedValue(makeActiveProvider('bitly'));
      (repository.recordLink as any).mockRejectedValue(new Error('DB error'));

      const result = await service.convertTextToShortLinks(orgId, ['check https://example.com/long']);
      expect(result[0]).toContain('https://bit.ly/short1');
    });

    it('uniqifies duplicate URLs before shortening', async () => {
      let callCount = 0;
      const adapter = createMockAdapter('bitly', { domain: 'bit.ly' });
      adapter.createShortLink = async () => { callCount++; return { shortUrl: 'https://bit.ly/abc' }; };
      adapterMap.set(adapter.identifier, adapter);
      (settingsService.getActiveProvider as any).mockResolvedValue(makeActiveProvider('bitly'));

      await service.convertTextToShortLinks(orgId, ['a https://example.com/p b https://example.com/p c']);
      expect(callCount).toBe(1);
    });

    // N4: map-miss fallback — URL not in replacementMap returns original URL
    it('returns original URL when replacement map has no entry (map-miss fallback)', async () => {
      const adapter = createMockAdapter('bitly', { domain: 'bit.ly' });
      adapter.createShortLink = async (_ctx: any, url: string) => {
        if (url === 'https://example.com/a') return { shortUrl: 'https://bit.ly/a' };
        throw new Error('fail');
      };
      adapterMap.set(adapter.identifier, adapter);
      (settingsService.getActiveProvider as any).mockResolvedValue(makeActiveProvider('bitly'));

      // URL 'https://example.com/a' succeeds; 'https://example.com/b' fails and stays as original
      const result = await service.convertTextToShortLinks(orgId, [
        'a https://example.com/a and https://example.com/b',
      ]);
      expect(result[0]).toContain('https://bit.ly/a');
      expect(result[0]).toContain('https://example.com/b');
    });
  });

  describe('convertShortLinksToLinks', () => {
    it('returns original messages when no active provider', async () => {
      (settingsService.getActiveProvider as any).mockResolvedValue(null);
      const messages = ['check https://bit.ly/abc'];
      const result = await service.convertShortLinksToLinks(orgId, messages);
      expect(result).toEqual(messages);
    });

    it('returns original messages when adapter has no expandShortLink', async () => {
      const adapter = createMockAdapter('bitly', { caps: { expand: false }, domain: 'bit.ly' });
      delete (adapter as any).expandShortLink;
      adapterMap.set(adapter.identifier, adapter);
      (settingsService.getActiveProvider as any).mockResolvedValue(makeActiveProvider('bitly'));

      const result = await service.convertShortLinksToLinks(orgId, ['check https://bit.ly/abc']);
      expect(result[0]).toBe('check https://bit.ly/abc');
    });

    it('expands short links matching the domain', async () => {
      const adapter = createMockAdapter('bitly', {
        domain: 'bit.ly',
        expandImpl: async () => 'https://example.com/original',
      });
      adapterMap.set(adapter.identifier, adapter);
      (settingsService.getActiveProvider as any).mockResolvedValue(makeActiveProvider('bitly'));

      const result = await service.convertShortLinksToLinks(orgId, ['check https://bit.ly/abc']);
      expect(result[0]).toBe('check https://example.com/original');
    });

    it('does not expand URLs on a different domain', async () => {
      const adapter = createMockAdapter('bitly', { domain: 'bit.ly' });
      adapterMap.set(adapter.identifier, adapter);
      (settingsService.getActiveProvider as any).mockResolvedValue(makeActiveProvider('bitly'));

      const result = await service.convertShortLinksToLinks(orgId, ['check https://other.com/page']);
      expect(result[0]).toBe('check https://other.com/page');
    });

    it('falls back to original URL on expand failure', async () => {
      const adapter = createMockAdapter('bitly', {
        domain: 'bit.ly',
        expandImpl: async () => { throw new Error('API down'); },
      });
      adapterMap.set(adapter.identifier, adapter);
      (settingsService.getActiveProvider as any).mockResolvedValue(makeActiveProvider('bitly'));

      const result = await service.convertShortLinksToLinks(orgId, ['check https://bit.ly/abc']);
      expect(result[0]).toBe('check https://bit.ly/abc');
    });

    // N11: map-miss fallback — URL not in replacementMap returns original URL
    it('returns original URL when replacement map has no entry (convertShortLinksToLinks)', async () => {
      const adapter = createMockAdapter('bitly', {
        domain: 'bit.ly',
        expandImpl: async (_, url) => {
          if (url === 'https://bit.ly/a') return 'https://example.com/original';
          throw new Error('not found');
        },
      });
      adapterMap.set(adapter.identifier, adapter);
      (settingsService.getActiveProvider as any).mockResolvedValue(makeActiveProvider('bitly'));

      const result = await service.convertShortLinksToLinks(orgId, [
        'check https://bit.ly/a and https://bit.ly/b',
      ]);
      expect(result[0]).toContain('https://example.com/original');
      expect(result[0]).toContain('https://bit.ly/b');
    });
  });

  describe('getStatistics', () => {
    it('returns empty array when no active provider', async () => {
      (settingsService.getActiveProvider as any).mockResolvedValue(null);
      const result = await service.getStatistics(orgId, ['https://bit.ly/a']);
      expect(result).toEqual([]);
    });

    it('returns empty array when adapter has no linkStatistics', async () => {
      const adapter = createMockAdapter('bitly', { caps: { statistics: false }, domain: 'bit.ly' });
      delete (adapter as any).linkStatistics;
      adapterMap.set(adapter.identifier, adapter);
      (settingsService.getActiveProvider as any).mockResolvedValue(makeActiveProvider('bitly'));

      const result = await service.getStatistics(orgId, ['https://bit.ly/a']);
      expect(result).toEqual([]);
    });

    it('returns stats when adapter supports it', async () => {
      const stats: ShortLinkStat[] = [{ short: 'https://bit.ly/a', original: '', clicks: '42' }];
      const adapter = createMockAdapter('bitly', { domain: 'bit.ly', statsResult: stats });
      adapterMap.set(adapter.identifier, adapter);
      (settingsService.getActiveProvider as any).mockResolvedValue(makeActiveProvider('bitly'));

      const result = await service.getStatistics(orgId, ['check https://bit.ly/a']);
      expect(result).toEqual(stats);
    });

    it('filters URLs by domain', async () => {
      const adapter = createMockAdapter('bitly', { domain: 'bit.ly', statsResult: [] });
      adapterMap.set(adapter.identifier, adapter);
      (settingsService.getActiveProvider as any).mockResolvedValue(makeActiveProvider('bitly'));

      await service.getStatistics(orgId, ['check https://other.com/page']);
      expect(adapter.linkStatistics).not.toHaveBeenCalled();
    });

    it('returns empty array on adapter error', async () => {
      const adapter = createMockAdapter('bitly', { domain: 'bit.ly' });
      adapter.linkStatistics = async () => { throw new Error('API error'); };
      adapterMap.set(adapter.identifier, adapter);
      (settingsService.getActiveProvider as any).mockResolvedValue(makeActiveProvider('bitly'));

      const result = await service.getStatistics(orgId, ['check https://bit.ly/a']);
      expect(result).toEqual([]);
    });

    // N3: regex escaping for multi-dot domains (e.g. "app.link")
    it('escapes special regex characters in domain (multi-dot)', async () => {
      const adapter = createMockAdapter('app', { domain: 'app.link', statsResult: [] });
      adapterMap.set(adapter.identifier, adapter);
      (settingsService.getActiveProvider as any).mockResolvedValue(makeActiveProvider('app'));

      await service.getStatistics(orgId, ['check https://app.link/abc']);
      expect(adapter.linkStatistics).toHaveBeenCalledWith(
        expect.any(Object),
        ['https://app.link/abc'],
      );
    });

    it('matches short links on multi-dot domains', async () => {
      const stats: ShortLinkStat[] = [{ short: 'https://my.shrt.co/x', original: '', clicks: '7' }];
      const adapter = createMockAdapter('shrt', { domain: 'my.shrt.co', statsResult: stats });
      adapterMap.set(adapter.identifier, adapter);
      (settingsService.getActiveProvider as any).mockResolvedValue(makeActiveProvider('shrt'));

      const result = await service.getStatistics(orgId, ['check https://my.shrt.co/x']);
      expect(result).toEqual(stats);
    });
  });

  describe('getAllLinks', () => {
    it('returns empty array when no active provider', async () => {
      (settingsService.getActiveProvider as any).mockResolvedValue(null);
      const result = await service.getAllLinks(orgId);
      expect(result).toEqual([]);
    });

    it('returns empty array when adapter has no listLinks', async () => {
      const adapter = createMockAdapter('bitly', { caps: { statistics: false } });
      delete (adapter as any).listLinks;
      adapterMap.set(adapter.identifier, adapter);
      (settingsService.getActiveProvider as any).mockResolvedValue(makeActiveProvider('bitly'));

      const result = await service.getAllLinks(orgId);
      expect(result).toEqual([]);
    });

    it('returns paginated link list from adapter (single page)', async () => {
      const listResult: ShortLinkStat[] = [
        { short: 'https://bit.ly/a', original: 'https://example.com/1', clicks: '5' },
      ];
      const adapter = createMockAdapter('bitly', { listResult });
      adapterMap.set(adapter.identifier, adapter);
      (settingsService.getActiveProvider as any).mockResolvedValue(makeActiveProvider('bitly'));

      const result = await service.getAllLinks(orgId);
      expect(result).toEqual(listResult);
      expect(adapter.listLinks).toHaveBeenCalledWith(
        expect.objectContaining({ orgId, credentials: { apiKey: 'key' } }),
        1,
      );
    });

    // N5: pagination — multiple pages until fewer than 50 results
    it('iterates pages when adapter.listLinks returns full pages', async () => {
      const page1 = Array.from({ length: 50 }, (_, i) => ({
        short: `https://bit.ly/p1-${i}`, original: `https://ex.com/${i}`, clicks: '1',
      }));
      const page2 = Array.from({ length: 20 }, (_, i) => ({
        short: `https://bit.ly/p2-${i}`, original: `https://ex.com/${i + 50}`, clicks: '2',
      }));
      let callCount = 0;
      const adapter = createMockAdapter('bitly', { domain: 'bit.ly' });
      adapter.listLinks = vi.fn().mockImplementation(async (_ctx: any, page: number) => {
        callCount++;
        if (page === 1) return page1;
        if (page === 2) return page2;
        return [];
      });
      adapterMap.set(adapter.identifier, adapter);
      (settingsService.getActiveProvider as any).mockResolvedValue(makeActiveProvider('bitly'));

      const result = await service.getAllLinks(orgId);
      expect(callCount).toBe(2);
      expect(result).toHaveLength(70);
    });

    it('stops at maxPages even if every page returns 50 results', async () => {
      const fullPage = Array.from({ length: 50 }, (_, i) => ({
        short: `https://bit.ly/${i}`, original: `https://ex.com/${i}`, clicks: '0',
      }));
      const adapter = createMockAdapter('bitly', { domain: 'bit.ly' });
      adapter.listLinks = vi.fn().mockResolvedValue(fullPage);
      adapterMap.set(adapter.identifier, adapter);
      (settingsService.getActiveProvider as any).mockResolvedValue(makeActiveProvider('bitly'));

      const result = await service.getAllLinks(orgId);
      // maxPages = 10, so 10 * 50 = 500
      expect(result).toHaveLength(500);
    });

    it('returns empty array on adapter error', async () => {
      const adapter = createMockAdapter('bitly', {});
      adapter.listLinks = async () => { throw new Error('API error'); };
      adapterMap.set(adapter.identifier, adapter);
      (settingsService.getActiveProvider as any).mockResolvedValue(makeActiveProvider('bitly'));

      const result = await service.getAllLinks(orgId);
      expect(result).toEqual([]);
    });
  });
});
