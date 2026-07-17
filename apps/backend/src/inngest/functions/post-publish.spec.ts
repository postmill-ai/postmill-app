import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@gitroom/nestjs-libraries/inngest/inngest.client', () => ({
  inngest: {
    createFunction: vi.fn((opts: any, trigger: any, handler: any) => ({
      opts,
      trigger,
      handler,
    })),
  },
}));

// post-publish derives its per-provider task queues at import time from the
// generated provider modules (the kernel's single source of truth). Mock a
// small social subset (plus one non-social module that must be ignored).
vi.mock('@gitroom/backend/providers.generated', () => ({
  providerModules: [
    { manifest: { domain: 'social', providerId: 'x', version: 'v1' }, create: () => ({ identifier: 'x', maxConcurrentJob: 1 }) },
    { manifest: { domain: 'social', providerId: 'instagram', version: 'v1' }, create: () => ({ identifier: 'instagram', maxConcurrentJob: 400 }) },
    { manifest: { domain: 'social', providerId: 'instagram-standalone', version: 'v1' }, create: () => ({ identifier: 'instagram-standalone', maxConcurrentJob: 200 }) },
    { manifest: { domain: 'social', providerId: 'mastodon', version: 'v1' }, create: () => ({ identifier: 'mastodon', maxConcurrentJob: 5 }) },
    { manifest: { domain: 'ai', providerId: 'openai', version: 'v1' } },
  ],
}));

import { createPostPublishFunctions } from './post-publish';
import { inngest } from '@gitroom/nestjs-libraries/inngest/inngest.client';
import { providerModules } from '@gitroom/backend/providers.generated';

describe('createPostPublishFunctions', () => {
  const postActivity = {} as any;

  beforeEach(() => {
    vi.mocked(inngest.createFunction).mockClear();
  });

  it('generates one function per unique task queue', () => {
    createPostPublishFunctions(postActivity);

    const expectedQueues = new Set(
      providerModules
        .filter((m: any) => m.manifest.domain === 'social' && m.create)
        .map((m: any) => m.create().identifier.split('-')[0].toLowerCase())
    );

    expect(inngest.createFunction).toHaveBeenCalledTimes(expectedQueues.size);
  });

  it('names each function post-publish-{taskQueue} and sets the provider concurrency limit', () => {
    createPostPublishFunctions(postActivity);

    const xCall = vi.mocked(inngest.createFunction).mock.calls.find(
      (call) => call[0].id === 'post-publish-x'
    );

    expect(xCall).toBeDefined();
    // 2.6 — concurrency is keyed per tenant so one org can't starve the rest.
    expect(xCall![0].concurrency).toEqual({
      limit: 1,
      key: 'event.data.organizationId',
    });
  });

  it('uses the most conservative limit when provider variants share a task queue', () => {
    createPostPublishFunctions(postActivity);

    const instagramCall = vi.mocked(inngest.createFunction).mock.calls.find(
      (call) => call[0].id === 'post-publish-instagram'
    );

    // instagram = 400, instagram-standalone = 200 → queue limit is 200
    expect(instagramCall).toBeDefined();
    expect(instagramCall![0].concurrency).toEqual({
      limit: 200,
      key: 'event.data.organizationId',
    });
  });

  it('routes each function by event.data.taskQueue', () => {
    createPostPublishFunctions(postActivity);

    const mastodonCall = vi.mocked(inngest.createFunction).mock.calls.find(
      (call) => call[0].id === 'post-publish-mastodon'
    );

    expect(mastodonCall![1]).toEqual({
      event: 'post/publish',
      if: 'event.data.taskQueue == "mastodon"',
    });
  });

  it('declares cancelOn keyed by postId on every generated function', () => {
    createPostPublishFunctions(postActivity);

    const anyCall = vi.mocked(inngest.createFunction).mock.calls[0];

    expect(anyCall[0].cancelOn).toEqual([
      {
        event: 'post/cancel',
        if: 'async.data.postId == event.data.postId',
      },
    ]);
  });
});

