import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreateNotification = vi.fn().mockResolvedValue({ id: 'notif-1' });
const mockCreateReadRecords = vi.fn().mockResolvedValue(undefined);
const mockGetTeam = vi.fn().mockResolvedValue({ users: [] });
const defaultPreferenceData = {
  masters: { email: true, push: true, inApp: true },
  categories: {
    announcements: { email: true, push: true, inApp: true },
  },
};
const mockEnsureDefaults = vi.fn().mockResolvedValue(defaultPreferenceData);
const mockEnsureDefaultsForUsers = vi.fn().mockImplementation((ids: string[]) =>
  Object.fromEntries(ids.map((id) => [id, defaultPreferenceData]))
);
const mockGetDigestFrequencies = vi.fn().mockResolvedValue({});
const mockEnqueueMany = vi.fn().mockResolvedValue(undefined);

vi.mock(
  '@gitroom/nestjs-libraries/database/prisma/notifications/notifications.repository',
  () => ({
    NotificationsRepository: class {
      createNotification = mockCreateNotification;
      createReadRecords = mockCreateReadRecords;
      getMainPageCount = vi.fn();
      getNotificationsPaginated = vi.fn();
      getNotifications = vi.fn();
    },
  })
);

vi.mock('@gitroom/nestjs-libraries/services/email.service', () => ({
  EmailService: class {
    sendEmail = vi.fn().mockResolvedValue(undefined);
    hasProvider = vi.fn().mockReturnValue(true);
  },
}));

vi.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository',
  () => ({
    OrganizationRepository: class {
      getTeam = mockGetTeam;
    },
  })
);

vi.mock(
  '@gitroom/nestjs-libraries/database/prisma/notifications/notification-preference.service',
  () => ({
    NotificationPreferenceService: class {
      ensureDefaults = mockEnsureDefaults;
      ensureDefaultsForUsers = mockEnsureDefaultsForUsers;
      getPreferences = vi.fn();
      updatePreferences = vi.fn();
      getDigestFrequencies = mockGetDigestFrequencies;
    },
  })
);

vi.mock(
  '@gitroom/nestjs-libraries/database/prisma/notifications/push-notification.service',
  () => ({
    PushNotificationService: class {
      sendPushNotification = vi.fn().mockResolvedValue(undefined);
      hasProvider = vi.fn().mockReturnValue(false);
    },
  })
);

vi.mock(
  '@gitroom/nestjs-libraries/database/prisma/notifications/notification-digest.service',
  () => ({
    NotificationDigestService: class {
      enqueueMany = mockEnqueueMany;
    },
  })
);

