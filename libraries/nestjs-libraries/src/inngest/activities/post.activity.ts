import { Injectable, Logger } from '@nestjs/common';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { Integration, Post, State } from '@prisma/client';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { AuthTokenDetails } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { timer } from '@gitroom/helpers/utils/timer';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { WebhooksService } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service';
import { safeFetch } from '@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch';
import { PROVIDER_CAPABILITIES } from '@gitroom/nestjs-libraries/integrations/social/provider-capabilities';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import {
  inngest,
  isInngestEnabled,
} from '@gitroom/nestjs-libraries/inngest/inngest.client';
import { BadBodyError } from '@gitroom/nestjs-libraries/inngest/errors/bad-body.error';
import { OrgProviderConfigService } from '@gitroom/nestjs-libraries/database/prisma/provider-configs/org-provider-config.service';
import { OrgVpnConfigService } from '@gitroom/nestjs-libraries/vpn/org-vpn-config.service';
import { VpnDispatcherService } from '@gitroom/nestjs-libraries/vpn/vpn-dispatcher.service';
import { runWithVpnDispatcher } from '@gitroom/nestjs-libraries/vpn/vpn.context';
import { CampaignsRepository } from '@gitroom/nestjs-libraries/database/prisma/campaigns/campaigns.repository';
import { PostsRepository } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.repository';
import { v4 as uuidv4 } from 'uuid';
import { CircuitBreakerService } from '@gitroom/nestjs-libraries/ai/governance/circuit-breaker.service';
import { webhookSignature, webhookTimeoutMs } from '@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch';
import type { Dispatcher } from 'undici';

// Drops fields the workflow and downstream activities never read — biggest wins are `error` (grows per retry) and `childrenPost` (Prisma side-loads it on every recursive row).
// 2.5: also strips the decrypted OAuth secrets (`token`/`refreshToken`/
// `customInstanceDetails`) from the side-loaded `integration` so plaintext
// secrets never land in Inngest run state. The publish/refresh steps re-read the
// decrypted integration by id from the DB (see `_withDecryptedIntegration`).
function slimPost(post: any) {
  if (!post) return post;
  const {
    error,
    childrenPost,
    tags,
    description,
    title,
    parentPostId,
    deletedAt,
    createdAt,
    updatedAt,
    comments,
    errors,
    integration,
    ...rest
  } = post;
  if (!integration) return rest;
  const {
    token,
    refreshToken,
    customInstanceDetails,
    ...safeIntegration
  } = integration;
  return { ...rest, integration: safeIntegration };
}

@Injectable()
export class PostActivity {
  private readonly logger = new Logger(PostActivity.name);

  // D2: per-(provider, org) circuit breaker around the social post() path. The
  // breaker is process-local and conservative — `SocialAbstract.fetch` already
  // retries transient 429/5xx internally, so a thrown post() error is post-retry
  // ("hard"). Opens only after several consecutive hard failures, then fast-fails
  // during cooldown and half-opens with a single probe.
  private readonly _socialBreaker = new CircuitBreakerService({
    failureThreshold: 5,
    cooldownMs: 60_000,
  });

  constructor(
    private _postService: PostsService,
    private _notificationService: NotificationService,
    private _integrationManager: IntegrationManager,
    private _integrationService: IntegrationService,
    private _refreshIntegrationService: RefreshIntegrationService,
    private _webhookService: WebhooksService,
    private _subscriptionService: SubscriptionService,
    private _orgProviderConfigService: OrgProviderConfigService,
    private _orgVpnConfigService: OrgVpnConfigService,
    private _vpnDispatcherService: VpnDispatcherService,
    // layering: sanctioned leaf-read — UTM append only needs the campaign's
    // utmEnabled flag; CampaignsService depends on PostsService, so routing up
    // through the service layer would create a NestJS dependency-injection cycle.
    private _campaignsRepository: CampaignsRepository,
    // layering: sanctioned leaf-read — atomic publish claim delegates straight
    // to the repo (mirrors the injected _campaignsRepository above).
    private _postsRepository: PostsRepository
  ) {}

