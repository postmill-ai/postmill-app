import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailLogRepository } from './email-log.repository';

describe('EmailLogRepository campaign claims', () => {
  const create = vi.fn();
  const findUnique = vi.fn();
  const groupBy = vi.fn();
  let repository: EmailLogRepository;
  const data = {
    provider: 'resend',
    toAddress: 'owner@example.com',
    fromAddress: 'hello@postmill.ai',
    subject: 'Subject',
    campaignId: 'campaign-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new EmailLogRepository({
      model: { emailLog: { create, findUnique, groupBy } },
    } as any);
  });

  it('atomically creates the first recipient claim', async () => {
    create.mockResolvedValue({ id: 'log-1' });
    await expect(repository.claimCampaignLog(data)).resolves.toEqual({
      log: { id: 'log-1' },
      claimed: true,
    });
    expect(create).toHaveBeenCalledWith({ data });
  });

  it('returns the existing recipient after a unique-key collision', async () => {
    create.mockRejectedValue({ code: 'P2002' });
    findUnique.mockResolvedValue({ id: 'existing-log' });
    await expect(repository.claimCampaignLog(data)).resolves.toEqual({
      log: { id: 'existing-log' },
      claimed: false,
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: {
        campaignId_toAddress: {
          campaignId: 'campaign-1',
          toAddress: 'owner@example.com',
        },
      },
    });
  });

  it('does not hide non-unique database failures', async () => {
    create.mockRejectedValue(new Error('database unavailable'));
    await expect(repository.claimCampaignLog(data)).rejects.toThrow('database unavailable');
    expect(findUnique).not.toHaveBeenCalled();
  });
});
