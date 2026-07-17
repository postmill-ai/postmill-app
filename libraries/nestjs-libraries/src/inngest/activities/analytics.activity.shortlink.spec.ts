import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger } from '@nestjs/common';
import dayjs from 'dayjs';

vi.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: vi.fn(),
}));

vi.mock('@gitroom/nestjs-libraries/integrations/provider-config.manager', () => ({
  ProviderConfigManager: vi.fn(),
}));

vi.mock('@gitroom/nestjs-libraries/database/prisma/prisma.service', () => ({
  PrismaService: vi.fn(),
}));

vi.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.service', () => ({
  OrganizationService: vi.fn(),
}));

vi.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({
  IntegrationService: vi.fn(),
}));

vi.mock('@gitroom/nestjs-libraries/integrations/refresh.integration.service', () => ({
  RefreshIntegrationService: vi.fn(),
}));

vi.mock('@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service', () => ({
  WebhooksService: vi.fn(),
}));

vi.mock('@gitroom/nestjs-libraries/database/prisma/watchlist/watchlist.service', () => ({
  WatchlistService: vi.fn(),
}));

vi.mock('@gitroom/nestjs-libraries/database/prisma/emails/email-log.service', () => ({
  EmailLogService: vi.fn(),
}));

const mockGetActiveProvider = vi.fn();
const mockGetLinksForOrg = vi.fn();
const mockUpsertSnapshotsBatch = vi.fn();
const mockPruneSnapshots = vi.fn();

vi.mock(
  '@gitroom/nestjs-libraries/database/prisma/short-links/org-shortlink-settings.service',
  () => ({
    OrgShortLinkSettingsService: class {
      getActiveProvider = mockGetActiveProvider;
      getLinksForOrg = mockGetLinksForOrg;
      upsertSnapshotsBatch = mockUpsertSnapshotsBatch;
      pruneSnapshots = mockPruneSnapshots;
    },
  }),
);

const mockResolveShortLink = vi.fn();

vi.mock('@gitroom/nestjs-libraries/providers/provider-resolution.service', () => ({
  ProviderResolutionService: class {
    resolveShortLink = mockResolveShortLink;
  },
}));

import { AnalyticsActivity } from '@gitroom/nestjs-libraries/inngest/activities/analytics.activity';

type Mocked<T> = T & {
  [K in keyof T]: T[K] extends (...args: any[]) => any
    ? ReturnType<typeof vi.fn>
    : T[K];
};

function stubAdapter(overrides: Record<string, any> = {}) {
  return {
    identifier: 'bitly',
    name: 'Bitly',
    capabilities: {
      create: true,
      expand: false,
      statistics: true,
      bulkStatistics: false,
      customDomain: true,
    },
    linkStatistics: vi.fn(),
    validateCredentials: vi.fn(),
    resolveDomain: vi.fn(),
    credentialFields: [] as Array<{
      key: string;
      label: string;
      type: string;
      required: boolean;
    }>,
    authType: 'apiKey',
    ...overrides,
  };
}