  // 0.7: atomic publish-state claim. Delegates to the repository's
  // `updateMany({ state: 'QUEUE' → 'PUBLISHING' })` which returns the row count
  // (1 = this run won the claim, 0 = a concurrent/stale run already claimed it).
  async claimForPublish(id: string, orgId: string) {
    return this._postsRepository.claimForPublish(id, orgId);
  }

  // Resolve the per-channel VPN proxy dispatcher (or undefined) for a publish.
  // Non-fatal: any resolution failure falls back to direct egress so a VPN
  // misconfig never blocks a post.
  private async _resolveVpnDispatcher(
    integration: Integration
  ): Promise<Dispatcher | undefined> {
    try {
      const selection = await this._orgProviderConfigService.getVpnSelectionForIntegration(
        integration.organizationId,
        integration.providerConfigId,
        integration.providerIdentifier
      );
      if (!selection) return undefined;

      const resolved = await this._orgVpnConfigService.resolveProxyForChannel(
        integration.organizationId,
        selection.identifier,
        selection.regionId,
        selection.vpnVersion
      );
      if (!resolved) return undefined;

      return this._vpnDispatcherService.get(
        integration.organizationId,
        selection.identifier,
        resolved
      );
    } catch (err) {
      this.logger.warn(
        `VPN dispatcher resolution failed for integration ${integration.id}: ${(err as Error)?.message}`
      );
      return undefined;
    }
  }

  async getIntegrationById(orgId: string, id: string) {
    return this._integrationService.getIntegrationById(orgId, id);
  }

  // 2.5: the integration carried in step state has been slimmed of its decrypted
  // token/refreshToken (see slimPost). Any step that actually posts or refreshes
  // re-reads the decrypted integration by id from the DB — which
  // refreshTokenWithCause has already persisted after a rotation, so a refresh
  // followed by a re-post picks up the fresh token.
  private async _withDecryptedIntegration(
    integration: Integration
  ): Promise<Integration> {
    if ((integration as any)?.token) {
      return integration;
    }
    const full = await this._integrationService.getIntegrationById(
      integration.organizationId,
      integration.id
    );
    return ((full as unknown) as Integration) ?? integration;
  }

  async searchForMissingThreeHoursPosts() {
    // 0.7 follow-up: first reclaim any post orphaned in PUBLISHING (a terminal run
    // loss after the atomic claim) back to QUEUE, so the finder below re-enqueues it
    // this same sweep. Idempotent — safe on Inngest step retry.
    await this._postService.resetStalePublishingToQueue();
    const list = await this._postService.searchForMissingThreeHoursPosts();
    for (const post of list) {
      // 5.4: thread the row's pinned version so recovery resolves the EXACT
      // adapter (the providerVersion selected in searchForMissingThreeHoursPosts
      // was otherwise dead). Safe post-1.3: a retired version resolves to
      // undefined (→ maxConcurrentJob defaults to 1, recovery still enqueues; the
      // publish step surfaces the retired adapter) rather than aborting the sweep.
      const provider = this._integrationManager.getSocialIntegrationUnchecked(
        post.integration.providerIdentifier,
        post.integration.providerVersion ?? undefined
      );
      const taskQueue = post.integration.providerIdentifier
        .split('-')[0]
        .toLowerCase();
      const maxConcurrentJob = provider?.maxConcurrentJob ?? 1;

      if (isInngestEnabled()) {
        await inngest.send({
          name: 'post/cancel',
          data: { postId: post.id },
        });
        await inngest.send({
          name: 'post/publish',
          data: {
            postId: post.id,
            organizationId: post.organizationId,
            taskQueue,
            maxConcurrentJob,
            postNow: true,
          },
          // 0.8: unique-per-send id so successive hourly recovery attempts (and a
          // reschedule's replacement event) are not deduped against a constant
          // `post_${id}` for ~24h. Double-sends are now caught by the 0.7 atomic
          // claim, not by Inngest event dedup.
          id: `post_${post.id}_recovery_${uuidv4()}`,
        });
      } else {
        this.logger.debug(
          `Inngest disabled; skipping recovery re-enqueue for post ${post.id}`
        );
      }
    }
  }

