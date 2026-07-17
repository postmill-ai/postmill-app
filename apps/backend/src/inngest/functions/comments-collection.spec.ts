import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@gitroom/nestjs-libraries/inngest/inngest.client', () => ({
  inngest: {
    send: vi.fn(),
    createFunction: vi.fn(),
  },
}));

import { inngest } from '@gitroom/nestjs-libraries/inngest/inngest.client';
import {
  createCommentsCollection,
  createCommentsSyncOrg,
} from './comments-collection';
import { createMockStep, captureFunctionHandler } from '../test/step.mock';

type CommentsActivityMock = {
  getAllOrganizationIds: ReturnType<typeof vi.fn>;
  getDaysBack: ReturnType<typeof vi.fn>;
  getSweepIntervalMinutes: ReturnType<typeof vi.fn>;
  syncPostComments: ReturnType<typeof vi.fn>;
  syncPostCommentsPage: ReturnType<typeof vi.fn>;
  dispatchWebhookForComments: ReturnType<typeof vi.fn>;
  pruneComments: ReturnType<typeof vi.fn>;
  notifyNewComments: ReturnType<typeof vi.fn>;
};

const makeActivity = (): CommentsActivityMock => ({
  getAllOrganizationIds: vi.fn().mockResolvedValue(['org-1']),
  getDaysBack: vi.fn().mockResolvedValue(7),
  getSweepIntervalMinutes: vi.fn().mockResolvedValue(5),
  syncPostComments: vi.fn().mockResolvedValue(undefined),
  syncPostCommentsPage: vi.fn().mockResolvedValue({ processed: 0 }),
  dispatchWebhookForComments: vi.fn().mockResolvedValue(undefined),
  pruneComments: vi.fn().mockResolvedValue(undefined),
  notifyNewComments: vi.fn().mockResolvedValue(undefined),
});

const makeRunRepo = () => ({
  recordStart: vi.fn().mockResolvedValue('2020-01-01T00:00:00.000Z'),
  recordComplete: vi.fn().mockResolvedValue(undefined),
  recordFailed: vi.fn().mockResolvedValue(undefined),
  getAllLatest: vi.fn().mockResolvedValue([]),
});

describe('createCommentsCollection (cron, fan-out)', () => {
  let commentsActivity: CommentsActivityMock;
  let runRepo: ReturnType<typeof makeRunRepo>;
  let getHandler: () => any;

  beforeEach(() => {
    vi.clearAllMocks();
    commentsActivity = makeActivity();
    runRepo = makeRunRepo();
    getHandler = captureFunctionHandler(vi.mocked(inngest.createFunction));
    createCommentsCollection(commentsActivity as any, runRepo as any);
  });

  it('registers a minutely UTC cron handler with concurrency 1', () => {
    expect(inngest.createFunction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'comments-collection', concurrency: 1 }),
      { cron: 'TZ=UTC * * * * *' },
      expect.any(Function)
    );
  });

  it('reads org ids / days-back / interval, fans out one event per org, then sleeps', async () => {
    const step = createMockStep();

    await getHandler()({ step });

    // get-org-ids stays a memoized step; days-back/interval are pure env-parse reads
    // called directly (no step.run wrapper).
    expect(step.run).toHaveBeenCalledWith('get-org-ids', expect.any(Function));
    expect(step.run).not.toHaveBeenCalledWith('get-days-back', expect.any(Function));
    expect(step.run).not.toHaveBeenCalledWith('get-interval', expect.any(Function));
    expect(commentsActivity.getDaysBack).toHaveBeenCalled();
    expect(commentsActivity.getSweepIntervalMinutes).toHaveBeenCalled();

    // Run timing is recorded around the fan-out work.
    expect(runRepo.recordStart).toHaveBeenCalledWith('comments-collection');
    expect(runRepo.recordComplete).toHaveBeenCalledWith(
      'comments-collection',
      '2020-01-01T00:00:00.000Z'
    );

    // One fan-out batch: a 'comments/sync-org' event per org, carrying daysBack.
    expect(step.sendEvent).toHaveBeenCalledWith('fan-out-org-sync', [
      { name: 'comments/sync-org', data: { organizationId: 'org-1', daysBack: 7 } },
    ]);

    // The cron itself no longer does per-org work.
    expect(commentsActivity.syncPostComments).not.toHaveBeenCalled();
    expect(commentsActivity.dispatchWebhookForComments).not.toHaveBeenCalled();

    expect(step.sleep).toHaveBeenCalledWith('wait-interval', '5m');
  });

  it('does not fan out when there are no orgs', async () => {
    commentsActivity.getAllOrganizationIds.mockResolvedValue([]);
    const step = createMockStep();

    await getHandler()({ step });

    expect(step.sendEvent).not.toHaveBeenCalled();
    expect(step.sleep).toHaveBeenCalledWith('wait-interval', '5m');
  });
});

describe('createCommentsSyncOrg (per-org event handler)', () => {
  let commentsActivity: CommentsActivityMock;
  let getHandler: () => any;

  beforeEach(() => {
    vi.clearAllMocks();
    commentsActivity = makeActivity();
    getHandler = captureFunctionHandler(vi.mocked(inngest.createFunction));
    createCommentsSyncOrg(commentsActivity as any);
  });

  it('registers an event handler with a concurrency cap', () => {
    expect(inngest.createFunction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'comments-sync-org', concurrency: 5 }),
      { event: 'comments/sync-org' },
      expect.any(Function)
    );
  });

  it('runs sync, webhook, prune and notify for the event org as separate steps', async () => {
    const step = createMockStep();

    await getHandler()({
      step,
      event: { data: { organizationId: 'org-9', daysBack: 7 } },
    });

    expect(step.run).toHaveBeenCalledWith('sync-comments-page-start', expect.any(Function));
    expect(step.run).toHaveBeenCalledWith('dispatch-webhook', expect.any(Function));
    expect(step.run).toHaveBeenCalledWith('prune-comments', expect.any(Function));
    expect(step.run).toHaveBeenCalledWith('notify-comments', expect.any(Function));

    expect(commentsActivity.syncPostCommentsPage).toHaveBeenCalledWith('org-9', 7, undefined);
    expect(commentsActivity.dispatchWebhookForComments).toHaveBeenCalledWith('org-9', 7);
    expect(commentsActivity.pruneComments).toHaveBeenCalledWith('org-9');
    expect(commentsActivity.notifyNewComments).toHaveBeenCalledWith('org-9');
  });

  it('checkpoints pagination across durable steps when there are more pages', async () => {
    commentsActivity.syncPostCommentsPage
      .mockResolvedValueOnce({ processed: 50, nextCursor: 'cursor-1' })
      .mockResolvedValueOnce({ processed: 10 });

    const step = createMockStep();

    await getHandler()({
      step,
      event: { data: { organizationId: 'org-9', daysBack: 7 } },
    });

    expect(step.run).toHaveBeenCalledWith('sync-comments-page-start', expect.any(Function));
    expect(step.run).toHaveBeenCalledWith('sync-comments-page-cursor-1', expect.any(Function));
    expect(commentsActivity.syncPostCommentsPage).toHaveBeenCalledTimes(2);
    expect(commentsActivity.syncPostCommentsPage).toHaveBeenNthCalledWith(1, 'org-9', 7, undefined);
    expect(commentsActivity.syncPostCommentsPage).toHaveBeenNthCalledWith(2, 'org-9', 7, 'cursor-1');
  });
});
