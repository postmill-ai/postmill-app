import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { AuditService } from '@gitroom/nestjs-libraries/database/prisma/audit/audit.service';

/**
 * DeletionService (ENHANCEMENTS_2 I1) — GDPR erasure of an organization or a user
 * and all of their owned children.
 *
 * Layering note: this is a sanctioned seeder/teardown-style exception (mirrors
 * `BackfillService`/`RbacSeeder`) — it touches `PrismaService` + `$transaction`
 * directly because the work is an ordered cross-table teardown that no single
 * domain repository owns.
 *
 * Correctness: even though every direct `Organization` child relation now carries
 * `onDelete: Cascade` (schema change in this task), a single `organization.delete()`
 * cannot be relied on alone — required cross-child FKs (e.g. `Post.integrationId`)
 * have no cascade and would fail mid-cascade in an undefined order. So we perform an
 * explicit child→parent `deleteMany` teardown that is deterministic and FK-safe, and
 * delete the (now childless) organization row last. The cascades remain as
 * defense-in-depth for any table this list might miss.
 */
@Injectable()
export class DeletionService {
  private readonly _logger = new Logger(DeletionService.name);

  // Generous bound — a busy org has many rows across ~50 tables. Interactive
  // transactions default to 5s, which is too tight for a full teardown.
  private static readonly TX_OPTIONS: { maxWait: number; timeout: number } = {
    maxWait: 30_000,
    timeout: 120_000,
  };

  constructor(
    private readonly _prisma: PrismaService,
    private readonly _audit: AuditService
  ) {}

  /**
   * Delete an organization and every owned child in one transaction.
   * Returns the org id on success.
   */
  async deleteOrganization(
    orgId: string,
    actor?: { userId?: string }
  ): Promise<{ id: string }> {
    await this._prisma.$transaction(async (tx) => {
      await this._teardownOrg(tx, orgId);
      await tx.organization.delete({ where: { id: orgId } });
    }, DeletionService.TX_OPTIONS);

    // Audit is best-effort and written AFTER the transaction (the org's own
    // AuditLog rows were just deleted; this row records the erasure itself).
    try {
      await this._audit.create({
        organizationId: orgId,
        userId: actor?.userId,
        action: 'organization.delete',
        entity: 'organization',
        entityId: orgId,
        details: JSON.stringify({ actorUserId: actor?.userId ?? null }),
      });
    } catch (err) {
      this._logger.warn(
        `Failed to audit organization deletion ${orgId}: ${(err as Error)?.message}`
      );
    }

    this._logger.log(`Deleted organization ${orgId} and all owned children`);
    return { id: orgId };
  }

  /**
   * Delete a user account: erase the organizations they solely own, drop their
   * memberships of shared orgs, remove their personal rows, then delete the user.
   */
  async deleteUser(userId: string): Promise<{ id: string }> {
    // 1. Erase only organizations where this user is the SOLE MEMBER (no co-tenants).
    // An org where the user is the sole *owner* but other members still exist is NOT torn
    // down — that would destroy those members' content/access. For those, step 2 just
    // removes this user's membership (ownership reassignment is a separate product flow).
    const soleMemberOrgIds = await this._soleMemberOrgIds(userId);
    for (const orgId of soleMemberOrgIds) {
      await this.deleteOrganization(orgId, { userId });
    }

    // 2. Remove the user and their remaining personal rows in one transaction.
    await this._prisma.$transaction(async (tx) => {
      // Required-FK rows that would block the user delete (no cascade).
      // (DesignTemplate has no creator FK — nothing to delete there.)
      await tx.design.deleteMany({ where: { createdById: userId } });
      await tx.comments.deleteMany({ where: { userId } });
      await tx.postCommentRead.deleteMany({ where: { userId } });
      await tx.oAuthAuthorization.deleteMany({ where: { userId } });
      await tx.apiKey.deleteMany({ where: { userId } });
      // AiDesignerSession.userId is RESTRICT (messages cascade off the session).
      await tx.aiDesignerSession.deleteMany({ where: { userId } });

      // Membership rows for shared orgs (the sole-owned ones are already gone).
      await tx.userOrganization.deleteMany({ where: { userId } });

      // Cascade-marked children (Session, UserProfile, NotificationPreference,
      // NotificationDigestQueue, PushToken, NotificationRead) drop with the user.
      // Optional FKs (AISpendLog/AISettingsAudit/AIMediaJob.userId,
      // SocialComment.assigneeId, Post.approvedById, Campaign/CampaignItem.createdById)
      // null out via their relation's default SetNull.
      await tx.user.delete({ where: { id: userId } });
    }, DeletionService.TX_OPTIONS);

    this._logger.log(`Deleted user ${userId} and owned data`);
    return { id: userId };
  }