  async updatePost(id: string, postId: string, releaseURL: string, orgId: string) {
    await this._postService.updatePost(id, postId, releaseURL, orgId);
  }

  async getPost(orgId: string, postId: string) {
    if (process.env.STRIPE_SECRET_KEY) {
      const subscription = await this._subscriptionService.getSubscription(
        orgId
      );
      if (!subscription) {
        return false;
      }
    }
    const post = await this._postService.getPostById(postId, orgId);
    // 4.4b: getPostById can return null for a missing/foreign id — guard before
    // reading .deletedAt so a deleted/absent post returns false instead of
    // throwing inside step.run.
    if (!post || post.deletedAt) {
      return false;
    }

    return slimPost(post);
  }

  async getPostsList(orgId: string, postId: string) {
    if (process.env.STRIPE_SECRET_KEY) {
      const subscription = await this._subscriptionService.getSubscription(
        orgId
      );
      if (!subscription) {
        return [];
      }
    }

    const getPosts = await this._postService.getPostsRecursively(
      postId,
      true,
      orgId
    );
    if (!getPosts || getPosts.length === 0 || getPosts[0].parentPostId) {
      return [];
    }

    return getPosts.map(slimPost);
  }

  async isCommentable(integration: Integration) {
    const getIntegration = await this._integrationManager.getSocialIntegration(
      integration.providerIdentifier,
      integration.organizationId,
      integration.providerVersion
    );

    return !!getIntegration.comment;
  }

  async supportsFirstComment(integration: Integration) {
    const capabilities =
      PROVIDER_CAPABILITIES[
        integration.providerIdentifier as keyof typeof PROVIDER_CAPABILITIES
      ];
    if (!capabilities?.firstComment) {
      return false;
    }

    const getIntegration = await this._integrationManager.getSocialIntegration(
      integration.providerIdentifier,
      integration.organizationId,
      integration.providerVersion
    );

    return !!getIntegration.comment;
  }

  async postComment(
    postId: string,
    lastPostId: string | undefined,
    integration: Integration,
    posts: Post[]
  ) {
    // 2.5: re-read the decrypted token (slimmed out of step state).
    integration = await this._withDecryptedIntegration(integration);

    const getIntegration = await this._integrationManager.getSocialIntegration(
      integration.providerIdentifier,
      integration.organizationId,
      integration.providerVersion
    );

    const newPosts = await this._postService.updateTags(
      integration.organizationId,
      posts
    );

    const clientInformation = await this._integrationManager.requireClientInformation(
      integration.providerIdentifier,
      integration.organizationId,
      integration.providerConfigId
    ).catch(() => undefined);

    const commentPayload = await Promise.all(
      (newPosts || []).map(async (p) => {
        const settings = JSON.parse(p.settings || '{}');
        return {
          id: p.id,
          message: stripHtmlValidation(
            getIntegration.editor,
            p.content,
            true,
            false,
            !/<\/?[a-z][\s\S]*>/i.test(p.content),
            getIntegration.mentionFormat
          ),
          settings,
          media: await this._postService.updateMedia(
            p.id,
            JSON.parse(p.image || '[]'),
            getIntegration?.convertToJPEG || false,
            integration.organizationId
          ),
          // 2.2: lift the composer's poll (stored in settings) to the top level.
          ...(settings.poll ? { poll: settings.poll } : {}),
        };
      })
    );

    // 2.2: never publish a plain comment when a poll was requested on a provider
    // that can't do polls.
    this._assertPollSupported(integration.providerIdentifier, commentPayload);

    return getIntegration.comment(
      integration.internalId,
      postId,
      lastPostId,
      integration.token,
      commentPayload,
      integration,
      clientInformation
    );
  }

