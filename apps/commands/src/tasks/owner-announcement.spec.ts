import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OwnerAnnouncement } from './owner-announcement';

describe('OwnerAnnouncement command', () => {
  const campaign = {
    preview: vi.fn().mockResolvedValue({ recipients: 2 }),
    sendTest: vi.fn().mockResolvedValue({ status: 'sent' }),
    sendAll: vi.fn().mockResolvedValue({ sent: 2 }),
    status: vi.fn().mockResolvedValue({ statuses: [] }),
  };
  let command: OwnerAnnouncement;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    command = new OwnerAnnouncement(campaign as any);
  });

  it('runs a side-effect-free preview', async () => {
    await command.run('preview');
    expect(campaign.preview).toHaveBeenCalled();
    expect(campaign.sendTest).not.toHaveBeenCalled();
    expect(campaign.sendAll).not.toHaveBeenCalled();
  });

  it('requires an explicit recipient for test mode', async () => {
    await expect(command.run('test')).rejects.toThrow('requires an eligible owner email');
    await command.run('test', 'owner@example.com');
    expect(campaign.sendTest).toHaveBeenCalledWith('owner@example.com');
  });

  it('passes the full-send confirmation and reports status', async () => {
    await command.run('send', 'confirmation');
    expect(campaign.sendAll).toHaveBeenCalledWith('confirmation');
    await command.run('status');
    expect(campaign.status).toHaveBeenCalled();
  });

  it('rejects an unknown mode', async () => {
    await expect(command.run('other' as any)).rejects.toThrow('Mode must be');
  });
});
