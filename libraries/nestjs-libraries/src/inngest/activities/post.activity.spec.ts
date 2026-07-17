import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

const sendMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@gitroom/nestjs-libraries/inngest/inngest.client', () => ({
  inngest: { send: (...args: any[]) => sendMock(...args) },
  isInngestEnabled: () => true,
}));

import { PostActivity } from '@gitroom/nestjs-libraries/inngest/activities/post.activity';
import { XDto } from '@gitroom/provider-kernel/domains/social-dtos';

// Minimal constructor stub — the methods under test only touch a handful of deps.
const build = (over: Partial<Record<string, any>> = {}) => {
  const deps: any = {
    _postService: {},
    _notificationService: {},
    _integrationManager: {},
    _integrationService: {},
    _refreshIntegrationService: {},
    _webhookService: {},
    _subscriptionService: {},
    _orgProviderConfigService: {},
    _orgVpnConfigService: {},
    _vpnDispatcherService: {},
    _campaignsRepository: {},
    _postsRepository: {},
    ...over,
  };
  const activity = new PostActivity(
    deps._postService,
    deps._notificationService,
    deps._integrationManager,
    deps._integrationService,
    deps._refreshIntegrationService,
    deps._webhookService,
    deps._subscriptionService,
    deps._orgProviderConfigService,
    deps._orgVpnConfigService,
    deps._vpnDispatcherService,
    deps._campaignsRepository,
    deps._postsRepository
  );
  return { activity, deps };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  delete process.env.STRIPE_SECRET_KEY;
});

describe('PostActivity.claimForPublish (0.7)', () => {
  it('delegates to the repository and returns the count', async () => {
    const claimForPublish = vi.fn().mockResolvedValue(1);
    const { activity } = build({ _postsRepository: { claimForPublish } });

    const result = await activity.claimForPublish('post-1', 'org-1');

    expect(claimForPublish).toHaveBeenCalledWith('post-1', 'org-1');
    expect(result).toBe(1);
  });
});

describe('PostActivity.searchForMissingThreeHoursPosts recovery id (0.8)', () => {
  it('sends a unique-per-send recovery publish id (never a bare post_<id>)', async () => {
    const post = {
      id: 'p1',
      organizationId: 'org-1',
      integration: { providerIdentifier: 'x', providerVersion: null },
    };
    const { activity } = build({
      _postService: {
        resetStalePublishingToQueue: vi.fn().mockResolvedValue(0),
        searchForMissingThreeHoursPosts: vi.fn().mockResolvedValue([post, post]),
      },
      _integrationManager: {
        getSocialIntegrationUnchecked: vi.fn().mockReturnValue({ maxConcurrentJob: 1 }),
      },
    });

    await activity.searchForMissingThreeHoursPosts();

    const publishIds = sendMock.mock.calls
      .filter((c) => c[0]?.name === 'post/publish')
      .map((c) => c[0].id);
    expect(publishIds).toHaveLength(2);
    for (const id of publishIds) {
      expect(id).toMatch(/^post_p1_recovery_/);
      expect(id).not.toBe('post_p1');
    }
    // unique per send
    expect(new Set(publishIds).size).toBe(2);
    // the post/cancel still precedes each publish
    expect(sendMock.mock.calls.filter((c) => c[0]?.name === 'post/cancel')).toHaveLength(2);
  });
});

describe('PostActivity.searchForMissingThreeHoursPosts PUBLISHING recovery (0.7 follow-up)', () => {
  it('resets stale PUBLISHING posts BEFORE querying for missing QUEUE posts', async () => {
    const order: string[] = [];
    const resetStalePublishingToQueue = vi
      .fn()
      .mockImplementation(async () => {
        order.push('reset');
        return 1;
      });
    const searchForMissingThreeHoursPosts = vi
      .fn()
      .mockImplementation(async () => {
        order.push('find');
        return [];
      });
    const { activity } = build({
      _postService: {
        resetStalePublishingToQueue,
        searchForMissingThreeHoursPosts,
      },
    });

    await activity.searchForMissingThreeHoursPosts();

    // The reset must run first so a post orphaned in PUBLISHING is back to QUEUE by
    // the time the finder queries (finder matches QUEUE only), and is recovered this
    // same sweep rather than sitting stuck for another hour.
    expect(resetStalePublishingToQueue).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['reset', 'find']);
  });
});

describe('PostActivity.getPost null guard (4.4b)', () => {
  it('returns false when the post is missing instead of throwing', async () => {
    const { activity } = build({
      _postService: { getPostById: vi.fn().mockResolvedValue(null) },
    });

    await expect(activity.getPost('org-1', 'missing')).resolves.toBe(false);
  });
});

