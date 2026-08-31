import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommsDeliveryService } from './comms-delivery.service';
import { CommsLinkRepository } from './comms-link.repository';
import { CommsConfigService } from './comms-config.service';

const ORG = 'org-1';

const makeRow = (over: Record<string, unknown> = {}) => ({
  id: 'link-1',
  configId: 'cfg-1',
  userId: 'user-1',
  externalUserId: 'U1',
  externalChannelId: null,
  categories: { post_failed: true },
  config: { identifier: 'telegram' },
  ...over,
});

describe('CommsDeliveryService', () => {
  let service: CommsDeliveryService;
  let links: any;
  let configService: any;
  let adapter: any;

  beforeEach(() => {
    adapter = {
      sendDirectMessage: vi.fn().mockResolvedValue({ externalChannelId: 'D9' }),
    };
    links = {
      getLinkedForUsers: vi.fn().mockResolvedValue([makeRow()]),
      setExternalChannelId: vi.fn().mockResolvedValue({ count: 1 }),
    };
    configService = { resolveAdapter: vi.fn().mockResolvedValue(adapter) };
    service = new CommsDeliveryService(
      links as CommsLinkRepository,
      configService as CommsConfigService,
    );
  });

  it('sends only to links whose category checkbox is on', async () => {
    links.getLinkedForUsers.mockResolvedValue([
      makeRow(),
      makeRow({ id: 'link-2', userId: 'user-2', externalUserId: 'U2', categories: { post_failed: false } }),
      makeRow({ id: 'link-3', userId: 'user-3', externalUserId: 'U3', categories: {} }),
    ]);
    await service.sendToUsers(ORG, ['user-1', 'user-2', 'user-3'], 'post_failed', {
      title: 'T',
      message: 'M',
    });
    expect(adapter.sendDirectMessage).toHaveBeenCalledTimes(1);
    expect(adapter.sendDirectMessage.mock.calls[0][0].externalUserId).toBe('U1');
  });

  it('override bypasses category checkboxes (broadcasts)', async () => {
    links.getLinkedForUsers.mockResolvedValue([
      makeRow({ categories: { post_failed: false } }),
    ]);
    await service.sendToUsers(ORG, ['user-1'], 'post_failed', { title: 'T', message: 'M' }, true);
    expect(adapter.sendDirectMessage).toHaveBeenCalledTimes(1);
  });

  it('resolves one adapter per config and reuses it', async () => {
    links.getLinkedForUsers.mockResolvedValue([
      makeRow(),
      makeRow({ id: 'link-2', userId: 'user-2', externalUserId: 'U2' }),
    ]);
    await service.sendToUsers(ORG, ['user-1', 'user-2'], 'post_failed', { title: 'T', message: 'M' });
    expect(configService.resolveAdapter).toHaveBeenCalledTimes(1);
    expect(adapter.sendDirectMessage).toHaveBeenCalledTimes(2);
  });

  it('persists a newly learned DM channel id', async () => {
    await service.sendToUsers(ORG, ['user-1'], 'post_failed', { title: 'T', message: 'M' });
    expect(links.setExternalChannelId).toHaveBeenCalledWith('link-1', 'D9');
  });

  it('swallows delivery failures without throwing', async () => {
    adapter.sendDirectMessage.mockRejectedValue(new Error('bot dead'));
    await expect(
      service.sendToUsers(ORG, ['user-1'], 'post_failed', { title: 'T', message: 'M' }),
    ).resolves.toBeUndefined();
  });

  it('does nothing for empty user sets', async () => {
    await service.sendToUsers(ORG, [], 'post_failed', { title: 'T', message: 'M' });
    expect(links.getLinkedForUsers).not.toHaveBeenCalled();
  });
});