  async postFirstComment(
    postId: string,
    integration: Integration,
    firstComment: string,
  ) {
    // 2.5: re-read the decrypted token (slimmed out of step state).
    integration = await this._withDecryptedIntegration(integration);

    const getIntegration = await this._integrationManager.getSocialIntegration(
      integration.providerIdentifier,
      integration.organizationId,
      integration.providerVersion
    );

    const clientInformation = await this._integrationManager.requireClientInformation(
      integration.providerIdentifier,
      integration.organizationId,
      integration.providerConfigId
    ).catch(() => undefined);

    return getIntegration.comment(
      integration.internalId,
      postId,
      undefined,
      integration.token,
      [
        {
          id: makeId(10),
          message: stripHtmlValidation(
            getIntegration.editor,
            firstComment,
            true,
            false,
            !/<\/?[a-z][\s\S]*>/i.test(firstComment),
            getIntegration.mentionFormat
          ),
          settings: {},
          media: [],
        },
      ],
      integration,
      clientInformation
    );
  }

  private async _maybeAppendUtm(content: string, campaignId: string | null, organizationId: string, providerIdentifier: string): Promise<string> {
    if (!campaignId) return content;
    const campaign = await this._campaignsRepository.findById(campaignId, organizationId);
    if (!campaign?.utmEnabled) return content;

    const slug = encodeURIComponent(campaign.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''));
    const utm = `utm_campaign=${slug}&utm_source=${encodeURIComponent(providerIdentifier)}&utm_medium=social`;

    return content.replace(/(https?:\/\/[^\s<"']+)/g, (url) => {
      if (url.includes('utm_campaign')) return url;
      const sep = url.includes('?') ? '&' : '?';
      return `${url}${sep}${utm}`;
    });
  }

  // 2.2: capability guard. If any payload item carries a poll but the provider's
  // `poll` capability is false, throw a non-retriable BadBodyError so the post is
  // never silently published as a plain post.
  private _assertPollSupported(
    providerIdentifier: string,
    payload: { poll?: unknown }[]
  ) {
    if (!payload.some((p) => p.poll)) {
      return;
    }
    const capabilities =
      PROVIDER_CAPABILITIES[
        providerIdentifier as keyof typeof PROVIDER_CAPABILITIES
      ];
    if (!capabilities?.poll) {
      throw new BadBodyError(
        providerIdentifier,
        '{}',
        '',
        `Provider ${providerIdentifier} does not support polls`
      );
    }
  }

