import { Injectable, Logger } from '@nestjs/common';
import { NotificationsRepository } from '@gitroom/nestjs-libraries/database/prisma/notifications/notifications.repository';
import { EmailService } from '@gitroom/nestjs-libraries/services/email.service';
// layering: sanctioned leaf-read — OrganizationService depends on NotificationService
// (sendEmail/hasEmailProvider/createOrgAndUser), so routing getTeam through the service
// layer would create a NestJS dependency-injection cycle. Reading the repository directly
// here is a deliberate, behaviour-neutral leaf lookup.
import { OrganizationRepository } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';
import { NotificationPreferenceService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification-preference.service';
import { PushNotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/push-notification.service';
import { NotificationDigestService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification-digest.service';
import {
  BroadcastNotificationDto,
  ChannelToggles,
  DigestFrequency,
  NotificationCategory,
} from '@gitroom/nestjs-libraries/dtos/notifications/notification-preference.dto';

export interface NotifyOptions {
  orgId: string;
  category: NotificationCategory;
  title: string;
  message: string;
  link?: string;
  metadata?: Record<string, any>;
  channels?: Partial<ChannelToggles>;
  digest?: boolean;
  override?: boolean;
  targetUserIds?: string[];
  html?: string;
}

@Injectable()
export class NotificationService {
  constructor(
    private _notificationRepository: NotificationsRepository,
    private _emailService: EmailService,
    private _organizationRepository: OrganizationRepository,
    private _preferenceService: NotificationPreferenceService,
    private _pushService: PushNotificationService,
    private _digestService: NotificationDigestService
  ) {}

  getMainPageCount(organizationId: string, userId: string) {
    return this._notificationRepository.getUnreadCount(organizationId, userId);
  }

  getNotificationsPaginated(organizationId: string, userId: string, page: number) {
    return this._notificationRepository.getNotificationsPaginated(
      organizationId,
      userId,
      page
    );
  }

  getNotificationsPaginatedForOrg(organizationId: string, page: number) {
    return this._notificationRepository.getNotificationsPaginated(
      organizationId,
      '',
      page
    );
  }

  getNotifications(organizationId: string, userId: string) {
    return this._notificationRepository.getNotifications(organizationId, userId);
  }

  async markAsRead(
    notificationId: string,
    userId: string,
    organizationId: string
  ) {
    return this._notificationRepository.markAsRead(
      notificationId,
      userId,
      organizationId
    );
  }

  async markAllAsRead(organizationId: string, userId: string) {
    return this._notificationRepository.markAllAsRead(organizationId, userId);
  }

  async deleteNotification(id: string, organizationId: string) {
    return this._notificationRepository.deleteNotification(id, organizationId);
  }

  private _defaultChannels(): ChannelToggles {
    return { email: true, push: true, inApp: true };
  }

  private _channelEnabled(
    prefs: { masters: ChannelToggles; categories: Record<NotificationCategory, ChannelToggles> },
    category: NotificationCategory,
    channel: keyof ChannelToggles,
    override: boolean
  ): boolean {
    if (override) return true;
    const categoryToggles = prefs.categories[category];
    // Unknown/legacy category (e.g. a stale string from before a rename) — gate on the master only.
    if (!categoryToggles) return prefs.masters[channel];
    return prefs.masters[channel] && categoryToggles[channel];
  }

  async notify(options: NotifyOptions): Promise<void> {
    const {
      orgId,
      category,
      title,
      message,
      link,
      metadata,
      channels: requestedChannels,
      digest = false,
      override = false,
      targetUserIds,
      html,
    } = options;

    const allowedUserIds = targetUserIds ? new Set(targetUserIds) : null;

    const channels = { ...this._defaultChannels(), ...requestedChannels };

    const team = await this._organizationRepository.getTeam(orgId);
    const members = team?.users ?? [];

    // NOTIF-06: skip inactive users and disabled org memberships.
    const activeMembers = members.filter(
      (m) => !m.disabled && m.user.activated !== false
    );

    // NOTIF-10: batch preference defaults lookup for all active members.
    const activeUserIds = activeMembers.map((m) => m.user.id);
    const prefsMap = await this._preferenceService.ensureDefaultsForUsers(
      activeUserIds
    );

    const emailRecipients: { userId: string; email: string }[] = [];
    const pushUserIds: string[] = [];
    const inAppUserIds: string[] = [];

    for (const member of activeMembers) {
      const user = member.user;
      if (allowedUserIds && !allowedUserIds.has(user.id)) continue;
      const prefs = prefsMap[user.id];

      if (channels.email && this._channelEnabled(prefs, category, 'email', override)) {
        emailRecipients.push({ userId: user.id, email: user.email });
      }

      if (channels.push && this._channelEnabled(prefs, category, 'push', override)) {
        pushUserIds.push(user.id);
      }

      if (channels.inApp && this._channelEnabled(prefs, category, 'inApp', override)) {
        inAppUserIds.push(user.id);
      }
    }

    // NOTIF-12: only create the shared in-app notification row if recipients exist.
    let notification: { id: string } | undefined;
    if (inAppUserIds.length > 0) {
      notification = await this._notificationRepository.createNotification({
        organizationId: orgId,
        type: category,
        title,
        content: message,
        link,
        metadata,
      });
    }

    // Email channel: respect per-user digest frequency for digest-eligible items.
    if (emailRecipients.length > 0) {
      if (digest) {
        await this._routeDigestEmails(orgId, category, title, message, emailRecipients, html);
      } else {
        for (const recipient of emailRecipients) {
          await this.sendEmail(recipient.email, title, message);
        }
      }
    }

    // Push channel.
    if (pushUserIds.length > 0) {
      for (const userId of pushUserIds) {
        await this._pushService.sendPushNotification(userId, {
          title,
          body: message,
          data: metadata ? this._stringifyData(metadata) : undefined,
        });
      }
    }
  }

  /**
   * Broadcast an announcement to the org, applying optional per-user and per-role filters.
   * A-06: the target filtering lives here so callers (e.g. AdminNotificationsController)
   * only need to pass the DTO.
   */
  async broadcast(
    orgId: string,
    body: BroadcastNotificationDto
  ): Promise<{ success: boolean; sentTo: number }> {
    const team = await this._organizationRepository.getTeam(orgId);
    const members = team?.users ?? [];

    const allMemberIds = new Set(members.map((m) => m.user.id));
    let targetUserIds = allMemberIds;

    if (body.targetUserIds && body.targetUserIds.length > 0) {
      targetUserIds = new Set(
        Array.from(targetUserIds).filter((id) => body.targetUserIds!.includes(id))
      );
    }

    if (body.targetRoles && body.targetRoles.length > 0) {
      const roleKeys = new Set(body.targetRoles);
      targetUserIds = new Set(
        members
          .filter(
            (m) =>
              targetUserIds.has(m.user.id) && m.roleRef && roleKeys.has(m.roleRef.key)
          )
          .map((m) => m.user.id)
      );
    }

    await this.notify({
      orgId,
      category: 'announcements',
      title: body.title,
      message: body.message,
      channels: body.channels ?? { email: true, push: false, inApp: true },
      override: true,
      targetUserIds: Array.from(targetUserIds),
    });

    return { success: true, sentTo: targetUserIds.size };
  }

  private async _routeDigestEmails(
    orgId: string,
    category: NotificationCategory,
    title: string,
    message: string,
    recipients: { userId: string; email: string }[],
    html?: string
  ): Promise<void> {
    const frequencies = await this._preferenceService.getDigestFrequencies(
      recipients.map((r) => r.userId)
    );

    const instantRecipients: string[] = [];
    const queuedRecipients: string[] = [];

    for (const recipient of recipients) {
      const frequency = frequencies[recipient.userId] ?? 'instant';
      if (frequency === 'never') continue;
      if (frequency === 'instant') {
        instantRecipients.push(recipient.email);
      } else {
        queuedRecipients.push(recipient.userId);
      }
    }

    for (const to of instantRecipients) {
      await this.sendEmail(to, title, message);
    }

    if (queuedRecipients.length > 0) {
      await this._digestService.enqueueMany(queuedRecipients, orgId, {
        title,
        message,
        html,
        category,
      });
    }
  }

  private _stringifyData(data: Record<string, any>): Record<string, string> {
    return Object.entries(data).reduce((acc, [key, value]) => {
      acc[key] = typeof value === 'string' ? value : JSON.stringify(value);
      return acc;
    }, {} as Record<string, string>);
  }

  async sendEmail(to: string, subject: string, html: string, replyTo?: string) {
    await this._emailService.sendEmail(to, subject, html, 'top', replyTo);
  }

  // Convenience senders.
  async notifyPostPublishFailure(
    orgId: string,
    integrationName: string,
    postId: string,
    subStep?: string,
    errMessage?: string
  ) {
    const subject = subStep
      ? `Post published with ${subStep} failure`
      : 'Post publish failure';
    const baseMessage = subStep
      ? `Your post on ${integrationName} was published, but the "${subStep}" step failed.`
      : `Your post on ${integrationName} could not be published.`;
    const detail = errMessage ? ` ${errMessage}` : ' Please review the error details.';
    await this.notify({
      orgId,
      category: 'post_failed',
      title: subject,
      message: `${baseMessage}${detail}`,
      metadata: { postId, integrationName, subStep, errMessage },
      channels: { email: true, push: true, inApp: true },
    });
  }

  async notifyPostPublished(
    orgId: string,
    integrationName: string,
    releaseURL: string,
    postId: string
  ) {
    const title = `Your post has been published on ${integrationName}`;
    const message = `Your post has been published on ${integrationName} at ${releaseURL}`;
    await this.notify({
      orgId,
      category: 'post_published',
      title,
      message,
      link: releaseURL,
      metadata: { postId, integrationName, releaseURL },
      channels: { email: true, push: false, inApp: true },
      digest: true,
    });
  }

  async notifyChannelError(
    orgId: string,
    integrationName: string,
    providerIdentifier: string,
    reason: 'refresh' | 'disabled',
    postId?: string
  ) {
    const title = `We couldn't post to ${providerIdentifier} for ${integrationName}`;
    const message =
      reason === 'refresh'
        ? `We couldn't post to ${providerIdentifier} for ${integrationName} because you need to reconnect it. Please enable it and try again.`
        : `We couldn't post to ${providerIdentifier} for ${integrationName} because it's disabled. Please enable it and try again.`;
    await this.notify({
      orgId,
      category: 'channels',
      title,
      message,
      metadata: { integrationName, providerIdentifier, reason, postId },
      channels: { email: true, push: true, inApp: true },
    });
  }

  async notifyFirstCommentUnsupported(
    orgId: string,
    integrationName: string,
    postId: string
  ) {
    const title = `First comment is not supported on ${integrationName}`;
    const message = `The post was published successfully, but ${integrationName} does not support first comments. Please add the comment manually if the platform allows it.`;
    await this.notify({
      orgId,
      category: 'post_published',
      title,
      message,
      metadata: { integrationName, postId },
      channels: { email: true, push: false, inApp: true },
    });
  }

  async notifyFirstCommentFailed(
    orgId: string,
    integrationName: string,
    postId: string
  ) {
    const title = `First comment could not be posted on ${integrationName}`;
    const message = `The post was published successfully, but the first comment could not be posted on ${integrationName}. Please add the comment manually.`;
    await this.notify({
      orgId,
      category: 'post_published',
      title,
      message,
      metadata: { integrationName, postId },
      channels: { email: true, push: false, inApp: true },
    });
  }

  async notifyBudgetThreshold(orgId: string, scope: string, usagePct: number) {
    const title = `AI budget alert: ${usagePct.toFixed(0)}% used`;
    const message = `Your AI budget for "${scope}" has reached ${usagePct.toFixed(0)}% of the cap. Review your usage in AI settings.`;
    await this.notify({
      orgId,
      category: 'budget',
      title,
      message,
      metadata: { scope, usagePct },
      channels: { email: true, push: false, inApp: true },
    });
  }

  async notifyAnalyticsAnomaly(params: {
    orgId: string;
    integrationName: string;
    metric: string;
    // R4.5: the canonical metric KEY (e.g. `unique_impressions`) for the deep
    // link — distinct from `metric`, which is the human display label.
    metricKey: string;
    direction: 'spike' | 'drop';
    value: number;
    baseline: number;
    deviation: number;
    integrationId: string;
    topPostTitle?: string;
  }) {
    const {
      orgId,
      integrationName,
      metric,
      metricKey,
      direction,
      value,
      baseline,
      deviation,
      integrationId,
      topPostTitle,
    } = params;

    const verb = direction === 'spike' ? 'Spike' : 'Drop';
    const title = `${verb} in ${integrationName} ${metric}`;

    let message = `${metric} ${
      direction === 'spike' ? 'jumped to' : 'fell to'
    } ${value.toLocaleString()} vs a 28-day average of ${baseline.toLocaleString()}.`;
    if (topPostTitle) {
      message += ` — likely driven by "${topPostTitle}"`;
    }

    const link = `/analytics?tab=insights&integrations=${integrationId}&metric=${encodeURIComponent(
      metricKey
    )}`;

    await this.notify({
      orgId,
      category: 'analytics',
      title,
      message,
      link,
      metadata: { integrationId, metric, direction, deviation },
      digest: true,
      channels: { email: true, push: false, inApp: true },
    });
  }

  // 6.9: weekly "your week in numbers" summary. Category `analytics` (shares the
  // anomaly toggle), digest: false — this IS the weekly digest, so it should not
  // be re-batched. Deep-links to /analytics. Modeled on notifyAnalyticsAnomaly.
  async notifyWeeklyAnalyticsSummary(params: {
    orgId: string;
    metrics: { label: string; thisWeek: number; changePct: number | null }[];
    topPostTitle?: string;
    bestChannelName?: string;
    anomalyRecap?: string;
  }) {
    const { orgId, metrics, topPostTitle, bestChannelName, anomalyRecap } =
      params;

    const title = 'Your week in numbers';

    const metricParts = metrics.map((m) => {
      const change =
        m.changePct === null
          ? ''
          : ` (${m.changePct >= 0 ? '+' : ''}${m.changePct}%)`;
      return `${m.label} ${m.thisWeek.toLocaleString()}${change}`;
    });

    let message = metricParts.length
      ? `Here's your week in numbers — ${metricParts.join(', ')}.`
      : `Here's your week in numbers.`;
    if (bestChannelName) message += ` Best channel: ${bestChannelName}.`;
    if (topPostTitle) message += ` Top post: "${topPostTitle}".`;
    if (anomalyRecap) message += ` ${anomalyRecap}.`;

    await this.notify({
      orgId,
      category: 'analytics',
      title,
      message,
      link: '/analytics',
      metadata: {
        metrics: metrics.map((m) => ({
          label: m.label,
          value: m.thisWeek,
          changePct: m.changePct,
        })),
        bestChannel: bestChannelName,
        topPost: topPostTitle,
      },
      digest: false,
      channels: { email: true, push: false, inApp: true },
    });
  }

  async notifyCommentDigest(
    orgId: string,
    totalNewComments: number,
    posts: { id: string; content?: string | null; integration?: { name?: string | null } | null; socialComments: any[] }[]
  ) {
    if (totalNewComments <= 5) return;

    const htmlParts: string[] = [];
    for (const post of posts) {
      const platform = this._escapeHtml(post.integration?.name ?? 'Unknown');
      const postTitle = this._escapeHtml(
        post.content
          ? post.content.substring(0, 120)
          : `Post #${post.id}`
      );
      htmlParts.push(
        `<div style="margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #e5e7eb;">
          <strong style="color:#1f2937;">${platform}</strong>
          <p style="margin:4px 0;color:#374151;">${postTitle}</p>
          <span style="font-size:13px;color:#6b7280;">${post.socialComments.length} new comment${post.socialComments.length === 1 ? '' : 's'}</span>
        </div>`
      );
    }

    const html = `
      <p style="color:#374151;margin-bottom:16px;">
        You have <strong>${totalNewComments}</strong> new comment${totalNewComments === 1 ? '' : 's'} across <strong>${posts.length}</strong> post${posts.length === 1 ? '' : 's'} in the last 6 hours.
      </p>
      ${htmlParts.join('')}
      <p style="margin-top:16px;font-size:13px;color:#6b7280;">
        <a href="${process.env.FRONTEND_URL || ''}/posts" style="color:#6366f1;">View all posts</a>
      </p>`;

    await this.notify({
      orgId,
      category: 'comments',
      title: 'Comment inbox backlog',
      message: `You have ${totalNewComments} unhandled comments in your inbox. Responding quickly improves engagement.`,
      metadata: { backlogCount: totalNewComments, posts: posts.map((p) => p.id) },
      channels: { email: true, push: false, inApp: true },
      digest: true,
      html,
    });
  }

  async notifyStreakReminder(orgId: string) {
    const title = 'Keep your streak alive!';
    const message =
      'You have 2 hours left to keep your posting streak alive. Schedule or publish a post to keep it going.';
    await this.notify({
      orgId,
      category: 'streak',
      title,
      message,
      channels: { email: true, push: false, inApp: true },
    });
  }

  hasEmailProvider() {
    return this._emailService.hasProvider();
  }

  hasPushProvider() {
    return this._pushService.hasProvider();
  }

  // NOTIF-01: escape user-controlled strings before interpolating into email HTML.
  private _escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