// --- Handler behaviour (runPostPublish) ---------------------------------------

const makeStep = () => ({
  run: vi.fn(async (_id: string, fn: () => any) => fn()),
  sleep: vi.fn(async () => {}),
  sendEvent: vi.fn(async () => {}),
});

const rootPost = (over: any = {}) => ({
  id: 'post-1',
  organizationId: 'org-1',
  state: 'QUEUE',
  publishDate: new Date(Date.now() - 1000).toISOString(),
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
  settings: JSON.stringify({}),
  intervalInDays: null,
  integration: {
    id: 'int-1',
    organizationId: 'org-1',
    providerIdentifier: 'x',
    name: 'X',
    token: 't',
  },
  ...over,
});

const makeActivity = (over: any = {}) => {
  const post = rootPost();
  return {
    getPost: vi.fn(async () => post),
    getPostsList: vi.fn(async () => [post]),
    isCommentable: vi.fn(async () => false),
    claimForPublish: vi.fn(async () => 1),
    postSocial: vi.fn(async () => [
      { postId: 'PLATFORM123', releaseURL: 'http://x/1' },
    ]),
    postComment: vi.fn(async () => [
      { postId: 'PLATFORMC', releaseURL: 'http://x/c' },
    ]),
    updatePost: vi.fn(async () => {}),
    notifyPostPublished: vi.fn(async () => {}),
    notifyPostFailed: vi.fn(async () => {}),
    notifyChannelError: vi.fn(async () => {}),
    changeState: vi.fn(async () => {}),
    refreshTokenWithCause: vi.fn(async () => ({ accessToken: 'new' })),
    supportsFirstComment: vi.fn(async () => true),
    postFirstComment: vi.fn(async () => [
      { postId: 'FC', releaseURL: 'http://x/fc' },
    ]),
    notifyFirstCommentUnsupported: vi.fn(async () => {}),
    notifyFirstCommentFailed: vi.fn(async () => {}),
    updatePostSettings: vi.fn(async () => {}),
    sendWebhooks: vi.fn(async () => {}),
    internalPlugs: vi.fn(async () => []),
    globalPlugs: vi.fn(async () => []),
    ...over,
  } as any;
};

const getHandler = (postActivity: any) => {
  vi.mocked(inngest.createFunction).mockClear();
  createPostPublishFunctions(postActivity);
  // createFunction(opts, trigger, handler) — index 2 is the handler.
  return vi.mocked(inngest.createFunction).mock.calls[0][2] as (a: any) => any;
};

const runEvent = (over: any = {}) => ({
  data: {
    postId: 'post-1',
    organizationId: 'org-1',
    taskQueue: 'x',
    maxConcurrentJob: 1,
    postNow: false,
    ...over,
  },
});