describe('AnalyticsActivity — short-link snapshots', () => {
  let activity: AnalyticsActivity;
  let shortLinkSettingsService: {
    getActiveProvider: ReturnType<typeof vi.fn>;
    getLinksForOrg: ReturnType<typeof vi.fn>;
    upsertSnapshotsBatch: ReturnType<typeof vi.fn>;
    pruneSnapshots: ReturnType<typeof vi.fn>;
  };
  let resolution: { resolveShortLink: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

    shortLinkSettingsService = {
      getActiveProvider: mockGetActiveProvider,
      getLinksForOrg: mockGetLinksForOrg,
      upsertSnapshotsBatch: mockUpsertSnapshotsBatch,
      pruneSnapshots: mockPruneSnapshots,
    };
    resolution = { resolveShortLink: mockResolveShortLink };

    activity = new AnalyticsActivity(
      {} as any, // _analyticsService
      {} as any, // _integrationManager
      {} as any, // _orgProviderConfigManager
      {} as any, // _organizationService
      {} as any, // _integrationService
      {} as any, // _refreshIntegrationService
      {} as any, // _webhooksService
      {} as any, // _watchlistService
      shortLinkSettingsService as any,
      resolution as any,
      {} as any, // _emailLogService
      {} as any, // _notificationService
    );
  });

  // ---------------------------------------------------------------------------
  // collectShortLinkSnapshots
  // ---------------------------------------------------------------------------
  describe('collectShortLinkSnapshots', () => {
    const orgId = 'org-1';

    it('no-ops when there is no active provider', async () => {
      mockGetActiveProvider.mockResolvedValue(null);

      await activity.collectShortLinkSnapshots(orgId);

      expect(mockResolveShortLink).not.toHaveBeenCalled();
      expect(mockGetLinksForOrg).not.toHaveBeenCalled();
    });

    it('no-ops when the active provider has no matching adapter in the registry', async () => {
      mockGetActiveProvider.mockResolvedValue({
        identifier: 'unknown-provider',
      });
      mockResolveShortLink.mockReturnValue(undefined);

      await activity.collectShortLinkSnapshots(orgId);

      expect(mockGetLinksForOrg).not.toHaveBeenCalled();
    });

    it('no-ops when the adapter does not support statistics', async () => {
      const adapter = stubAdapter({
        capabilities: { create: true, statistics: false },
      });
      mockGetActiveProvider.mockResolvedValue({
        identifier: 'bitly',
        credentials: {},
      });
      mockResolveShortLink.mockReturnValue(adapter);

      await activity.collectShortLinkSnapshots(orgId);

      expect(mockGetLinksForOrg).not.toHaveBeenCalled();
    });

    it('no-ops when the adapter has no linkStatistics method', async () => {
      const adapter = stubAdapter({
        capabilities: { create: true, statistics: true },
        linkStatistics: undefined,
      });
      mockGetActiveProvider.mockResolvedValue({
        identifier: 'bitly',
        credentials: {},
      });
      mockResolveShortLink.mockReturnValue(adapter);

      await activity.collectShortLinkSnapshots(orgId);

      expect(mockGetLinksForOrg).not.toHaveBeenCalled();
    });

    it('no-ops when org has no short links', async () => {
      const adapter = stubAdapter();
      mockGetActiveProvider.mockResolvedValue({
        identifier: 'bitly',
        credentials: { apiKey: 'key' },
        customDomain: 'short.myco.com',
      });
      mockResolveShortLink.mockReturnValue(adapter);
      mockGetLinksForOrg.mockResolvedValue([]);

      await activity.collectShortLinkSnapshots(orgId);

      expect(mockGetLinksForOrg).toHaveBeenCalledWith(orgId);
      expect(adapter.linkStatistics).not.toHaveBeenCalled();
    });

    it('fetches link stats and upserts snapshots', async () => {
      const adapter = stubAdapter();
      const today = dayjs().startOf('day').toDate();

      const links = [
        { id: 'link-1', shortUrl: 'https://bit.ly/abc' },
        { id: 'link-2', shortUrl: 'https://bit.ly/def' },
      ];

      mockGetActiveProvider.mockResolvedValue({
        identifier: 'bitly',
        credentials: { apiKey: 'secret' },
        customDomain: 'short.myco.com',
      });
      mockResolveShortLink.mockReturnValue(adapter);
      mockGetLinksForOrg.mockResolvedValue(links);
      adapter.linkStatistics.mockResolvedValue([
        { short: 'https://bit.ly/abc', original: 'https://example.com/a', clicks: '150' },
        { short: 'https://bit.ly/def', original: 'https://example.com/b', clicks: '75' },
      ]);
      mockUpsertSnapshotsBatch.mockResolvedValue(undefined);

      await activity.collectShortLinkSnapshots(orgId);

      expect(adapter.linkStatistics).toHaveBeenCalledWith(
        {
          orgId,
          credentials: { apiKey: 'secret' },
          customDomain: 'short.myco.com',
        },
        ['https://bit.ly/abc', 'https://bit.ly/def'],
      );
      // N6: a single batched write carrying both rows
      expect(mockUpsertSnapshotsBatch).toHaveBeenCalledTimes(1);
      expect(mockUpsertSnapshotsBatch).toHaveBeenCalledWith([
        { shortLinkId: 'link-1', organizationId: orgId, date: today, clicks: 150 },
        { shortLinkId: 'link-2', organizationId: orgId, date: today, clicks: 75 },
      ]);
    });

    it('batches links in groups of 20', async () => {
      const adapter = stubAdapter();
      const links = Array.from({ length: 25 }, (_, i) => ({
        id: `link-${i}`,
        shortUrl: `https://bit.ly/${i}`,
      }));

      mockGetActiveProvider.mockResolvedValue({
        identifier: 'bitly',
        credentials: {},
      });
      mockResolveShortLink.mockReturnValue(adapter);
      mockGetLinksForOrg.mockResolvedValue(links);

      const stats = links.map((l) => ({
        short: l.shortUrl,
        original: 'https://example.com',
        clicks: '10',
      }));
      adapter.linkStatistics
        .mockResolvedValueOnce(stats.slice(0, 20))
        .mockResolvedValueOnce(stats.slice(20));
      mockUpsertSnapshotsBatch.mockResolvedValue(undefined);

      await activity.collectShortLinkSnapshots(orgId);

      expect(adapter.linkStatistics).toHaveBeenCalledTimes(2);
      // N6: one batched write per batch (25 links → 20 + 5 → 2 batches)
      expect(mockUpsertSnapshotsBatch).toHaveBeenCalledTimes(2);
      expect(mockUpsertSnapshotsBatch.mock.calls[0][0]).toHaveLength(20);
      expect(mockUpsertSnapshotsBatch.mock.calls[1][0]).toHaveLength(5);
    });

    it('skips stats entries whose shortUrl does not match any batch link', async () => {
      const adapter = stubAdapter();
      const links = [{ id: 'link-1', shortUrl: 'https://bit.ly/abc' }];

      mockGetActiveProvider.mockResolvedValue({
        identifier: 'bitly',
        credentials: {},
      });
      mockResolveShortLink.mockReturnValue(adapter);
      mockGetLinksForOrg.mockResolvedValue(links);
      adapter.linkStatistics.mockResolvedValue([
        { short: 'https://bit.ly/unknown', original: '', clicks: '99' },
      ]);
      mockUpsertSnapshotsBatch.mockResolvedValue(undefined);

      await activity.collectShortLinkSnapshots(orgId);

      // unmatched stat → no rows collected → batch called with an empty array
      expect(mockUpsertSnapshotsBatch).toHaveBeenCalledWith([]);
    });

    it('parses clicks as integer and defaults to 0 for NaN', async () => {
      const adapter = stubAdapter();
      const links = [{ id: 'link-1', shortUrl: 'https://bit.ly/abc' }];
      const today = dayjs().startOf('day').toDate();

      mockGetActiveProvider.mockResolvedValue({
        identifier: 'bitly',
        credentials: {},
      });
      mockResolveShortLink.mockReturnValue(adapter);
      mockGetLinksForOrg.mockResolvedValue(links);
      adapter.linkStatistics.mockResolvedValue([
        { short: 'https://bit.ly/abc', original: '', clicks: 'not-a-number' },
      ]);
      mockUpsertSnapshotsBatch.mockResolvedValue(undefined);

      await activity.collectShortLinkSnapshots(orgId);

      expect(mockUpsertSnapshotsBatch).toHaveBeenCalledWith([
        { shortLinkId: 'link-1', organizationId: orgId, date: today, clicks: 0 },
      ]);
    });

    it('never crashes when linkStatistics throws', async () => {
      const adapter = stubAdapter();
      mockGetActiveProvider.mockResolvedValue({
        identifier: 'bitly',
        credentials: { apiKey: 'bad-key' },
      });
      mockResolveShortLink.mockReturnValue(adapter);
      mockGetLinksForOrg.mockResolvedValue([
        { id: 'link-1', shortUrl: 'https://bit.ly/abc' },
      ]);
      adapter.linkStatistics.mockRejectedValue(new Error('API rate limit'));

      await expect(
        activity.collectShortLinkSnapshots(orgId),
      ).resolves.toBeUndefined();

      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.stringContaining('short-link snapshot batch failed'),
      );
    });

    it('propagates errors from getLinksForOrg (outside the inner try/catch)', async () => {
      mockGetActiveProvider.mockResolvedValue({
        identifier: 'bitly',
        credentials: {},
      });
      mockResolveShortLink.mockReturnValue(stubAdapter());
      mockGetLinksForOrg.mockRejectedValue(new Error('DB connection lost'));

      await expect(
        activity.collectShortLinkSnapshots(orgId),
      ).rejects.toThrow('DB connection lost');
    });

    it('handles a batch failure and continues to next batch', async () => {
      const adapter = stubAdapter();
      // batchSize is 20, so 21 links = 2 batches (20 + 1)
      const links = Array.from({ length: 21 }, (_, i) => ({
        id: `link-${i}`,
        shortUrl: `https://bit.ly/${i}`,
      }));

      mockGetActiveProvider.mockResolvedValue({
        identifier: 'bitly',
        credentials: {},
      });
      mockResolveShortLink.mockReturnValue(adapter);
      mockGetLinksForOrg.mockResolvedValue(links);
      adapter.linkStatistics
        .mockRejectedValueOnce(new Error('first batch failed'))
        .mockResolvedValueOnce(
          [{ short: 'https://bit.ly/20', original: '', clicks: '5' }],
        );
      mockUpsertSnapshotsBatch.mockResolvedValue(undefined);

      await activity.collectShortLinkSnapshots(orgId);

      expect(adapter.linkStatistics).toHaveBeenCalledTimes(2);
      // first batch threw before any write; only the second batch's write runs
      expect(mockUpsertSnapshotsBatch).toHaveBeenCalledTimes(1);
      expect(mockUpsertSnapshotsBatch).toHaveBeenCalledWith([
        { shortLinkId: 'link-20', organizationId: orgId, date: expect.any(Date), clicks: 5 },
      ]);
      expect(Logger.prototype.warn).toHaveBeenCalledTimes(1);
    });

    it('uses empty credentials object when active provider has no credentials', async () => {
      const adapter = stubAdapter();
      mockGetActiveProvider.mockResolvedValue({
        identifier: 'bitly',
        credentials: null,
      });
      mockResolveShortLink.mockReturnValue(adapter);
      mockGetLinksForOrg.mockResolvedValue([
        { id: 'link-1', shortUrl: 'https://bit.ly/abc' },
      ]);
      adapter.linkStatistics.mockResolvedValue([
        { short: 'https://bit.ly/abc', original: '', clicks: '3' },
      ]);

      await activity.collectShortLinkSnapshots(orgId);

      expect(adapter.linkStatistics).toHaveBeenCalledWith(
        { orgId, credentials: {}, customDomain: undefined },
        ['https://bit.ly/abc'],
      );
    });
  });

  // ---------------------------------------------------------------------------
  // pruneShortLinkSnapshots
  // ---------------------------------------------------------------------------
  describe('pruneShortLinkSnapshots', () => {
    it('prunes snapshots older than the default 90-day retention', async () => {
      mockPruneSnapshots.mockResolvedValue({ count: 5 });

      await activity.pruneShortLinkSnapshots('org-1');

      expect(mockPruneSnapshots).toHaveBeenCalledWith('org-1', expect.any(Date));
      const before = mockPruneSnapshots.mock.calls[0][1];
      const expectedBefore = dayjs().subtract(90, 'day').startOf('day').toDate();
      expect(before.getTime()).toBe(expectedBefore.getTime());
    });

    it('honors ANALYTICS_POST_RETENTION_DAYS env override', async () => {
      const prev = process.env.ANALYTICS_POST_RETENTION_DAYS;
      process.env.ANALYTICS_POST_RETENTION_DAYS = '30';

      try {
        mockPruneSnapshots.mockResolvedValue({ count: 3 });

        await activity.pruneShortLinkSnapshots('org-1');

        const before = mockPruneSnapshots.mock.calls[0][1];
        const expectedBefore = dayjs().subtract(30, 'day').startOf('day').toDate();
        expect(before.getTime()).toBe(expectedBefore.getTime());
      } finally {
        process.env.ANALYTICS_POST_RETENTION_DAYS = prev;
      }
    });

    it('falls back to 90 days when env override is invalid', async () => {
      const prev = process.env.ANALYTICS_POST_RETENTION_DAYS;
      process.env.ANALYTICS_POST_RETENTION_DAYS = 'not-a-number';

      try {
        mockPruneSnapshots.mockResolvedValue({ count: 0 });

        await activity.pruneShortLinkSnapshots('org-1');

        const before = mockPruneSnapshots.mock.calls[0][1];
        const expectedBefore = dayjs().subtract(90, 'day').startOf('day').toDate();
        expect(before.getTime()).toBe(expectedBefore.getTime());
      } finally {
        process.env.ANALYTICS_POST_RETENTION_DAYS = prev;
      }
    });

    it('falls back to 90 days when env override is empty string', async () => {
      const prev = process.env.ANALYTICS_POST_RETENTION_DAYS;
      process.env.ANALYTICS_POST_RETENTION_DAYS = '';

      try {
        mockPruneSnapshots.mockResolvedValue({ count: 0 });

        await activity.pruneShortLinkSnapshots('org-1');

        const before = mockPruneSnapshots.mock.calls[0][1];
        const expectedBefore = dayjs().subtract(90, 'day').startOf('day').toDate();
        expect(before.getTime()).toBe(expectedBefore.getTime());
      } finally {
        process.env.ANALYTICS_POST_RETENTION_DAYS = prev;
      }
    });

    it('falls back to 90 days when env override is zero or negative', async () => {
      const prev = process.env.ANALYTICS_POST_RETENTION_DAYS;
      process.env.ANALYTICS_POST_RETENTION_DAYS = '-5';

      try {
        mockPruneSnapshots.mockResolvedValue({ count: 0 });

        await activity.pruneShortLinkSnapshots('org-1');

        const before = mockPruneSnapshots.mock.calls[0][1];
        const expectedBefore = dayjs().subtract(90, 'day').startOf('day').toDate();
        expect(before.getTime()).toBe(expectedBefore.getTime());
      } finally {
        process.env.ANALYTICS_POST_RETENTION_DAYS = prev;
      }
    });
  });
});
