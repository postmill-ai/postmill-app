import {
  BadRequestException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { mapWithConcurrency } from '@gitroom/nestjs-libraries/utils/concurrency';
import { GuardrailService } from '@gitroom/nestjs-libraries/ai/governance/guardrail.service';
import { GuardrailViolation } from '@gitroom/nestjs-libraries/ai/governance/errors';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { isCuid } from '@gitroom/nestjs-libraries/pipes/parse-cuid.pipe';
import { GetInboxDto } from '@gitroom/nestjs-libraries/dtos/social-comments/get-inbox.dto';
import { Organization, User } from '@prisma/client';
import { isUUID } from 'class-validator';
import { OrgProviderConfigManager } from '@gitroom/nestjs-libraries/integrations/org-provider-config.manager';
import { SocialCommentsRepository } from '@gitroom/nestjs-libraries/database/prisma/social-comments/social.comments.repository';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { WebhooksService } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service';
import dayjs from 'dayjs';
import { timer } from '@gitroom/helpers/utils/timer';
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import {
  SocialProvider,
  SocialCommentDTO,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { Post, Integration } from '@prisma/client';

const CommentStatus = {
  NEEDS_REPLY: 'needs_reply',
  HANDLED: 'handled',
  IGNORED: 'ignored',
} as const;
type CommentStatus = (typeof CommentStatus)[keyof typeof CommentStatus];
export const VALID_COMMENT_STATUSES: readonly string[] = Object.values(CommentStatus);

export interface InboxFilterOptions {
  status?: string;
  assigneeId?: string;
  cursor?: string;
  unreadOnly?: boolean;
  // Multi-select: empty/absent = no filter; one or more ids = `where … { in: [...] }`.
  campaignIds?: string[];
  integrationIds?: string[];
  // Page size (1-50); absent → 50 (REST default). The MCP inbox tool threads a
  // smaller value so its nextCursor points at the last item it actually returns.
  limit?: number;
}

@Injectable()
export class SocialCommentsService {
  constructor(
    private _socialCommentsRepository: SocialCommentsRepository,
    private _postsService: PostsService,
    private _integrationManager: IntegrationManager,
    private _refreshIntegrationService: RefreshIntegrationService,
    private _integrationService: IntegrationService,
    private _webhooksService: WebhooksService,
    private _orgProviderConfigManager: OrgProviderConfigManager,
    private _guardrails: GuardrailService,
  ) {}

  // The org's output guardrail is ALWAYS enforced on outward replies — enforcement
  // decided by the caller is not enforcement. It is a no-op for orgs with no output
  // chain. A block-mode chain throws GuardrailViolation → mapped to 422 so the HITL
  // card can show the reason instead of a raw 500 (3.1).
  private async _guardOutbound(
    message: string,
    org: Organization,
    user: User,
  ): Promise<string> {
    try {
      return await this._guardrails.checkOutput(message, {
        orgId: org.id,
        userId: user.id,
      });
    } catch (e) {
      if (e instanceof GuardrailViolation) {
        throw new UnprocessableEntityException(e.message);
      }
      throw e;
    }
  }

  // Optional idempotency for the two outward-dispatching reply routes. A client
  // (the agent HITL card, or any retry after an ambiguous timeout) sends the same
  // X-Idempotency-Key so a retry cannot double-dispatch an outward comment.
  //
  // Contract: the key is claimed with SET NX right before dispatch and RELEASED
  // if the dispatch throws — so a definite failure (provider error) is retryable,
  // while a *successful* dispatch keeps the key so an ambiguous
  // client-timeout-after-success still dedups. Guardrail validation runs BEFORE the
  // claim, so a blocked message never burns a slot. Best-effort throughout: a Redis
  // outage fails OPEN (proceeds without dedup), matching the shared
  // IdempotencyFactory. Absent key → always proceed (unchanged). (3.2)
  private async _withIdempotency<T>(
    orgId: string,
    key: string | undefined,
    dispatch: () => Promise<T>,
  ): Promise<T | { duplicate: true }> {
    if (!(await this._claimIdempotencyKey(orgId, key))) {
      return { duplicate: true };
    }
    try {
      return await dispatch();
    } catch (e) {
      // Dispatch failed → release the claim so a legitimate same-key retry can
      // re-attempt instead of getting a false "duplicate" success. (Residual: a DB
      // write failing right after a successful outward post could let one retry
      // re-post — inherent to receipt-time dedup; the shared response-replay
      // IdempotencyFactory is the fuller fix if this ever matters.)
      await this._releaseIdempotencyKey(orgId, key);
      throw e;
    }
  }

  private async _claimIdempotencyKey(
    orgId: string,
    key: string | undefined,
  ): Promise<boolean> {
    if (!key) return true;
    try {
      const res = await ioRedis.set(
        `idem:${orgId}:${key}`,
        '1',
        'EX',
        86400,
        'NX'
      );
      return res === 'OK';
    } catch (e) {
      // Redis outage → fail open (proceed without dedup), never fail the reply.
      return true;
    }
  }

  private async _releaseIdempotencyKey(
    orgId: string,
    key: string | undefined
  ) {
    if (!key) return;
    try {
      await ioRedis.del(`idem:${orgId}:${key}`);
    } catch {
      // best-effort — a stale key just expires at the 24h TTL
    }
  }

  /**
   * Parse and validate the raw inbox query DTO into the internal filter shape.
   * Moved from the controller so validation lives next to the repository contract.
   */
  parseInboxFilters(query: GetInboxDto): InboxFilterOptions {
    if (
      query.status &&
      !(VALID_COMMENT_STATUSES as readonly string[]).includes(query.status)
    ) {
      throw new BadRequestException(
        `Invalid status: ${query.status}. Must be one of: ${VALID_COMMENT_STATUSES.join(', ')}`
      );
    }

    if (query.assigneeId && !isCuid(query.assigneeId)) {
      throw new BadRequestException('Invalid assigneeId');
    }

    // integrationId/campaignId accept a single id or a comma-separated list
    // (multi-select filter). A lone value stays byte-for-byte compatible
    // (splits to a 1-element array).
    const campaignIds = query.campaignId
      ? query.campaignId
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    for (const id of campaignIds) {
      if (!isUUID(id)) throw new BadRequestException('Invalid campaignId');
    }

    const integrationIds = query.integrationId
      ? query.integrationId
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    for (const id of integrationIds) {
      if (!isCuid(id)) throw new BadRequestException('Invalid integrationId');
    }

    return {
      status: query.status,
      assigneeId: query.assigneeId,
      cursor: query.cursor,
      unreadOnly: query.unreadOnly,
      campaignIds,
      integrationIds,
      limit: query.limit,
    };
  }

  // Guarded outward-dispatch wrappers used by the controller. The guardrail runs
  // deterministically before the idempotency claim, and idempotency wraps the
  // actual provider dispatch.
  async addComment(
    orgId: string,
    userId: string,
    postId: string,
    message: string,
    org: Organization,
    user: User,
    idempotencyKey?: string,
  ): Promise<SocialCommentDTO | { duplicate: true }> {
    const guarded = await this._guardOutbound(message, org, user);
    return this._withIdempotency(orgId, idempotencyKey, () =>
      this.replyToPost(orgId, userId, postId, guarded)
    );
  }

  async replyToCommentGuarded(
    orgId: string,
    userId: string,
    postId: string,
    commentId: string,
    message: string,
    org: Organization,
    user: User,
    idempotencyKey?: string,
  ): Promise<SocialCommentDTO | { duplicate: true }> {
    const guarded = await this._guardOutbound(message, org, user);
    return this._withIdempotency(orgId, idempotencyKey, () =>
      this.replyToComment(orgId, userId, postId, commentId, guarded)
    );
  }

  private async refreshTokenIfExpired(
    integration: { token: string; tokenExpiration?: Date | null; organizationId: string } & Integration,
    provider: SocialProvider
  ): Promise<{ token: string; integration: typeof integration }> {
    let token = integration.token;
    if (integration.tokenExpiration && dayjs(integration.tokenExpiration).isBefore(dayjs())) {
      const refreshed = await this._refreshIntegrationService.refresh(integration);
      if (!refreshed || !refreshed.accessToken) {
        await this._integrationService.disconnectChannel(integration.organizationId, integration);
        throw new BadRequestException('Token expired — please reconnect this channel');
      }
      token = refreshed.accessToken;
      if (provider.refreshWait) {
        await timer(10000);
      }
    }
    return { token, integration };
  }

  async getComments(orgId: string, userId: string, postId: string, cursor?: string) {
    const post = await this._postsService.getPostById(postId, orgId);
    if (!post) throw new BadRequestException('Post not found');
    if (!post.releaseId || post.releaseId === 'missing') {
      return { comments: [], nextCursor: undefined, unreadCount: 0 };
    }

    const comments = await this._socialCommentsRepository.getComments(orgId, postId, cursor);
    const hasMore = comments.length > 50;
    const items = hasMore ? comments.slice(0, 50) : comments;
    const nextCursor = hasMore && items.length
      ? items[items.length - 1].platformCreatedAt.toISOString()
      : undefined;
    const unreadCount = await this._socialCommentsRepository.getUnreadCount(userId, postId, orgId);

    return { comments: items, nextCursor, unreadCount };
  }

  async replyToComment(orgId: string, userId: string, postId: string, commentId: string, message: string, retried = false): Promise<SocialCommentDTO> {
    const comment = await this._socialCommentsRepository.getCommentById(commentId, orgId);
    if (!comment || comment.postId !== postId) {
      throw new BadRequestException('Comment not found');
    }

    const post = await this._postsService.getPostById(postId, orgId);
    if (!post || !post.releaseId || post.releaseId === 'missing') {
      throw new BadRequestException('Post not found or missing release ID');
    }

    const provider = this._integrationManager.getSocialIntegrationUnchecked(
      post.integration.providerIdentifier,
      post.integration.providerVersion ?? undefined
    );
    if (!provider?.replyToComment) {
      throw new BadRequestException('Comments not supported for this channel');
    }

    const { token } = await this.refreshTokenIfExpired(post.integration, provider);

    const clientInformation = await this._integrationManager.requireClientInformation(
      post.integration.providerIdentifier,
      post.integration.organizationId,
      post.integration.providerConfigId
    ).catch(() => undefined);

    try {
      const result = await provider.replyToComment(
        post.integration.internalId,
        token,
        post.releaseId,
        comment.platformCommentId,
        message,
        post.integration,
        clientInformation,
      );

      // Providers swallow API errors and return a fabricated DTO with an empty
      // platformCommentId. Don't persist that (it collides on the unique
      // (integrationId, platformCommentId) key) or report it as success.
      if (!result?.platformCommentId) {
        throw new BadRequestException('Failed to post reply — please try again');
      }

      await this._socialCommentsRepository.upsertComment({
        organizationId: orgId,
        postId,
        integrationId: comment.integrationId,
        platformCommentId: result.platformCommentId,
        parentPlatformCommentId: comment.platformCommentId,
        authorId: result.author.id,
        authorName: result.author.name,
        authorUsername: result.author.username,
        authorPicture: result.author.picture,
        content: result.content,
        likeCount: result.likeCount,
        replyCount: result.replyCount,
        likedByMe: result.likedByMe,
        isOwn: true,
        platformCreatedAt: result.createdAt ? new Date(result.createdAt) : new Date(),
        raw: result.raw ? JSON.stringify(result.raw) : undefined,
      });

      return result;
    } catch (err: unknown) {
      if (err instanceof RefreshToken && !retried) {
        return this.replyToComment(orgId, userId, postId, commentId, message, true);
      }
      throw err;
    }
  }

  async likeComment(orgId: string, userId: string, postId: string, commentId: string, like: boolean, retried = false): Promise<{ liked: boolean; likeCount?: number }> {
    const comment = await this._socialCommentsRepository.getCommentById(commentId, orgId);
    if (!comment || comment.postId !== postId) {
      throw new BadRequestException('Comment not found');
    }

    const post = await this._postsService.getPostById(postId, orgId);
    if (!post || !post.releaseId || post.releaseId === 'missing') {
      throw new BadRequestException('Post not found or missing release ID');
    }

    const provider = this._integrationManager.getSocialIntegrationUnchecked(
      post.integration.providerIdentifier,
      post.integration.providerVersion ?? undefined
    );
    if (!provider?.likeComment) {
      throw new BadRequestException('Comments not supported for this channel');
    }

    const { token } = await this.refreshTokenIfExpired(post.integration, provider);

    const clientInformation = await this._integrationManager.requireClientInformation(
      post.integration.providerIdentifier,
      post.integration.organizationId,
      post.integration.providerConfigId
    ).catch(() => undefined);

    try {
      const result = await provider.likeComment(
        post.integration.internalId,
        token,
        post.releaseId,
        comment.platformCommentId,
        like,
        post.integration,
        clientInformation,
      );

      await this._socialCommentsRepository.upsertComment({
        organizationId: orgId,
        postId,
        integrationId: comment.integrationId,
        platformCommentId: comment.platformCommentId,
        authorId: comment.authorId,
        authorName: comment.authorName,
        authorUsername: comment.authorUsername ?? undefined,
        authorPicture: comment.authorPicture ?? undefined,
        content: comment.content,
        likeCount: result.likeCount ?? comment.likeCount,
        likedByMe: result.liked,
        platformCreatedAt: comment.platformCreatedAt,
      });

      return result;
    } catch (err: unknown) {
      if (err instanceof RefreshToken && !retried) {
        return this.likeComment(orgId, userId, postId, commentId, like, true);
      }
      throw err;
    }
  }

  async markAsRead(orgId: string, userId: string, postId: string) {
    const post = await this._postsService.getPostById(postId, orgId);
    if (!post) {
      throw new BadRequestException('Post not found');
    }

    return this._socialCommentsRepository.upsertReadState(userId, postId, new Date());
  }

  async getUnreadCount(orgId: string, userId: string, postId: string) {
    const post = await this._postsService.getPostById(postId, orgId);
    if (!post) {
      throw new BadRequestException('Post not found');
    }

    return {
      unreadCount: await this._socialCommentsRepository.getUnreadCount(userId, postId, orgId),
    };
  }

  async updateCommentStatus(
    orgId: string,
    userId: string,
    postId: string,
    commentId: string,
    status: string,
  ) {
    if (!status || !VALID_COMMENT_STATUSES.includes(status)) {
      throw new BadRequestException('Invalid comment status');
    }

    const post = await this._postsService.getPostById(postId, orgId);
    if (!post) throw new BadRequestException('Post not found');

    const comment = await this._socialCommentsRepository.getCommentById(commentId, orgId);
    if (!comment || comment.postId !== postId) {
      throw new BadRequestException('Comment not found');
    }

    return this._socialCommentsRepository.updateCommentStatus(commentId, orgId, status);
  }

  async assignComment(
    orgId: string,
    userId: string,
    postId: string,
    commentId: string,
    assigneeId: string | null,
  ) {
    const post = await this._postsService.getPostById(postId, orgId);
    if (!post) throw new BadRequestException('Post not found');

    const comment = await this._socialCommentsRepository.getCommentById(commentId, orgId);
    if (!comment || comment.postId !== postId) {
      throw new BadRequestException('Comment not found');
    }

    if (assigneeId) {
      const isMember = await this._socialCommentsRepository.isOrganizationMember(
        assigneeId,
        orgId,
      );
      if (!isMember) {
        throw new BadRequestException('Assignee must be a member of this organization');
      }
    }

    return this._socialCommentsRepository.assignComment(commentId, orgId, assigneeId);
  }

  async syncComments(orgId: string, post: Post & { integration: Integration }) {
    if (!post.releaseId || post.releaseId === 'missing') return;

    const provider = this._integrationManager.getSocialIntegrationUnchecked(
      post.integration.providerIdentifier,
      post.integration.providerVersion ?? undefined
    );
    if (!provider?.fetchComments) return;

    let token = post.integration.token;
    if (
      post.integration.tokenExpiration &&
      dayjs(post.integration.tokenExpiration).isBefore(dayjs())
    ) {
      try {
        const refreshed = await this._refreshIntegrationService.refresh(post.integration);
        if (!refreshed || !refreshed.accessToken) {
          await this._integrationService.disconnectChannel(orgId, post.integration);
          return;
        }
        token = refreshed.accessToken;
        if (provider.refreshWait) {
          await timer(10000);
        }
      } catch {
        return;
      }
    }

    let cursor: string | undefined;
    let hasMore = true;
    let attempts = 0;
    const MAX_PAGES = 5;
    const syncedIds = new Set<string>();
    // Whether we fetched the post's full comment set. A truncated (MAX_PAGES) or
    // errored sweep leaves syncedIds partial and must NOT drive deletions.
    let fullySynced = true;

    const clientInformation = await this._integrationManager.requireClientInformation(
      post.integration.providerIdentifier,
      post.integration.organizationId,
      post.integration.providerConfigId
    ).catch(() => undefined);

    while (hasMore && attempts < MAX_PAGES) {
      attempts++;
      try {
        const result = await provider.fetchComments(
          post.integration.internalId,
          token,
          post.releaseId,
          cursor,
          post.integration,
          clientInformation,
        );

        const comments = result.comments ?? [];

        if (!comments.length) {
          hasMore = false;
          continue;
        }

        for (const comment of comments) {
          syncedIds.add(comment.platformCommentId);
          await this._socialCommentsRepository.upsertComment({
            organizationId: orgId,
            postId: post.id,
            integrationId: post.integrationId,
            platformCommentId: comment.platformCommentId,
            parentPlatformCommentId: comment.parentPlatformCommentId,
            authorId: comment.author.id,
            authorName: comment.author.name,
            authorUsername: comment.author.username,
            authorPicture: comment.author.picture,
            content: comment.content,
            likeCount: comment.likeCount,
            replyCount: comment.replyCount,
            likedByMe: comment.likedByMe,
            platformCreatedAt: comment.createdAt ? new Date(comment.createdAt) : new Date(),
            raw: comment.raw ? JSON.stringify(comment.raw) : undefined,
          });

          try {
            await this._webhooksService.dispatchEvent(orgId, 'comment.new', {
              postId: post.id,
              commentId: comment.platformCommentId,
              content: comment.content,
              authorName: comment.author.name,
              integrationId: post.integrationId,
            });
          } catch {
            // best-effort webhook dispatch
          }
        }

        cursor = result.nextCursor;
        if (!cursor) hasMore = false;
      } catch (err: unknown) {
        fullySynced = false;
        if (err instanceof RefreshToken) {
          break;
        }
        hasMore = false;
      }
    }

    // Exited with pages remaining → truncated, partial set.
    if (hasMore) fullySynced = false;

    // Reconcile on-platform deletions only when we have the authoritative full
    // set; otherwise we'd soft-delete comments we simply didn't page to.
    if (fullySynced) {
      const existing = await this._socialCommentsRepository.getActiveCommentIds(post.id, orgId);
      const toDelete = existing
        .filter((c) => !syncedIds.has(c.platformCommentId))
        .map((c) => c.id);
      await this._socialCommentsRepository.softDeleteCommentsByIds(toDelete, orgId);
    }

    const count = await this._socialCommentsRepository.countComments(post.id, orgId);
    await this._postsService.updateCommentCount(post.id, count, orgId);
  }

  async syncInbox(orgId: string): Promise<{ synced: boolean; timestamp: string }> {
    await this._orgProviderConfigManager.ensureFresh(orgId);
    const since = dayjs().subtract(30, 'day').startOf('day').toDate();

    let cursor: string | undefined;
    let hasMore = true;
    while (hasMore) {
      const posts = await this._socialCommentsRepository.getPublishedPostsForSync(
        orgId,
        since,
        cursor,
      );

      const syncable = posts.filter(
        (post) => post.releaseId && post.releaseId !== 'missing',
      );
      // Bounded concurrency (5) instead of serial — provider rate limits cap the width.
      await mapWithConcurrency(syncable, 5, async (post) => {
        try {
          await this.syncComments(orgId, post);
        } catch {
          // individual post sync errors are non-fatal
        }
      });

      hasMore = posts.length === 50;
      if (hasMore) {
        cursor = posts[posts.length - 1].id;
      }
    }

    return { synced: true, timestamp: new Date().toISOString() };
  }

  async getInbox(orgId: string, userId: string, filters: InboxFilterOptions) {
    return this._socialCommentsRepository.getInbox(orgId, userId, filters);
  }

  // ── Comment-sweep passthroughs (used by CommentsActivity, D1) ──

  getPublishedPostsForSync(orgId: string, since: Date, cursor?: string) {
    return this._socialCommentsRepository.getPublishedPostsForSync(
      orgId,
      since,
      cursor,
    );
  }

  getPostsWithRecentComments(orgId: string, since: Date, take = 50) {
    return this._socialCommentsRepository.getPostsWithRecentComments(
      orgId,
      since,
      take,
    );
  }

  findCommentsToPrune(orgId: string, cutoff: Date, take = 1000) {
    return this._socialCommentsRepository.findCommentsToPrune(orgId, cutoff, take);
  }

  softDeleteCommentsByIds(ids: string[], orgId: string) {
    return this._socialCommentsRepository.softDeleteCommentsByIds(ids, orgId);
  }

  getPostsForCommentDigest(orgId: string, cutoff: Date, take = 10) {
    return this._socialCommentsRepository.getPostsForCommentDigest(
      orgId,
      cutoff,
      take,
    );
  }

  // Count of synced comments across all posts in a campaign — backs the campaign
  // dashboard's "Comments" KPI (distinct from the platform-reported lastComments sum).
  async countCampaignComments(orgId: string, campaignId: string): Promise<number> {
    return this._socialCommentsRepository.countByCampaign(orgId, campaignId);
  }

  async bulkMarkRead(commentIds: string[], orgId: string) {
    return this._socialCommentsRepository.bulkMarkRead(commentIds, orgId);
  }

  async getInboxUnreadCount(orgId: string, userId: string) {
    const count = await this._socialCommentsRepository.getInboxUnreadCount(orgId, userId);
    return { unreadCount: count };
  }

  async replyToPost(orgId: string, userId: string, postId: string, message: string, retried = false): Promise<SocialCommentDTO> {
    const post = await this._postsService.getPostById(postId, orgId);
    if (!post || !post.releaseId || post.releaseId === 'missing') {
      throw new BadRequestException('Post not found or missing release ID');
    }

    const provider = this._integrationManager.getSocialIntegrationUnchecked(
      post.integration.providerIdentifier,
      post.integration.providerVersion ?? undefined
    );
    if (!provider?.replyToComment) {
      throw new BadRequestException('Comments not supported for this channel');
    }

    const { token } = await this.refreshTokenIfExpired(post.integration, provider);

    const clientInformation = await this._integrationManager.requireClientInformation(
      post.integration.providerIdentifier,
      post.integration.organizationId,
      post.integration.providerConfigId
    ).catch(() => undefined);

    try {
      const result = await provider.replyToComment(
        post.integration.internalId,
        token,
        post.releaseId,
        post.releaseId,
        message,
        post.integration,
        clientInformation,
      );

      // See replyToComment: a fabricated empty-id DTO means the provider call
      // failed; surface it rather than persisting a bogus comment.
      if (!result?.platformCommentId) {
        throw new BadRequestException('Failed to post reply — please try again');
      }

      await this._socialCommentsRepository.upsertComment({
        organizationId: orgId,
        postId,
        integrationId: post.integrationId,
        platformCommentId: result.platformCommentId,
        parentPlatformCommentId: undefined,
        authorId: result.author.id,
        authorName: result.author.name,
        authorUsername: result.author.username,
        authorPicture: result.author.picture,
        content: result.content,
        likeCount: result.likeCount,
        replyCount: result.replyCount,
        likedByMe: result.likedByMe,
        isOwn: true,
        platformCreatedAt: result.createdAt ? new Date(result.createdAt) : new Date(),
        raw: result.raw ? JSON.stringify(result.raw) : undefined,
      });

      try {
        await this._webhooksService.dispatchEvent(orgId, 'comment.reply', {
          postId,
          commentId: result.platformCommentId,
          content: result.content,
          authorName: result.author.name,
        });
      } catch {
        // best-effort webhook dispatch
      }

      return result;
    } catch (err: unknown) {
      if (err instanceof RefreshToken && !retried) {
        return this.replyToPost(orgId, userId, postId, message, true);
      }
      throw err;
    }
  }
}
