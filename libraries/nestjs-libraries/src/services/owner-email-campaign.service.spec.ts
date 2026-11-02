import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OwnerEmailCampaignService } from './owner-email-campaign.service';
import {
  OPEN_BETA_END_CAMPAIGN_ID,
  OPEN_BETA_END_CONFIRMATION,
} from '@postmill-ai/nestjs-libraries/emails/campaigns/open-beta-end-2026';

vi.mock('@postmill-ai/helpers/utils/timer', () => ({ timer: vi.fn() }));

const membership = (id: string, email: string) => ({
  user: { id, email, lastOnline: new Date(), profile: { preferredLanguage: null } },
});

describe('OwnerEmailCampaignService', () => {
  let users: { getActiveOwnerMemberships: ReturnType<typeof vi.fn> };
  let notifications: { sendCampaignEmail: ReturnType<typeof vi.fn> };
  let emailLogs: {
    getTerminalNegativeAddresses: ReturnType<typeof vi.fn>;
    getCampaignStatus: ReturnType<typeof vi.fn>;
  };
  let registry: { getActiveAdapter: ReturnType<typeof vi.fn> };
  let service: OwnerEmailCampaignService;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EMAIL_FROM_ADDRESS = 'hello@postmill.ai';
    process.env.EMAIL_FROM_NAME = 'Postmill AI';
    users = {
      getActiveOwnerMemberships: vi.fn().mockResolvedValue([
        membership('user-1', 'Owner@Example.com'),
        membership('user-1', 'owner@example.com'),
        membership('user-2', 'second@example.com'),
        membership('user-3', 'oauth@x.login.postmill.local'),
        membership('user-4', 'bounced@example.com'),
        membership('user-5', 'invalid'),
      ]),
    };
    notifications = {
      sendCampaignEmail: vi.fn().mockResolvedValue({ status: 'sent', logId: 'log-1' }),
    };
    emailLogs = {
      getTerminalNegativeAddresses: vi.fn().mockResolvedValue(['bounced@example.com']),
      getCampaignStatus: vi.fn().mockResolvedValue([{ status: 'sent', _count: { _all: 2 } }]),
    };
    registry = {
      getActiveAdapter: vi.fn().mockReturnValue({ name: 'resend', isConfigured: () => true }),
    };
    service = new OwnerEmailCampaignService(
      users as any,
      notifications as any,
      emailLogs as any,
      registry as any
    );
  });

  it('previews deduplicated eligible owners without calling the provider or sending', async () => {
    await expect(service.preview()).resolves.toEqual({
      campaignId: OPEN_BETA_END_CAMPAIGN_ID,
      language: 'en',
      recipients: 2,
      duplicatesExcluded: 1,
      syntheticExcluded: 1,
      suppressedExcluded: 1,
      invalidExcluded: 1,
    });
    expect(notifications.sendCampaignEmail).not.toHaveBeenCalled();
    expect(registry.getActiveAdapter).not.toHaveBeenCalled();
  });

  it('sends a test only to an explicitly selected eligible owner', async () => {
    await expect(service.sendTest(' OWNER@example.com ')).resolves.toEqual({
      status: 'sent',
      logId: 'log-1',
    });
    expect(notifications.sendCampaignEmail).toHaveBeenCalledWith(
      'owner@example.com',
      OPEN_BETA_END_CAMPAIGN_ID,
      expect.objectContaining({
        subject: 'Postmill AI Is Moving Beyond Open Beta — Thank You!',
        text: expect.stringContaining('Monday, November 9, 2026'),
      })
    );
    await expect(service.sendTest('missing@example.com')).rejects.toThrow('not an eligible');
    expect(notifications.sendCampaignEmail).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid confirmation before checking the provider', async () => {
    await expect(service.sendAll('wrong')).rejects.toThrow('Invalid campaign confirmation');
    expect(registry.getActiveAdapter).not.toHaveBeenCalled();
    expect(notifications.sendCampaignEmail).not.toHaveBeenCalled();
  });

  it('fails closed when Resend is not active', async () => {
    registry.getActiveAdapter.mockReturnValue({ name: 'postmark', isConfigured: () => true });
    await expect(service.sendAll(OPEN_BETA_END_CONFIRMATION)).rejects.toThrow('requires the configured Resend');
    expect(notifications.sendCampaignEmail).not.toHaveBeenCalled();
  });

  it('reports sent and duplicate-skipped recipients', async () => {
    notifications.sendCampaignEmail
      .mockResolvedValueOnce({ status: 'sent', logId: 'log-1' })
      .mockResolvedValueOnce({ status: 'skipped', logId: 'log-2' });
    await expect(service.sendAll(OPEN_BETA_END_CONFIRMATION)).resolves.toEqual({
      campaignId: OPEN_BETA_END_CAMPAIGN_ID,
      recipients: 2,
      sent: 1,
      skipped: 1,
      failed: 0,
      stoppedEarly: false,
    });
  });

  it('returns aggregate campaign delivery status', async () => {
    await expect(service.status()).resolves.toEqual({
      campaignId: OPEN_BETA_END_CAMPAIGN_ID,
      statuses: [{ status: 'sent', count: 2 }],
    });
  });
});
