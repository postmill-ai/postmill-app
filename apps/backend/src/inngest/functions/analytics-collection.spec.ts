import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@gitroom/nestjs-libraries/inngest/inngest.client', () => ({
  inngest: {
    send: vi.fn(),
    createFunction: vi.fn(),
  },
}));

import { inngest } from '@gitroom/nestjs-libraries/inngest/inngest.client';
import {
  createAnalyticsCollection,
  createAnalyticsSyncOrg,
  createAnalyticsSyncIntegration,
} from './analytics-collection';
import { createMockStep, captureFunctionHandler } from '../test/step.mock';
import { ChannelSnapshotIntegrationRef } from '@gitroom/nestjs-libraries/inngest/activities/analytics.activity';

const makeActivity = () => ({
  getAllOrganizationIds: vi.fn().mockResolvedValue(['org-1', 'org-2']),
  getChannelSnapshotIntegrationIds: vi.fn().mockResolvedValue([]),
  collectChannelSnapshots: vi.fn().mockResolvedValue(undefined),
  collectChannelSnapshotForIntegration: vi.fn().mockResolvedValue(undefined),
  collectPostSnapshots: vi.fn().mockResolvedValue(undefined),
  collectPostSnapshotsPage: vi.fn().mockResolvedValue({ processed: 0 }),
  pruneAndRollupSnapshots: vi.fn().mockResolvedValue(undefined),
  notifySnapshotComplete: vi.fn().mockResolvedValue(undefined),
  probeWatchedAccounts: vi.fn().mockResolvedValue(undefined),
  collectShortLinkSnapshots: vi.fn().mockResolvedValue(undefined),
  pruneShortLinkSnapshots: vi.fn().mockResolvedValue(undefined),
  pruneEmailLogs: vi.fn().mockResolvedValue(undefined),
});

const makeRunRepo = () => ({
  recordStart: vi.fn().mockResolvedValue('2020-01-01T00:00:00.000Z'),
  recordComplete: vi.fn().mockResolvedValue(undefined),
  recordFailed: vi.fn().mockResolvedValue(undefined),
  getAllLatest: vi.fn().mockResolvedValue([]),
});

describe('createAnalyticsCollection (cron, fan-out)', () => {
  let analyticsActivity: ReturnType<typeof makeActivity>;
  let runRepo: ReturnType<typeof makeRunRepo>;
  let getHandler: () => any;

  beforeEach(() => {
    vi.clearAllMocks();
    analyticsActivity = makeActivity();
    runRepo = makeRunRepo();
    getHandler = captureFunctionHandler(vi.mocked(inngest.createFunction));
    createAnalyticsCollection(analyticsActivity as any, runRepo as any);
  });

  it('registers a daily UTC cron handler with concurrency 1', () => {
    expect(inngest.createFunction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'analytics-collection', concurrency: 1 }),
      { cron: 'TZ=UTC 0 2 * * *' },
      expect.any(Function)
    );
  });

  it('reads org ids, fans out one analytics/sync-org event per org, then prunes email logs', async () => {
    const step = createMockStep();

    await getHandler()({ step });

    expect(step.run).toHaveBeenCalledWith('get-org-ids', expect.any(Function));
    expect(analyticsActivity.getAllOrganizationIds).toHaveBeenCalled();

    expect(runRepo.recordStart).toHaveBeenCalledWith('analytics-collection');
    expect(runRepo.recordComplete).toHaveBeenCalledWith(
      'analytics-collection',
      '2020-01-01T00:00:00.000Z'
    );

    // One fan-out batch: an 'analytics/sync-org' event per org.
    expect(step.sendEvent).toHaveBeenCalledWith('fan-out-analytics', [
      { name: 'analytics/sync-org', data: { organizationId: 'org-1' } },
      { name: 'analytics/sync-org', data: { organizationId: 'org-2' } },
    ]);

    // The cron itself no longer does per-org work.
    expect(analyticsActivity.collectChannelSnapshots).not.toHaveBeenCalled();
    expect(analyticsActivity.collectPostSnapshots).not.toHaveBeenCalled();
    expect(analyticsActivity.pruneAndRollupSnapshots).not.toHaveBeenCalled();

    // The trailing cron-level prune step stays.
    expect(step.run).toHaveBeenCalledWith(
      'prune-email-logs',
      expect.any(Function)
    );
  });

  it('does not fan out when there are no orgs', async () => {
    analyticsActivity.getAllOrganizationIds.mockResolvedValue([]);
    const step = createMockStep();

    await getHandler()({ step });

    expect(step.sendEvent).not.toHaveBeenCalled();
    expect(step.run).toHaveBeenCalledWith(
      'prune-email-logs',
      expect.any(Function)
    );
  });
});

