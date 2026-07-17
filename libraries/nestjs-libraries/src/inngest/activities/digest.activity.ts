import { Injectable } from '@nestjs/common';
import { NotificationDigestService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification-digest.service';
import { NotificationPreferenceService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification-preference.service';
import { EmailService } from '@gitroom/nestjs-libraries/services/email.service';
import { DigestFrequency } from '@gitroom/nestjs-libraries/dtos/notifications/notification-preference.dto';

export type DigestTarget = {
  userId: string;
  email: string;
  organizationId: string;
  frequency: Extract<DigestFrequency, 'daily' | 'weekly'>;
};

@Injectable()
export class DigestActivity {
  constructor(
    private _digestService: NotificationDigestService,
    private _preferenceService: NotificationPreferenceService,
    private _emailService: EmailService,
  ) {}

  async getPendingDigestTargets(
    frequency: Extract<DigestFrequency, 'daily' | 'weekly'>
  ): Promise<Omit<DigestTarget, 'frequency'>[]> {
    const rows = await this._preferenceService.getPreferencesByDigestFrequency(frequency);
    const targets: Omit<DigestTarget, 'frequency'>[] = [];

    for (const row of rows) {
      const organizationIds = await this._digestService.getOrganizationIdsForUser(row.userId);
      for (const organizationId of organizationIds) {
        targets.push({ userId: row.userId, email: row.user.email, organizationId });
      }
    }

    return targets;
  }

  async sendOneDigest(target: DigestTarget): Promise<{ sent: boolean }> {
    const { userId, email, organizationId, frequency } = target;

    const pending = await this._digestService.getPendingForUser(userId, organizationId);
    if (pending.length === 0) {
      return { sent: false };
    }

    const body = pending
      .map((item) => item.html || `<p><strong>${item.title}</strong><br/>${item.message}</p>`)
      .join('');

    await this._emailService.sendEmail(
      email,
      `[Postmill] ${frequency === 'daily' ? 'Daily' : 'Weekly'} digest`,
      body,
      'top'
    );

    await this._digestService.deleteByIds(pending.map((p) => p.id));
    return { sent: true };
  }

  async sendPendingDigests(frequency: Extract<DigestFrequency, 'daily' | 'weekly'>): Promise<{
    sent: number;
    failed: number;
  }> {
    const targets = await this.getPendingDigestTargets(frequency);

    let sent = 0;
    let failed = 0;

    for (const target of targets) {
      try {
        const result = await this.sendOneDigest({ ...target, frequency });
        if (result.sent) {
          sent++;
        }
      } catch (err) {
        failed++;
      }
    }

    return { sent, failed };
  }
}