describe('runPostPublish handler', () => {
  it('0.7 — aborts without posting when claimForPublish loses the race (0)', async () => {
    const activity = makeActivity({ claimForPublish: vi.fn(async () => 0) });
    const handler = getHandler(activity);

    await handler({ step: makeStep(), event: runEvent() });

    expect(activity.claimForPublish).toHaveBeenCalledTimes(1);
    expect(activity.postSocial).not.toHaveBeenCalled();
    expect(activity.getPostsList).not.toHaveBeenCalled();
  });

  it('0.7 — proceeds to post when claimForPublish wins the race (1)', async () => {
    const activity = makeActivity({ claimForPublish: vi.fn(async () => 1) });
    const handler = getHandler(activity);

    await handler({ step: makeStep(), event: runEvent() });

    expect(activity.postSocial).toHaveBeenCalledTimes(1);
  });

  it('0.7 — repeat events skip the claim entirely', async () => {
    const activity = makeActivity();
    const handler = getHandler(activity);

    await handler({
      step: makeStep(),
      event: runEvent({ postNow: true, repeat: true }),
    });

    expect(activity.claimForPublish).not.toHaveBeenCalled();
    expect(activity.postSocial).toHaveBeenCalledTimes(1);
  });

  it('0.10 — a step-propagated RefreshTokenError (name only) reaches refresh-token', async () => {
    const refreshErr = Object.assign(new Error('x'), {
      name: 'RefreshTokenError',
    });
    const activity = makeActivity({
      postSocial: vi
        .fn()
        .mockRejectedValueOnce(refreshErr)
        .mockResolvedValue([{ postId: 'PLATFORM123', releaseURL: 'http://x/1' }]),
    });
    const handler = getHandler(activity);

    await handler({ step: makeStep(), event: runEvent() });

    expect(activity.refreshTokenWithCause).toHaveBeenCalledTimes(1);
    expect(activity.postSocial).toHaveBeenCalledTimes(2);
  });

  it('2.5 — the refresh-token step output carries no token values', async () => {
    const refreshErr = Object.assign(new Error('x'), {
      name: 'RefreshTokenError',
    });
    const activity = makeActivity({
      postSocial: vi
        .fn()
        .mockRejectedValueOnce(refreshErr)
        .mockResolvedValue([
          { postId: 'PLATFORM123', releaseURL: 'http://x/1' },
        ]),
      refreshTokenWithCause: vi.fn(async () => ({
        accessToken: 'SECRET-ACCESS',
        refreshToken: 'SECRET-REFRESH',
        expiresIn: 3600,
      })),
    });

    // capture each step's serialized output by id
    const outputs: Record<string, any> = {};
    const step = {
      run: vi.fn(async (id: string, fn: () => any) => {
        const out = await fn();
        outputs[id] = out;
        return out;
      }),
      sleep: vi.fn(async () => {}),
      sendEvent: vi.fn(async () => {}),
    };
    const handler = getHandler(activity);

    await handler({ step, event: runEvent() });

    const refreshOut = outputs['refresh-token'];
    expect(refreshOut).toBeDefined();
    // non-secret signal only — no token values in step state
    expect(refreshOut.accessToken).toBeUndefined();
    expect(refreshOut.refreshToken).toBeUndefined();
    expect(JSON.stringify(refreshOut)).not.toContain('SECRET');
    expect(refreshOut.refreshed).toBe(true);
    expect(refreshOut.expiresIn).toBe(3600);
    // the retry still publishes (re-reading the DB-persisted rotated token)
    expect(activity.postSocial).toHaveBeenCalledTimes(2);
  });

  it('2.3 — a mid-thread failure keeps the root PUBLISHED, notifies, and still sends webhooks', async () => {
    const root = rootPost();
    const child = {
      id: 'post-2',
      organizationId: 'org-1',
      delay: 0,
      integration: root.integration,
    };
    const activity = makeActivity({
      getPostsList: vi.fn(async () => [root, child]),
      isCommentable: vi.fn(async () => true),
      postComment: vi.fn(async () => {
        throw new Error('boom'); // generic (non-refresh) failure on the 2nd item
      }),
    });
    const handler = getHandler(activity);

    await handler({ step: makeStep(), event: runEvent() });

    // only the failed child is flipped ERROR; the root is never marked ERROR
    const errorCalls = activity.changeState.mock.calls.filter(
      (c: any[]) => c[1] === 'ERROR'
    );
    expect(errorCalls.map((c: any[]) => c[0])).toEqual(['post-2']);
    expect(
      activity.changeState.mock.calls.some(
        (c: any[]) => c[0] === 'post-1' && c[1] === 'ERROR'
      )
    ).toBe(false);
    // always notify on failure, tagged as a comment failure
    expect(activity.notifyPostFailed).toHaveBeenCalledTimes(1);
    expect(activity.notifyPostFailed.mock.calls[0][3]).toBe('comment');
    // webhooks for the live root still run
    expect(activity.sendWebhooks).toHaveBeenCalledTimes(1);
  });

  it('2.4 — send-webhooks receives the internal post id, not the platform release id', async () => {
    const activity = makeActivity();
    const handler = getHandler(activity);

    await handler({ step: makeStep(), event: runEvent() });

    expect(activity.sendWebhooks).toHaveBeenCalledWith(
      'post-1',
      'org-1',
      'int-1'
    );
  });

  it('4.4c — a duplicate event on a PUBLISHED post returns without marking ERROR', async () => {
    const activity = makeActivity({
      getPost: vi.fn(async () => rootPost({ state: 'PUBLISHED' })),
    });
    const handler = getHandler(activity);

    await handler({ step: makeStep(), event: runEvent() });

    expect(activity.claimForPublish).not.toHaveBeenCalled();
    expect(
      activity.changeState.mock.calls.some((c: any[]) => c[1] === 'ERROR')
    ).toBe(false);
  });

  it('4.4d — records the first-comment marker by merging against FRESH settings', async () => {
    const snapshot = rootPost({ settings: JSON.stringify({ firstComment: 'hi' }) });
    const fresh = rootPost({
      settings: JSON.stringify({ firstComment: 'hi', laterEdit: 'yes' }),
    });
    const activity = makeActivity({
      getPost: vi.fn(async () => fresh), // firstPost + record-step re-read
      getPostsList: vi.fn(async () => [snapshot]), // pre-publish snapshot
    });
    const handler = getHandler(activity);

    await handler({ step: makeStep(), event: runEvent() });

    expect(activity.updatePostSettings).toHaveBeenCalledTimes(1);
    const [id, json] = activity.updatePostSettings.mock.calls[0];
    expect(id).toBe('post-1');
    const merged = JSON.parse(json);
    expect(merged.laterEdit).toBe('yes'); // merged against fresh, not snapshot
    expect(merged.firstCommentId).toBe('FC');
    expect(merged.firstCommentPostedAt).toBeDefined();
  });

  it('4.4d — a failed marker write is surfaced (not swallowed) but the post stays published', async () => {
    const withComment = rootPost({
      settings: JSON.stringify({ firstComment: 'hi' }),
    });
    const activity = makeActivity({
      getPost: vi.fn(async () => withComment),
      getPostsList: vi.fn(async () => [withComment]),
      updatePostSettings: vi.fn(async () => {
        throw new Error('write failed');
      }),
    });
    const handler = getHandler(activity);

    await expect(
      handler({ step: makeStep(), event: runEvent() })
    ).rejects.toThrow('write failed');
    // the post itself published before the marker write
    expect(activity.postSocial).toHaveBeenCalledTimes(1);
    expect(activity.notifyPostPublished).toHaveBeenCalledTimes(1);
  });

  it('4.4f — repeat-post uses a deterministic id and carries repeat:true', async () => {
    const post = rootPost({ intervalInDays: 1 });
    const activity = makeActivity({
      getPost: vi.fn(async () => post),
      getPostsList: vi.fn(async () => [post]),
    });
    const handler = getHandler(activity);
    const step = makeStep();

    await handler({ step, event: runEvent() });

    expect(step.sendEvent).toHaveBeenCalledTimes(1);
    const [, payload] = step.sendEvent.mock.calls[0] as unknown as [
      unknown,
      any
    ];
    expect(payload.id).toMatch(/^post_post-1_repeat_0_\d+$/);
    expect(payload.id).toBe(`post_post-1_repeat_0_${post.createdAt.getTime()}`);
    expect(payload.data.repeat).toBe(true);
    expect(payload.data.postNow).toBe(true);
  });

  it('4.4f — repeat-post id is stable across re-executions', async () => {
    const post = rootPost({ intervalInDays: 1 });
    const activity = makeActivity({
      getPost: vi.fn(async () => post),
      getPostsList: vi.fn(async () => [post]),
    });
    const handler = getHandler(activity);
    const event = runEvent();

    const run = async () => {
      const step = makeStep();
      await handler({ step, event });
      const [, payload] = step.sendEvent.mock.calls[0] as unknown as [
        unknown,
        any
      ];
      return payload.id;
    };

    const firstId = await run();
    const secondId = await run();
    expect(firstId).toBe(secondId);
  });
});