  async postSocial(integration: Integration, posts: Post[]) {
    if (process.env.STRIPE_SECRET_KEY) {
      const subscription = await this._subscriptionService.getSubscription(
        integration.organizationId
      );

      if (!subscription) {
        throw new Error('No active subscription found for this organization.');
      }
    }

    // 2.5: re-read the decrypted token (slimmed out of step state).
    integration = await this._withDecryptedIntegration(integration);

    const getIntegration = await this._integrationManager.getSocialIntegration(
      integration.providerIdentifier,
      integration.organizationId,
      integration.providerVersion
    );

    const newPosts = await this._postService.updateTags(
      integration.organizationId,
      posts
    );

    const clientInformation = await this._integrationManager.requireClientInformation(
      integration.providerIdentifier,
      integration.organizationId,
      integration.providerConfigId
    ).catch(() => undefined);

    // If the channel has an enabled VPN selection, route every outbound request
    // this provider makes through that region's proxy via AsyncLocalStorage.
    const vpnDispatcher = await this._resolveVpnDispatcher(integration);

    const postPayload = await Promise.all(
      (newPosts || []).map(async (p) => {
        const contentWithUtm = await this._maybeAppendUtm(
          p.content,
          p.campaignId,
          integration.organizationId,
          integration.providerIdentifier
        );
        const settings = JSON.parse(p.settings || '{}');
        return {
          id: p.id,
          message: stripHtmlValidation(
            getIntegration.editor,
            contentWithUtm,
            true,
            false,
            !/<\/?[a-z][\s\S]*>/i.test(contentWithUtm),
            getIntegration.mentionFormat
          ),
          settings,
          media: await this._postService.updateMedia(
            p.id,
            JSON.parse(p.image || '[]'),
            getIntegration?.convertToJPEG || false,
            integration.organizationId
          ),
          // 2.2: lift the composer's poll (stored in settings) up to the
          // top-level `poll` the adapter reads.
          ...(settings.poll ? { poll: settings.poll } : {}),
        };
      })
    );

    // 2.2: never publish a plain post when a poll was requested but this provider
    // can't do polls — fail hard (non-retriable) instead of silently dropping it.
    this._assertPollSupported(integration.providerIdentifier, postPayload);

    // D2: short-circuit when this provider×org breaker is OPEN.
    const breakerKey = `${integration.providerIdentifier}:${integration.organizationId}`;
    if (!this._socialBreaker.canAttempt(breakerKey)) {
      throw new Error(
        `Provider ${integration.providerIdentifier} temporarily unavailable (circuit open) — skipping to retry later`
      );
    }

    let postNow;
    try {
      postNow = await runWithVpnDispatcher(vpnDispatcher, () =>
        getIntegration.post(
          integration.internalId,
          integration.token,
          postPayload,
          integration,
          clientInformation
        )
      );
      this._socialBreaker.recordSuccess(breakerKey);
    } catch (err) {
      // Only count infra-class failures (timeouts, 5xx, network) toward the breaker.
      // A BadBodyError is a permanent per-post content/4xx rejection (NonRetriableError) —
      // it does NOT mean the provider is down, so a batch of legitimately-bad posts must
      // not open the breaker and delay this org's good posts. Leave the breaker untouched.
      if (!(err instanceof BadBodyError)) {
        this._socialBreaker.recordFailure(breakerKey);
      }
      throw err;
    }

    if (isInngestEnabled()) {
      await inngest.send({
        name: 'streak/start',
        data: { organizationId: integration.organizationId },
        id: `streak_${integration.organizationId}`,
      });
    } else {
      this.logger.debug(
        `Inngest disabled; skipping streak/start for org ${integration.organizationId}`
      );
    }

    return postNow;
  }

  async notifyChannelError(
    orgId: string,
    integrationName: string,
    providerIdentifier: string,
    reason: 'refresh' | 'disabled',
    postId?: string
  ) {
    await this._notificationService.notifyChannelError(
      orgId,
      integrationName,
      providerIdentifier,
      reason,
      postId
    );
  }

  async notifyPostPublished(
    orgId: string,
    integrationName: string,
    releaseURL: string,
    postId: string
  ) {
    await this._notificationService.notifyPostPublished(
      orgId,
      integrationName,
      releaseURL,
      postId
    );
  }

  async notifyPostFailed(
    orgId: string,
    integrationName: string,
    postId: string,
    subStep?: string,
    errMessage?: string
  ) {
    await this._notificationService.notifyPostPublishFailure(
      orgId,
      integrationName,
      postId,
      subStep,
      errMessage
    );
  }

  async notifyFirstCommentUnsupported(
    orgId: string,
    integrationName: string,
    postId: string
  ) {
    await this._notificationService.notifyFirstCommentUnsupported(
      orgId,
      integrationName,
      postId
    );
  }

  async notifyFirstCommentFailed(
    orgId: string,
    integrationName: string,
    postId: string
  ) {
    await this._notificationService.notifyFirstCommentFailed(
      orgId,
      integrationName,
      postId
    );
  }

  async notifyStreakReminder(orgId: string) {
    await this._notificationService.notifyStreakReminder(orgId);
  }

  async globalPlugs(integration: Integration) {
    return this._postService.checkPlugs(
      integration.organizationId,
      integration.providerIdentifier,
      integration.id
    );
  }

  async updatePostSettings(id: string, settings: string, orgId: string) {
    await this._postService.updatePostSettings(id, settings, orgId);
  }

  async changeState(id: string, state: State, orgId: string, err?: any, body?: any) {
    await this._postService.changeState(id, state, orgId, err, body);
  }

