import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DigestActivity } from './digest.activity';
import { NotificationDigestService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification-digest.service';
import { NotificationPreferenceService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification-preference.service';
import { EmailService } from '@gitroom/nestjs-libraries/services/email.service';

describe('DigestActivity', () => {
  let activity: DigestActivity;
  let digestService: NotificationDigestService;
  let preferenceService: NotificationPreferenceService;
  let emailService: EmailService;

  beforeEach(() => {
    digestService = {
      getPendingForUser: vi.fn(),
      getOrganizationIdsForUser: vi.fn(),
      deleteByIds: vi.fn().mockResolvedValue(undefined),
    } as unknown as NotificationDigestService;

    preferenceService = {
      getPreferencesByDigestFrequency: vi.fn(),
    } as unknown as NotificationPreferenceService;

    emailService = {
      sendEmail: vi.fn().mockResolvedValue(undefined),
    } as unknown as EmailService;

    activity = new DigestActivity(digestService, preferenceService, emailService);
  });

  it('sends pending digests to users with the matching frequency', async () => {
    vi.mocked(preferenceService.getPreferencesByDigestFrequency).mockResolvedValue([
      { userId: 'user-1', user: { email: 'a@b.com' } },
      { userId: 'user-2', user: { email: 'c@d.com' } },
    ]);

    vi.mocked(digestService.getOrganizationIdsForUser).mockImplementation(async (userId: string) => {
      return userId === 'user-1' ? ['org-1'] : [];
    });

    vi.mocked(digestService.getPendingForUser).mockImplementation(async (userId: string, organizationId: string) => {
      if (userId === 'user-1' && organizationId === 'org-1') {
        return [
          { id: 'q-1', title: 'T1', message: 'M1', html: null, category: 'comments', createdAt: new Date() },
        ] as any;
      }
      return [];
    });

    const result = await activity.sendPendingDigests('daily');

    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(digestService.getPendingForUser).toHaveBeenCalledWith('user-1', 'org-1');
    expect(emailService.sendEmail).toHaveBeenCalledWith(
      'a@b.com',
      '[Postmill] Daily digest',
      '<p><strong>T1</strong><br/>M1</p>',
      'top'
    );
    expect(digestService.deleteByIds).toHaveBeenCalledWith(['q-1']);
  });

  it('uses html when present', async () => {
    vi.mocked(preferenceService.getPreferencesByDigestFrequency).mockResolvedValue([
      { userId: 'user-1', user: { email: 'a@b.com' } },
    ]);
    vi.mocked(digestService.getOrganizationIdsForUser).mockResolvedValue(['org-1']);
    vi.mocked(digestService.getPendingForUser).mockResolvedValue([
      { id: 'q-1', title: 'T1', message: 'M1', html: '<h1>Rich</h1>', category: 'comments', createdAt: new Date() },
    ] as any);

    await activity.sendPendingDigests('weekly');

    expect(digestService.getPendingForUser).toHaveBeenCalledWith('user-1', 'org-1');
    expect(emailService.sendEmail).toHaveBeenCalledWith(
      'a@b.com',
      '[Postmill] Weekly digest',
      '<h1>Rich</h1>',
      'top'
    );
  });

  it('counts failures without stopping', async () => {
    vi.mocked(preferenceService.getPreferencesByDigestFrequency).mockResolvedValue([
      { userId: 'user-1', user: { email: 'a@b.com' } },
    ]);
    vi.mocked(digestService.getOrganizationIdsForUser).mockResolvedValue(['org-1']);
    vi.mocked(digestService.getPendingForUser).mockRejectedValue(new Error('db down'));

    const result = await activity.sendPendingDigests('daily');

    expect(result).toEqual({ sent: 0, failed: 1 });
    expect(emailService.sendEmail).not.toHaveBeenCalled();
  });

  describe('fan-out helpers (I-01)', () => {
    it('getPendingDigestTargets flattens users by organization', async () => {
      vi.mocked(preferenceService.getPreferencesByDigestFrequency).mockResolvedValue([
        { userId: 'user-1', user: { email: 'a@b.com' } },
        { userId: 'user-2', user: { email: 'c@d.com' } },
      ]);
      vi.mocked(digestService.getOrganizationIdsForUser).mockImplementation(async (userId: string) => {
        return userId === 'user-1' ? ['org-1', 'org-2'] : [];
      });

      const targets = await activity.getPendingDigestTargets('daily');

      expect(targets).toEqual([
        { userId: 'user-1', email: 'a@b.com', organizationId: 'org-1' },
        { userId: 'user-1', email: 'a@b.com', organizationId: 'org-2' },
      ]);
    });

    it('sendOneDigest sends and deletes when pending items exist', async () => {
      vi.mocked(digestService.getPendingForUser).mockResolvedValue([
        { id: 'q-2', title: 'T2', message: 'M2', html: null, category: 'comments', createdAt: new Date() },
      ] as any);

      const result = await activity.sendOneDigest({
        userId: 'user-1',
        email: 'a@b.com',
        organizationId: 'org-1',
        frequency: 'daily',
      });

      expect(result).toEqual({ sent: true });
      expect(emailService.sendEmail).toHaveBeenCalledWith(
        'a@b.com',
        '[Postmill] Daily digest',
        '<p><strong>T2</strong><br/>M2</p>',
        'top'
      );
      expect(digestService.deleteByIds).toHaveBeenCalledWith(['q-2']);
    });

    it('sendOneDigest returns sent:false when no pending items exist', async () => {
      vi.mocked(digestService.getPendingForUser).mockResolvedValue([]);

      const result = await activity.sendOneDigest({
        userId: 'user-1',
        email: 'a@b.com',
        organizationId: 'org-1',
        frequency: 'daily',
      });

      expect(result).toEqual({ sent: false });
      expect(emailService.sendEmail).not.toHaveBeenCalled();
    });
  });
});