describe('slimPost via getPostsList (2.5)', () => {
  it('drops token/refreshToken/customInstanceDetails from the integration', async () => {
    const getPostsRecursively = vi.fn().mockResolvedValue([
      {
        id: 'p1',
        parentPostId: null,
        content: 'hi',
        integration: {
          id: 'int-1',
          organizationId: 'org-1',
          providerIdentifier: 'x',
          name: 'X',
          token: 'SECRET-TOKEN',
          refreshToken: 'SECRET-REFRESH',
          customInstanceDetails: 'SECRET-INSTANCE',
        },
      },
    ]);
    const { activity } = build({ _postService: { getPostsRecursively } });

    const [post] = await activity.getPostsList('org-1', 'p1');

    expect(post.integration).toBeDefined();
    expect(post.integration.token).toBeUndefined();
    expect(post.integration.refreshToken).toBeUndefined();
    expect(post.integration.customInstanceDetails).toBeUndefined();
    // non-secret fields preserved
    expect(post.integration.id).toBe('int-1');
    expect(post.integration.providerIdentifier).toBe('x');
  });
});

describe('postSocial poll mapping + capability guard (2.2)', () => {
  const baseDeps = (post: any) => ({
    _postService: {
      updateTags: vi.fn().mockResolvedValue([post]),
      updateMedia: vi.fn().mockResolvedValue([]),
    },
    _integrationService: {
      getIntegrationById: vi.fn().mockResolvedValue({
        id: 'int-1',
        organizationId: 'org-1',
        providerIdentifier: 'x',
        internalId: 'ig-1',
        token: 'TOKEN',
      }),
    },
    _orgProviderConfigService: {
      getVpnSelectionForIntegration: vi.fn().mockResolvedValue(null),
    },
  });

  it('forwards poll.options to the adapter for a poll-capable provider (x)', async () => {
    const post = {
      id: 'p1',
      content: 'Vote',
      campaignId: null,
      image: '[]',
      settings: JSON.stringify({ poll: { options: ['a', 'b', 'c'], duration: 24 } }),
    };
    const postSpy = vi.fn().mockResolvedValue([{ postId: 'x1', id: 'p1' }]);
    const { activity } = build({
      ...baseDeps(post),
      _integrationManager: {
        getSocialIntegration: vi.fn().mockResolvedValue({
          editor: 'normal',
          post: postSpy,
        }),
        requireClientInformation: vi.fn().mockResolvedValue({}),
      },
    });

    await activity.postSocial(
      { id: 'int-1', organizationId: 'org-1', providerIdentifier: 'x' } as any,
      [post as any]
    );

    const payload = postSpy.mock.calls[0][2];
    expect(payload[0].poll).toEqual({ options: ['a', 'b', 'c'], duration: 24 });
  });

  it('throws (never publishes plain) when a poll is set on a non-poll provider', async () => {
    const post = {
      id: 'p1',
      content: 'Vote',
      campaignId: null,
      image: '[]',
      settings: JSON.stringify({ poll: { options: ['a', 'b'], duration: 24 } }),
    };
    const postSpy = vi.fn().mockResolvedValue([{ postId: 'm1', id: 'p1' }]);
    const { activity } = build({
      ...baseDeps(post),
      _integrationService: {
        getIntegrationById: vi.fn().mockResolvedValue({
          id: 'int-1',
          organizationId: 'org-1',
          providerIdentifier: 'mastodon',
          internalId: 'ig-1',
          token: 'TOKEN',
        }),
      },
      _integrationManager: {
        getSocialIntegration: vi.fn().mockResolvedValue({ editor: 'normal', post: postSpy }),
        requireClientInformation: vi.fn().mockResolvedValue({}),
      },
    });

    await expect(
      activity.postSocial(
        { id: 'int-1', organizationId: 'org-1', providerIdentifier: 'mastodon' } as any,
        [post as any]
      )
    ).rejects.toThrow(/does not support polls/);
    expect(postSpy).not.toHaveBeenCalled();
  });
});

describe('XDto poll validation (2.2)', () => {
  const makeX = (poll: any) =>
    plainToInstance(XDto, { who_can_reply_post: 'everyone', poll });

  it('rejects a 1-option poll', async () => {
    const errors = await validate(makeX({ options: ['only-one'], duration: 24 }));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a disallowed duration', async () => {
    const errors = await validate(makeX({ options: ['a', 'b'], duration: 999 }));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts a valid 2-4 option poll with an allowed duration', async () => {
    const errors = await validate(makeX({ options: ['a', 'b', 'c'], duration: 168 }));
    expect(errors).toHaveLength(0);
  });
});