import { NotificationService } from './notification.service';
import { NotificationsRepository } from '@gitroom/nestjs-libraries/database/prisma/notifications/notifications.repository';
import { EmailService } from '@gitroom/nestjs-libraries/services/email.service';
import { OrganizationRepository } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';
import { NotificationPreferenceService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification-preference.service';
import { PushNotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/push-notification.service';
import { NotificationDigestService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification-digest.service';

describe('NotificationService', () => {
  let service: NotificationService;
  let emailService: EmailService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureDefaults.mockResolvedValue(defaultPreferenceData);
    mockEnsureDefaultsForUsers.mockImplementation((ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, defaultPreferenceData]))
    );

    emailService = new EmailService();
    service = new NotificationService(
      new NotificationsRepository(),
      emailService,
      new OrganizationRepository(),
      new NotificationPreferenceService(),
      new PushNotificationService(),
      new NotificationDigestService()
    );
  });

  it('creates a notification row for enabled members', async () => {
    mockGetTeam.mockResolvedValue({
      users: [{ user: { id: 'user-1', email: 'a@b.com' } }],
    });

    await service.notify({
      orgId: 'org-1',
      category: 'announcements',
      title: 'Subject',
      message: 'Message',
    });

    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        type: 'announcements',
        title: 'Subject',
        content: 'Message',
      })
    );
  });

  it('sends digest emails immediately when frequency is instant', async () => {
    mockGetTeam.mockResolvedValue({
      users: [{ user: { id: 'user-1', email: 'a@b.com' } }],
    });
    mockGetDigestFrequencies.mockResolvedValue({ 'user-1': 'instant' });

    await service.notify({
      orgId: 'org-1',
      category: 'announcements',
      title: 'Subject',
      message: 'Message',
      digest: true,
    });

    expect(emailService.sendEmail).toHaveBeenCalledWith(
      'a@b.com',
      'Subject',
      'Message',
      'top',
      undefined
    );
    expect(mockEnqueueMany).not.toHaveBeenCalled();
  });

  it('enqueues digest emails when frequency is daily', async () => {
    mockGetTeam.mockResolvedValue({
      users: [{ user: { id: 'user-1', email: 'a@b.com' } }],
    });
    mockGetDigestFrequencies.mockResolvedValue({ 'user-1': 'daily' });

    await service.notify({
      orgId: 'org-1',
      category: 'announcements',
      title: 'Subject',
      message: 'Message',
      digest: true,
    });

    expect(emailService.sendEmail).not.toHaveBeenCalled();
    expect(mockEnqueueMany).toHaveBeenCalledWith(
      ['user-1'],
      'org-1',
      expect.objectContaining({
        title: 'Subject',
        message: 'Message',
        category: 'announcements',
      })
    );
  });

  it('skips digest emails when frequency is never', async () => {
    mockGetTeam.mockResolvedValue({
      users: [{ user: { id: 'user-1', email: 'a@b.com' } }],
    });
    mockGetDigestFrequencies.mockResolvedValue({ 'user-1': 'never' });

    await service.notify({
      orgId: 'org-1',
      category: 'announcements',
      title: 'Subject',
      message: 'Message',
      digest: true,
    });

    expect(emailService.sendEmail).not.toHaveBeenCalled();
    expect(mockEnqueueMany).not.toHaveBeenCalled();
  });

  it('does not email a member whose category preference is off', async () => {
    mockGetTeam.mockResolvedValue({
      users: [{ user: { id: 'user-1', email: 'a@b.com' } }],
    });
    mockEnsureDefaultsForUsers.mockResolvedValue({
      'user-1': {
        masters: { email: true, push: true, inApp: true },
        categories: {
          announcements: { email: false, push: true, inApp: true },
        },
      },
    });

    await service.notify({
      orgId: 'org-1',
      category: 'announcements',
      title: 'Subject',
      message: 'Message',
    });

    expect(emailService.sendEmail).not.toHaveBeenCalled();
  });

  it('notifyAnalyticsAnomaly fires an analytics-category, digest notification with a deep link', async () => {
    const notifySpy = vi.spyOn(service, 'notify').mockResolvedValue(undefined);

    await service.notifyAnalyticsAnomaly({
      orgId: 'org-1',
      integrationName: 'Instagram',
      // R4.5: human display label vs canonical key — the link must use the key.
      metric: 'Unique Impressions',
      metricKey: 'unique_impressions',
      direction: 'spike',
      value: 5000,
      baseline: 1200,
      deviation: 3.2,
      integrationId: 'int-1',
      topPostTitle: 'Best post ever',
    });

    expect(notifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        category: 'analytics',
        digest: true,
        // R4.5: the deep link carries the URI-encoded metric KEY, not the label
        // ("Unique Impressions" would be an invalid, un-matchable query string).
        link: '/analytics?tab=insights&integrations=int-1&metric=unique_impressions',
        channels: { email: true, push: false, inApp: true },
        metadata: {
          integrationId: 'int-1',
          metric: 'Unique Impressions',
          direction: 'spike',
          deviation: 3.2,
        },
      })
    );

    const payload = notifySpy.mock.calls[0][0];
    expect(payload.title).toContain('Spike');
    expect(payload.title).toContain('Unique Impressions');
    expect(payload.message).toContain('Best post ever');
  });

  it('notifyWeeklyAnalyticsSummary fires an analytics-category, non-digest notification deep-linking to /analytics', async () => {
    const notifySpy = vi.spyOn(service, 'notify').mockResolvedValue(undefined);

    await service.notifyWeeklyAnalyticsSummary({
      orgId: 'org-1',
      metrics: [
        { label: 'Impressions', thisWeek: 1234, changePct: 12 },
        { label: 'Likes', thisWeek: 456, changePct: -3 },
      ],
      topPostTitle: 'Best post ever',
      bestChannelName: 'Instagram',
      anomalyRecap: '1 analytics alert flagged this week',
    });

    expect(notifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        category: 'analytics',
        digest: false,
        link: '/analytics',
        channels: { email: true, push: false, inApp: true },
      })
    );

    const payload = notifySpy.mock.calls[0][0];
    expect(payload.title).toBe('Your week in numbers');
    expect(payload.message).toContain('Impressions 1,234 (+12%)');
    expect(payload.message).toContain('Likes 456 (-3%)');
    expect(payload.message).toContain('Best channel: Instagram');
    expect(payload.message).toContain('Top post: "Best post ever"');
    expect(payload.message).toContain('1 analytics alert flagged this week');
  });

  it('NOTIF-01: escapes user strings in comment digest email HTML', async () => {
    const notifySpy = vi.spyOn(service, 'notify').mockResolvedValue(undefined);

    await service.notifyCommentDigest('org-1', 10, [
      {
        id: 'post-1',
        content: '<script>alert(1)</script>',
        integration: { name: '<b>Evil Platform</b>' },
        socialComments: [{ id: 'c1' }],
      },
    ]);

    expect(notifySpy).toHaveBeenCalled();
    const html = notifySpy.mock.calls[0][0].html as string;
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;b&gt;Evil Platform&lt;/b&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('NOTIF-06: skips inactive users and disabled org memberships', async () => {
    mockGetTeam.mockResolvedValue({
      users: [
        { user: { id: 'active-user', email: 'active@b.com' } },
        { disabled: true, user: { id: 'disabled-member', email: 'disabled@b.com' } },
        { user: { id: 'inactive-user', email: 'inactive@b.com', activated: false } },
      ],
    });

    await service.notify({
      orgId: 'org-1',
      category: 'announcements',
      title: 'Subject',
      message: 'Message',
    });

    expect(mockEnsureDefaultsForUsers).toHaveBeenCalledWith(['active-user']);
    expect(emailService.sendEmail).toHaveBeenCalledWith(
      'active@b.com',
      'Subject',
      'Message',
      'top',
      undefined
    );
    expect(emailService.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('NOTIF-10: batches preference lookup for all active members in one query', async () => {
    const users = Array.from({ length: 20 }, (_, i) => ({
      user: { id: `user-${i}`, email: `user-${i}@b.com` },
    }));
    mockGetTeam.mockResolvedValue({ users });

    await service.notify({
      orgId: 'org-1',
      category: 'announcements',
      title: 'Subject',
      message: 'Message',
    });

    expect(mockEnsureDefaultsForUsers).toHaveBeenCalledTimes(1);
    expect(mockEnsureDefaultsForUsers).toHaveBeenCalledWith(
      users.map((u) => u.user.id)
    );
    expect(mockEnsureDefaults).not.toHaveBeenCalled();
  });

  it('NOTIF-12: skips creating the in-app notification row when inApp is disabled', async () => {
    mockGetTeam.mockResolvedValue({
      users: [{ user: { id: 'user-1', email: 'a@b.com' } }],
    });
    mockEnsureDefaultsForUsers.mockResolvedValue({
      'user-1': {
        masters: { email: true, push: true, inApp: true },
        categories: {
          announcements: { email: true, push: true, inApp: false },
        },
      },
    });

    await service.notify({
      orgId: 'org-1',
      category: 'announcements',
      title: 'Subject',
      message: 'Message',
    });

    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  describe('broadcast', () => {
    it('A-06: sends to all members when no filters are provided', async () => {
      const notifySpy = vi.spyOn(service, 'notify').mockResolvedValue(undefined);
      mockGetTeam.mockResolvedValue({
        users: [
          { user: { id: 'user-1', email: 'a@b.com' }, roleRef: { key: 'admin' } },
          { user: { id: 'user-2', email: 'b@b.com' }, roleRef: { key: 'member' } },
        ],
      });

      const result = await service.broadcast('org-1', {
        title: 'Subject',
        message: 'Message',
      });

      expect(result).toEqual({ success: true, sentTo: 2 });
      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-1',
          category: 'announcements',
          title: 'Subject',
          message: 'Message',
          override: true,
          channels: { email: true, push: false, inApp: true },
          targetUserIds: ['user-1', 'user-2'],
        })
      );
    });

    it('A-06: filters recipients by targetUserIds', async () => {
      const notifySpy = vi.spyOn(service, 'notify').mockResolvedValue(undefined);
      mockGetTeam.mockResolvedValue({
        users: [
          { user: { id: 'user-1', email: 'a@b.com' }, roleRef: { key: 'admin' } },
          { user: { id: 'user-2', email: 'b@b.com' }, roleRef: { key: 'member' } },
        ],
      });

      const result = await service.broadcast('org-1', {
        title: 'Subject',
        message: 'Message',
        targetUserIds: ['user-2'],
      });

      expect(result.sentTo).toBe(1);
      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          targetUserIds: ['user-2'],
        })
      );
    });

    it('A-06: filters recipients by targetRoles', async () => {
      const notifySpy = vi.spyOn(service, 'notify').mockResolvedValue(undefined);
      mockGetTeam.mockResolvedValue({
        users: [
          { user: { id: 'user-1', email: 'a@b.com' }, roleRef: { key: 'admin' } },
          { user: { id: 'user-2', email: 'b@b.com' }, roleRef: { key: 'member' } },
        ],
      });

      const result = await service.broadcast('org-1', {
        title: 'Subject',
        message: 'Message',
        targetRoles: ['member'],
      });

      expect(result.sentTo).toBe(1);
      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          targetUserIds: ['user-2'],
        })
      );
    });

    it('A-06: intersects targetUserIds and targetRoles', async () => {
      const notifySpy = vi.spyOn(service, 'notify').mockResolvedValue(undefined);
      mockGetTeam.mockResolvedValue({
        users: [
          { user: { id: 'user-1', email: 'a@b.com' }, roleRef: { key: 'admin' } },
          { user: { id: 'user-2', email: 'b@b.com' }, roleRef: { key: 'member' } },
          { user: { id: 'user-3', email: 'c@b.com' }, roleRef: { key: 'member' } },
        ],
      });

      const result = await service.broadcast('org-1', {
        title: 'Subject',
        message: 'Message',
        targetUserIds: ['user-1', 'user-2'],
        targetRoles: ['member'],
      });

      expect(result.sentTo).toBe(1);
      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          targetUserIds: ['user-2'],
        })
      );
    });
  });
});
