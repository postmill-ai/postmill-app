import { Injectable } from '@nestjs/common';
import { timer } from '@postmill-ai/helpers/utils/timer';
import { UsersService } from '@postmill-ai/nestjs-libraries/database/prisma/users/users.service';
import { NotificationService } from '@postmill-ai/nestjs-libraries/database/prisma/notifications/notification.service';
import { EmailLogService } from '@postmill-ai/nestjs-libraries/database/prisma/emails/email-log.service';
import { EmailAdapterRegistry } from '@postmill-ai/nestjs-libraries/emails/email-adapter.registry';
import {
  getOpenBetaEndEmail,
  OPEN_BETA_END_CAMPAIGN_ID,
  OPEN_BETA_END_CONFIRMATION,
} from '@postmill-ai/nestjs-libraries/emails/campaigns/open-beta-end-2026';

interface CampaignRecipient {
  userId: string;
  email: string;
}

@Injectable()
export class OwnerEmailCampaignService {
  constructor(
    private _users: UsersService,
    private _notifications: NotificationService,
    private _emailLogs: EmailLogService,
    private _emailRegistry: EmailAdapterRegistry
  ) {}

  async preview() {
    const selection = await this.selectRecipients();
    return {
      campaignId: OPEN_BETA_END_CAMPAIGN_ID,
      language: 'en',
      recipients: selection.recipients.length,
      duplicatesExcluded: selection.duplicatesExcluded,
      syntheticExcluded: selection.syntheticExcluded,
      suppressedExcluded: selection.suppressedExcluded,
      invalidExcluded: selection.invalidExcluded,
    };
  }

  async sendTest(email: string) {
    this.assertLiveProvider();
    const normalized = email.trim().toLowerCase();
    const selection = await this.selectRecipients();
    const recipient = selection.recipients.find((item) => item.email === normalized);
    if (!recipient) {
      throw new Error('Recipient is not an eligible active owner');
    }
    return this.sendRecipient(recipient);
  }

  async sendAll(confirmation: string) {
    if (confirmation !== OPEN_BETA_END_CONFIRMATION) {
      throw new Error('Invalid campaign confirmation');
    }
    this.assertLiveProvider();
    const selection = await this.selectRecipients();
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    let consecutiveFailures = 0;
    let stoppedEarly = false;

    for (const [index, recipient] of selection.recipients.entries()) {
      try {
        const result = await this.sendRecipient(recipient);
        if (result?.status === 'skipped') skipped++;
        else sent++;
        consecutiveFailures = 0;
      } catch {
        failed++;
        consecutiveFailures++;
        if (consecutiveFailures >= 3) {
          stoppedEarly = true;
          break;
        }
      }
      if (index < selection.recipients.length - 1) await timer(600);
    }

    return {
      campaignId: OPEN_BETA_END_CAMPAIGN_ID,
      recipients: selection.recipients.length,
      sent,
      skipped,
      failed,
      stoppedEarly,
    };
  }

  async status() {
    const rows = await this._emailLogs.getCampaignStatus(OPEN_BETA_END_CAMPAIGN_ID);
    return {
      campaignId: OPEN_BETA_END_CAMPAIGN_ID,
      statuses: rows.map((row) => ({ status: row.status, count: row._count._all })),
    };
  }

  private async selectRecipients(): Promise<{
    recipients: CampaignRecipient[];
    duplicatesExcluded: number;
    syntheticExcluded: number;
    suppressedExcluded: number;
    invalidExcluded: number;
  }> {
    const [memberships, suppressedRows] = await Promise.all([
      this._users.getActiveOwnerMemberships(),
      this._emailLogs.getTerminalNegativeAddresses(),
    ]);
    const suppressed = new Set(suppressedRows.map((email) => email.trim().toLowerCase()));
    const seen = new Set<string>();
    const recipients: CampaignRecipient[] = [];
    let duplicatesExcluded = 0;
    let syntheticExcluded = 0;
    let suppressedExcluded = 0;
    let invalidExcluded = 0;

    for (const membership of memberships) {
      const email = membership.user.email.trim().toLowerCase();
      if (!email.includes('@')) {
        invalidExcluded++;
        continue;
      }
      if (email.endsWith('.login.postmill.local')) {
        syntheticExcluded++;
        continue;
      }
      if (suppressed.has(email)) {
        suppressedExcluded++;
        continue;
      }
      if (seen.has(email)) {
        duplicatesExcluded++;
        continue;
      }
      seen.add(email);
      recipients.push({ userId: membership.user.id, email });
    }

    return {
      recipients,
      duplicatesExcluded,
      syntheticExcluded,
      suppressedExcluded,
      invalidExcluded,
    };
  }

  private assertLiveProvider() {
    const adapter = this._emailRegistry.getActiveAdapter();
    if (adapter.name !== 'resend' || !adapter.isConfigured()) {
      throw new Error('The campaign requires the configured Resend email provider');
    }
    if (!process.env.EMAIL_FROM_ADDRESS || !process.env.EMAIL_FROM_NAME) {
      throw new Error('Email sender information is not configured');
    }
  }

  private async sendRecipient(recipient: CampaignRecipient) {
    const result = await this._notifications.sendCampaignEmail(
      recipient.email,
      OPEN_BETA_END_CAMPAIGN_ID,
      getOpenBetaEndEmail()
    );
    if (!result) throw new Error('Email transport did not send the campaign message');
    return result;
  }
}