  async internalPlugs(integration: Integration, settings: any) {
    return this._postService.checkInternalPlug(
      integration,
      integration.organizationId,
      integration.id,
      settings
    );
  }

  async sendWebhooks(postId: string, orgId: string, integrationId: string) {
    const webhooks = (await this._webhookService.getWebhooks(orgId)).filter(
      (f) => {
        return (
          f.integrations.length === 0 ||
          f.integrations.some((i) => i.id === integrationId)
        );
      }
    );

    const post = await this._postService.getPostByForWebhookId(postId, orgId);
    const root = Array.isArray(post) ? post[0] : post;

    // D4: stable, documented minimal subset — never ship the raw Prisma row.
    const envelope = {
      event: 'post.published',
      timestamp: new Date().toISOString(),
      data: {
        postId: root?.id ?? postId,
        integrationId,
        providerIdentifier: root?.integration?.providerIdentifier ?? null,
        integrationName: root?.integration?.name ?? null,
        content: root?.content ?? null,
        url: root?.releaseURL ?? null,
        state: root?.state ?? null,
        publishDate: root?.publishDate
          ? new Date(root.publishDate).toISOString()
          : null,
      },
    };
    const body = JSON.stringify(envelope);
    const signature = webhookSignature(body);

    // D4: bounded per-delivery retry (3 attempts, backoff). A flaky receiver is
    // retried without failing the others; final failure is swallowed so a bad
    // webhook never fails the publish. The whole call already runs inside a
    // durable Inngest `step.run('send-webhooks')`.
    await Promise.all(
      webhooks.map(async (webhook) => {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const res = await safeFetch(webhook.url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Postmill-Signature': signature,
              },
              body,
              signal: AbortSignal.timeout(webhookTimeoutMs()),
            });
            if (res.status >= 200 && res.status < 300) {
              return;
            }
          } catch (e) {
            /** retry below **/
          }
          if (attempt < 2) {
            await timer(1000 * (attempt + 1));
          }
        }
      })
    );
  }

  async processPlug(data: {
    plugId: string;
    postId: string;
    delay: number;
    totalRuns: number;
    currentRun: number;
  }) {
    return this._integrationService.processPlugs(data);
  }

  async processInternalPlug(data: {
    post: string;
    originalIntegration: string;
    integration: string;
    plugName: string;
    orgId: string;
    delay: number;
    information: any;
  }) {
    await this._integrationService.processInternalPlug(data);
  }

  async refreshToken(
    integration: Integration
  ): Promise<false | AuthTokenDetails> {
    // 2.5: the refresh needs the decrypted refreshToken, slimmed out of step state.
    integration = await this._withDecryptedIntegration(integration);

    const getIntegration = await this._integrationManager.getSocialIntegration(
      integration.providerIdentifier,
      integration.organizationId,
      integration.providerVersion
    );

    try {
      const refresh = await this._refreshIntegrationService.refresh(
        integration
      );
      if (!refresh) {
        return false;
      }

      if (getIntegration.refreshWait) {
        await timer(10000);
      }

      return refresh;
    } catch (err) {
      await this._refreshIntegrationService.setBetweenSteps(integration);
      return false;
    }
  }

  async refreshTokenWithCause(
    integration: Integration,
    cause: string
  ): Promise<false | AuthTokenDetails> {
    // 2.5: the refresh needs the decrypted refreshToken, slimmed out of step state.
    integration = await this._withDecryptedIntegration(integration);

    const getIntegration = await this._integrationManager.getSocialIntegration(
      integration.providerIdentifier,
      integration.organizationId,
      integration.providerVersion
    );

    try {
      const refresh = await this._refreshIntegrationService.refresh(
        integration,
        cause
      );
      if (!refresh) {
        return false;
      }

      if (getIntegration.refreshWait) {
        await timer(10000);
      }

      return refresh;
    } catch (err) {
      await this._refreshIntegrationService.setBetweenSteps(integration, cause);
      return false;
    }
  }


}
