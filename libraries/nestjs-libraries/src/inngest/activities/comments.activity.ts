import { Injectable, Logger } from '@nestjs/common';
import { OrgProviderConfigManager } from '@gitroom/nestjs-libraries/integrations/org-provider-config.manager';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { SocialCommentsService } from '@gitroom/nestjs-libraries/database/prisma/social-comments/social.comments.service';
import { WebhooksService } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import dayjs from 'dayjs';

@Injectable()
export class CommentsActivity {
  private readonly logger = new Logger(CommentsActivity.name);

  constructor(
    private _organizationService: OrganizationService,
    private _orgProviderConfigManager: OrgProviderConfigManager,
    private _socialCommentsService: SocialCommentsService,
    private _webhooksService: WebhooksService,
    private _notificationService: NotificationService,
  ) {}

  // Process one keyset page of published posts for comment sync. Durable callers
  // (the Inngest sync-org function) loop over this with a per-page step.run so
  // the cursor is checkpointed across retries; the all-pages wrapper below stays
  // available for callers that don't need durability.
  async syncPostCommentsPage(
    orgId: string,
    daysBack: number,
    cursor?: string
  ): Promise<{ nextCursor?: string; processed: number }> {
    await this._orgProviderConfigManager.ensureFresh(orgId);
    const since = dayjs().subtract(daysBack, 'day').startOf('day').toDate();

    const posts = await this._socialCommentsService.getPublishedPostsForSync(
      orgId,
      since,
      cursor
    );

    for (const post of posts) {
      if (!post.releaseId || post.releaseId === 'missing') continue;

      try {
        await this._socialCommentsService.syncComments(orgId, post);
      } catch (err: any) {
        this.logger.error(
          `CommentsActivity: Error syncing comments for post ${post.id}:`,
          { error: err?.message }
        );
      }
    }

    const hasMore = posts.length === 50;
    return {
      nextCursor: hasMore ? posts[posts.length - 1].id : undefined,
      processed: posts.length,
    };
  }

  // Non-durable all-pages wrapper. Keeps the original contract for callers and
  // tests that don't need per-page checkpointing.
  async syncPostComments(orgId: string, daysBack: number): Promise<void> {
    let cursor: string | undefined;
    do {
      const result = await this.syncPostCommentsPage(orgId, daysBack, cursor);
      cursor = result.nextCursor;
    } while (cursor);
  }

  async getSweepIntervalMinutes(): Promise<number> {
    const minutes = parseInt(process.env.COMMENTS_SWEEP_INTERVAL_MINUTES || '30', 10);
    return Number.isFinite(minutes) && minutes > 0 ? minutes : 30;
  }

  async dispatchWebhookForComments(orgId: string, daysBack: number): Promise<void> {
    const since = dayjs().subtract(daysBack, 'day').startOf('day').toDate();

    const posts = await this._socialCommentsService.getPostsWithRecentComments(
      orgId,
      since,
      50
    );

    if (posts.length === 0) return;

    try {
      await this._webhooksService.dispatchEvent(orgId, 'comment.new', {
        batchSize: posts.length,
        timeframe: 'last_sync',
      });
    } catch (err) {
      this.logger.error('dispatchWebhookForComments error:', { error: (err as Error)?.message });
    }
  }

  async getDaysBack(): Promise<number> {
    const days = parseInt(process.env.POST_DAYS_BACK || '30', 10);
    return Number.isFinite(days) && days > 0 ? days : 30;
  }

  async getAllOrganizationIds(): Promise<string[]> {
    const orgs = await this._organizationService.getAllIds();
    return orgs.map((o) => o.id);
  }

  async pruneComments(orgId: string): Promise<void> {
    const days = parseInt(process.env.SOCIAL_COMMENT_RETENTION_DAYS || '90', 10);
    const validatedDays = Number.isFinite(days) && days > 0 ? days : 90;
    const cutoff = dayjs().subtract(validatedDays, 'day').toDate();

    let batch = await this._socialCommentsService.findCommentsToPrune(
      orgId,
      cutoff,
      1000
    );

    // Idempotent-retry choice: the entire prune runs inside one durable step.run
    // ('prune-comments' in the Inngest function). Batching by 1000 keeps each
    // soft-delete call bounded; softDeleteCommentsByIds is idempotent, so a retry
    // after a partial batch simply re-deletes the same ids and continues.
    while (batch.length > 0) {
      await this._socialCommentsService.softDeleteCommentsByIds(
        batch.map((r) => r.id),
        orgId
      );

      batch = await this._socialCommentsService.findCommentsToPrune(
        orgId,
        cutoff,
        1000
      );
    }
  }

  async notifyNewComments(orgId: string): Promise<void> {
    const cutoff = dayjs().subtract(6, 'hour').toDate();

    const posts = await this._socialCommentsService.getPostsForCommentDigest(
      orgId,
      cutoff
    );

    if (!posts.length) return;

    const totalNewComments = posts.reduce(
      (sum, p) => sum + p.socialComments.length,
      0
    );

    await this._notificationService.notifyCommentDigest(
      orgId,
      totalNewComments,
      posts
    );
  }
}
