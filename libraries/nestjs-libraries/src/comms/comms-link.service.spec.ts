import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommsLinkService } from './comms-link.service';
import { CommsLinkRepository } from './comms-link.repository';
import { CommsConfigRepository } from './comms-config.repository';

const ORG = 'org-1';

describe('CommsLinkService', () => {
  let service: CommsLinkService;
  let links: any;
  let configs: any;

  beforeEach(() => {
    links = {
      listForOrg: vi.fn().mockResolvedValue([]),
      getById: vi.fn().mockResolvedValue(null),
      getByConfigAndUser: vi.fn().mockResolvedValue(null),
      getByExternalUser: vi.fn().mockResolvedValue(null),
      isOrgMember: vi.fn().mockResolvedValue({ userId: 'user-2' }),
      create: vi.fn().mockImplementation((data: any) => Promise.resolve({ id: 'link-1', ...data })),
      update: vi.fn().mockResolvedValue({ count: 1 }),
      claim: vi.fn().mockResolvedValue({ count: 1 }),
      delete: vi.fn().mockResolvedValue({ count: 1 }),
    };
    configs = {
      getByIdentifier: vi.fn().mockResolvedValue({ id: 'cfg-1', identifier: 'telegram' }),
    };
    service = new CommsLinkService(
      links as CommsLinkRepository,
      configs as CommsConfigRepository,
    );
  });

  describe('createLink', () => {
    it('creates a pending link with an unambiguous one-time code', async () => {
      const result = await service.createLink(ORG, 'telegram', 'user-2', {
        agentChatEnabled: true,
        categories: { post_failed: true },
      });
      expect(result.connectCode).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(links.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG,
          configId: 'cfg-1',
          userId: 'user-2',
          categories: { post_failed: true },
        }),
      );
    });

    it('requires a configured provider', async () => {
      configs.getByIdentifier.mockResolvedValue(null);
      await expect(
        service.createLink(ORG, 'telegram', 'user-2', {
          agentChatEnabled: true,
          categories: {},
        }),
      ).rejects.toThrow('Configure');
    });

    it('rejects a target who is not an active org member', async () => {
      links.isOrgMember.mockResolvedValue(null);
      await expect(
        service.createLink(ORG, 'telegram', 'stranger', {
          agentChatEnabled: true,
          categories: {},
        }),
      ).rejects.toThrow('not an active member');
    });

    it('rejects a duplicate link for the same provider + user', async () => {
      links.getByConfigAndUser.mockResolvedValue({ id: 'link-1' });
      await expect(
        service.createLink(ORG, 'telegram', 'user-2', {
          agentChatEnabled: true,
          categories: {},
        }),
      ).rejects.toThrow('already has a link');
    });
  });

  describe('claimCode', () => {
    it('claims atomically and returns the linked row', async () => {
      links.getByExternalUser.mockResolvedValue({ id: 'link-1', status: 'linked' });
      const result = await service.claimCode('cfg-1', 'abcd2345', {
        externalUserId: '777',
        externalDisplayName: 'Maya',
      });
      expect(links.claim).toHaveBeenCalledWith('cfg-1', 'ABCD2345', {
        externalUserId: '777',
        externalDisplayName: 'Maya',
      });
      expect(result).toEqual({ id: 'link-1', status: 'linked' });
    });

    it('returns null when the guarded update matches nothing (expired/used/invalid)', async () => {
      links.claim.mockResolvedValue({ count: 0 });
      expect(
        await service.claimCode('cfg-1', 'ABCD2345', { externalUserId: '777' }),
      ).toBeNull();
    });

    it('short-circuits codes of the wrong length without touching the DB', async () => {
      expect(await service.claimCode('cfg-1', 'nope', { externalUserId: '777' })).toBeNull();
      expect(links.claim).not.toHaveBeenCalled();
    });
  });

  describe('regenerateCode', () => {
    it('regenerates only pending links', async () => {
      links.getById.mockResolvedValue({ id: 'link-1', status: 'linked' });
      await expect(service.regenerateCode(ORG, 'link-1')).rejects.toThrow('pending');
      links.getById.mockResolvedValue({ id: 'link-1', status: 'pending' });
      const result = await service.regenerateCode(ORG, 'link-1');
      expect(result.connectCode).toHaveLength(8);
    });

    it('404s an unknown link', async () => {
      await expect(service.regenerateCode(ORG, 'missing')).rejects.toThrow('not found');
    });
  });

  it('updateLink and deleteLink are org-scoped', async () => {
    await service.updateLink(ORG, 'link-1', { agentChatEnabled: false });
    expect(links.update).toHaveBeenCalledWith(ORG, 'link-1', { agentChatEnabled: false });
    await service.deleteLink(ORG, 'link-1');
    expect(links.delete).toHaveBeenCalledWith(ORG, 'link-1');
    links.delete.mockResolvedValue({ count: 0 });
    await expect(service.deleteLink(ORG, 'gone')).rejects.toThrow('not found');
  });
});