  /**
   * Organizations where `userId` is the ONLY member (no other members of any role).
   * Only these are safe to fully erase on user deletion — an org with co-tenants is left
   * intact (the user's membership is removed separately) so we never destroy other users'
   * data when one member deletes their account.
   */
  private async _soleMemberOrgIds(userId: string): Promise<string[]> {
    const memberships = await this._prisma.userOrganization.findMany({
      where: { userId },
      select: { organizationId: true },
    });

    const sole: string[] = [];
    for (const { organizationId } of memberships) {
      const otherMembers = await this._prisma.userOrganization.count({
        where: { organizationId, userId: { not: userId } },
      });
      if (otherMembers === 0) {
        sole.push(organizationId);
      }
    }
    return sole;
  }

  /**
   * Ordered child→parent deleteMany teardown for one org. Every statement is
   * scoped to the org (directly via `organizationId`/`orgId`, or via a relation
   * filter for grandchildren keyed off a child). Order matters only for required
   * FKs without a cascade (Post↔Integration, *→Post, *→Integration, role chain).
   */
  private async _teardownOrg(
    tx: Prisma.TransactionClient,
    orgId: string
  ): Promise<void> {
    const org = { organizationId: orgId };

    // --- Post graph: post-children → posts → integration-children → integrations
    await tx.plugs.deleteMany({ where: org });
    await tx.tagsPosts.deleteMany({
      where: { post: { organizationId: orgId } },
    });
    await tx.postCommentRead.deleteMany({
      where: { post: { organizationId: orgId } },
    });
    await tx.comments.deleteMany({ where: org });
    await tx.socialComment.deleteMany({ where: org });
    await tx.postAnalyticsSnapshot.deleteMany({ where: org });
    await tx.analyticsSnapshot.deleteMany({ where: org });
    await tx.errors.deleteMany({ where: org });
    await tx.shortLinkSnapshot.deleteMany({ where: org });
    await tx.shortLink.deleteMany({ where: org });
    await tx.post.deleteMany({ where: { organizationId: orgId } });
    await tx.integration.deleteMany({ where: org });
    await tx.customer.deleteMany({ where: { orgId } });

    // --- Watchlist
    await tx.watchedAccountMetric.deleteMany({
      where: { watchedAccount: { organizationId: orgId } },
    });
    await tx.watchedAccount.deleteMany({ where: org });

    // --- Notifications
    await tx.notificationRead.deleteMany({
      where: { notification: { organizationId: orgId } },
    });
    await tx.notificationDigestQueue.deleteMany({ where: org });
    await tx.notifications.deleteMany({ where: org });

    // --- Campaigns / Designs (Post.campaignId / Design.campaignId already gone)
    await tx.campaignItem.deleteMany({ where: org });
    await tx.design.deleteMany({ where: org });
    await tx.designTemplate.deleteMany({ where: org });
    await tx.campaign.deleteMany({ where: org });

    // --- Tags (after TagsPosts)
    await tx.tags.deleteMany({ where: { orgId } });

    // --- Misc org-scoped content
    await tx.signatures.deleteMany({ where: org });
    await tx.webhooks.deleteMany({ where: org });
    await tx.autoPost.deleteMany({ where: org });
    await tx.sets.deleteMany({ where: org });
    await tx.usedCodes.deleteMany({ where: { orgId } });
    await tx.credits.deleteMany({ where: org });

    // --- AI Designer sessions (messages cascade from the session)
    await tx.aiDesignerSession.deleteMany({ where: org });

    // --- AI configuration & ledgers
    await tx.aISpendLog.deleteMany({ where: org });
    await tx.aIMediaJob.deleteMany({ where: org });
    await tx.aIBrandProfile.deleteMany({ where: org });
    await tx.aIPromptTemplate.deleteMany({ where: org });
    await tx.aIPromptLibraryItem.deleteMany({ where: org });
    await tx.aIContentIndex.deleteMany({ where: org });
    await tx.aIOrgProviderConfig.deleteMany({ where: org });

    // --- Provider / storage / media configs
    await tx.orgShortLinkConfig.deleteMany({ where: org });
    await tx.orgVpnConfig.deleteMany({ where: org });
    await tx.contentPackConfig.deleteMany({ where: org });
    await tx.mediaProviderConfig.deleteMany({ where: org });
    await tx.orgProviderConfiguration.deleteMany({ where: org });
    await tx.multipartUpload.deleteMany({ where: org });

    // --- OAuth apps the org issued
    await tx.oAuthAuthorization.deleteMany({ where: org });
    await tx.oAuthApp.deleteMany({ where: org });

    // --- Files (after every file/folder reference above is gone)
    await tx.file.deleteMany({ where: org });
    await tx.fileFolder.deleteMany({ where: org });
    await tx.storageProviderConfig.deleteMany({ where: org });

    // --- Audit + email logs
    await tx.emailLog.deleteMany({ where: org });
    await tx.auditLog.deleteMany({ where: org });

    // --- API keys
    await tx.apiKey.deleteMany({ where: org });

    // --- RBAC roles (after AppRolePermission + UserOrganization.roleId)
    await tx.appRolePermission.deleteMany({
      where: { role: { organizationId: orgId } },
    });
    await tx.userOrganization.deleteMany({ where: org });
    await tx.appRole.deleteMany({ where: org });

    // --- Subscription
    await tx.subscription.deleteMany({ where: org });
  }
}
