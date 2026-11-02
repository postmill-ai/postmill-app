import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailLogRepository } from './email-log.repository';

describe('EmailLogRepository campaign claims', () => {
  const create = vi.fn();
  const findUnique = vi.fn();
  const groupBy = vi.fn();
  const updateMany = vi.fn();
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
      model: { emailLog: { create, findUnique, groupBy, updateMany } },
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
    findUnique.mockResolvedValue({ id: 'existing-log', status: 'sent' });
    await expect(repository.claimCampaignLog(data)).resolves.toEqual({
      log: { id: 'existing-log', status: 'sent' },
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
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('re-claims a failed recipient with the same log id', async () => {
    create.mockRejectedValue({ code: 'P2002' });
    findUnique.mockResolvedValue({ id: 'existing-log', status: 'failed', error: '429' });
    updateMany.mockResolvedValue({ count: 1 });
    await expect(repository.claimCampaignLog(data)).resolves.toEqual({
      log: { id: 'existing-log', status: 'queued', error: null },
      claimed: true,
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'existing-log', status: 'failed' },
      data: { status: 'queued', error: null },
    });
  });

  it('skips a failed recipient when another process claims it first', async () => {
    create.mockRejectedValue({ code: 'P2002' });
    findUnique.mockResolvedValue({ id: 'existing-log', status: 'failed', error: '429' });
    updateMany.mockResolvedValue({ count: 0 });
    await expect(repository.claimCampaignLog(data)).resolves.toEqual({
      log: { id: 'existing-log', status: 'failed', error: '429' },
      claimed: false,
    });
  });

  it('does not hide non-unique database failures', async () => {
    create.mockRejectedValue(new Error('database unavailable'));
    await expect(repository.claimCampaignLog(data)).rejects.toThrow('database unavailable');
    expect(findUnique).not.toHaveBeenCalled();
  });
});