describe('createAnalyticsSyncOrg (per-org event handler)', () => {
  let analyticsActivity: ReturnType<typeof makeActivity>;
  let getHandler: () => any;

  beforeEach(() => {
    vi.clearAllMocks();
    analyticsActivity = makeActivity();
    getHandler = captureFunctionHandler(vi.mocked(inngest.createFunction));
    createAnalyticsSyncOrg(analyticsActivity as any);
  });

  it('registers an event handler with a concurrency cap', () => {
    expect(inngest.createFunction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'analytics-sync-org', concurrency: 5 }),
      { event: 'analytics/sync-org' },
      expect.any(Function)
    );
  });

  it('lists integrations, fans out per-integration events, then runs the remaining per-org steps', async () => {
    const integration: ChannelSnapshotIntegrationRef = {
      id: 'int-1',
      type: 'social',
      disabled: false,
      deletedAt: null,
      providerIdentifier: 'facebook',
      providerVersion: 'v1',
      internalId: 'fb-1',
      token: 'tok',
      tokenExpiration: null,
      refreshToken: 'refresh',
      name: 'FB Page',
      picture: null,
      rootInternalId: 'fb-1',
      organizationId: 'org-9',
      providerConfigId: null,
    };
    analyticsActivity.getChannelSnapshotIntegrationIds.mockResolvedValue([integration]);
    const step = createMockStep();

    await getHandler()({
      step,
      event: { data: { organizationId: 'org-9' } },
    });

    expect(step.run).toHaveBeenCalledWith(
      'list-channel-snapshot-integrations',
      expect.any(Function)
    );
    expect(step.sendEvent).toHaveBeenCalledWith(
      'fan-out-channel-snapshots',
      expect.arrayContaining([
        expect.objectContaining({
          name: 'analytics/sync-integration',
          data: expect.objectContaining({
            organizationId: 'org-9',
            id: 'int-1',
          }),
          id: expect.stringContaining('analytics:channel:org-9:int-1:'),
        }),
      ])
    );
    expect(step.run).toHaveBeenCalledWith('collect-post-page-start', expect.any(Function));
    expect(step.run).toHaveBeenCalledWith('prune', expect.any(Function));
    expect(step.run).toHaveBeenCalledWith('side-effects', expect.any(Function));
    expect(step.run).toHaveBeenCalledWith('probe-watched', expect.any(Function));
    expect(step.run).toHaveBeenCalledWith('shortlink-snap', expect.any(Function));
    expect(step.run).toHaveBeenCalledWith('shortlink-prune', expect.any(Function));

    expect(analyticsActivity.collectChannelSnapshots).not.toHaveBeenCalled();
    expect(analyticsActivity.collectPostSnapshotsPage).toHaveBeenCalledWith('org-9', 30, undefined);
    expect(analyticsActivity.pruneAndRollupSnapshots).toHaveBeenCalledWith('org-9');
    expect(analyticsActivity.notifySnapshotComplete).toHaveBeenCalledWith('org-9');
    expect(analyticsActivity.probeWatchedAccounts).toHaveBeenCalledWith('org-9');
    expect(analyticsActivity.collectShortLinkSnapshots).toHaveBeenCalledWith('org-9');
    expect(analyticsActivity.pruneShortLinkSnapshots).toHaveBeenCalledWith('org-9');
  });

  it('checkpoints post-snapshot pagination across durable steps when there are more pages', async () => {
    analyticsActivity.collectPostSnapshotsPage
      .mockResolvedValueOnce({ processed: 500, nextCursor: 'cursor-1' })
      .mockResolvedValueOnce({ processed: 100 });

    const step = createMockStep();

    await getHandler()({
      step,
      event: { data: { organizationId: 'org-9' } },
    });

    expect(step.run).toHaveBeenCalledWith('collect-post-page-start', expect.any(Function));
    expect(step.run).toHaveBeenCalledWith('collect-post-page-cursor-1', expect.any(Function));
    expect(analyticsActivity.collectPostSnapshotsPage).toHaveBeenCalledTimes(2);
    expect(analyticsActivity.collectPostSnapshotsPage).toHaveBeenNthCalledWith(1, 'org-9', 30, undefined);
    expect(analyticsActivity.collectPostSnapshotsPage).toHaveBeenNthCalledWith(2, 'org-9', 30, 'cursor-1');
  });
});

describe('createAnalyticsSyncIntegration (per-integration event handler)', () => {
  let analyticsActivity: ReturnType<typeof makeActivity>;
  let getHandler: () => any;

  beforeEach(() => {
    vi.clearAllMocks();
    analyticsActivity = makeActivity();
    getHandler = captureFunctionHandler(vi.mocked(inngest.createFunction));
    createAnalyticsSyncIntegration(analyticsActivity as any);
  });

  it('registers an event handler with a concurrency cap', () => {
    expect(inngest.createFunction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'analytics-sync-integration', concurrency: 10 }),
      { event: 'analytics/sync-integration' },
      expect.any(Function)
    );
  });

  it('collects the channel snapshot for the requested integration', async () => {
    const step = createMockStep();
    const event = {
      data: {
        id: 'int-1',
        type: 'social',
        disabled: false,
        deletedAt: null,
        providerIdentifier: 'facebook',
        providerVersion: null,
        internalId: 'fb-1',
        token: 'tok',
        tokenExpiration: null,
        refreshToken: 'refresh',
        name: 'FB Page',
        picture: null,
        rootInternalId: 'fb-1',
        organizationId: 'org-9',
        providerConfigId: null,
      } as ChannelSnapshotIntegrationRef,
    };

    await getHandler()({ step, event });

    expect(step.run).toHaveBeenCalledWith(
      'collect-channel-int-1',
      expect.any(Function)
    );
    expect(analyticsActivity.collectChannelSnapshotForIntegration).toHaveBeenCalledWith(
      'org-9',
      expect.objectContaining({ id: 'int-1', providerIdentifier: 'facebook', internalId: 'fb-1', token: 'tok' }),
      7
    );
  });
});
