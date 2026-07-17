import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrgVpnConfigRepository } from './org-vpn-config.repository';

function createMockPrisma() {
  return {
    orgVpnConfig: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({ id: 'cfg-1' }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

describe('OrgVpnConfigRepository', () => {
  let repository: OrgVpnConfigRepository;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    prisma = createMockPrisma();
    repository = new OrgVpnConfigRepository(prisma as any);
  });

  describe('upsert (TI-17)', () => {
    it('creates a new config when none exists', async () => {
      const data = { name: 'Home VPN', enabled: true };
      prisma.orgVpnConfig.findFirst.mockResolvedValue(null);
      prisma.orgVpnConfig.create.mockResolvedValue({ id: 'cfg-1', organizationId: 'org-1', identifier: 'nordvpn', ...data });

      const result = await repository.upsert('org-1', 'nordvpn', data);

      expect(prisma.orgVpnConfig.create).toHaveBeenCalledWith({
        data: { organizationId: 'org-1', identifier: 'nordvpn', version: 'v1', ...data },
      });
      expect(result).toEqual(expect.objectContaining({ id: 'cfg-1' }));
    });

    it('scopes updates by id and organizationId', async () => {
      const existing = { id: 'cfg-1', organizationId: 'org-1', identifier: 'nordvpn' };
      const data = { name: 'Work VPN' };
      prisma.orgVpnConfig.findFirst.mockResolvedValue(existing);
      prisma.orgVpnConfig.updateMany.mockResolvedValue({ count: 1 });

      await repository.upsert('org-1', 'nordvpn', data);

      expect(prisma.orgVpnConfig.updateMany).toHaveBeenCalledWith({
        where: { id: 'cfg-1', organizationId: 'org-1' },
        data,
      });
    });

    it('returns null when the org-scoped update affects no rows', async () => {
      const existing = { id: 'cfg-1', organizationId: 'org-1', identifier: 'nordvpn' };
      prisma.orgVpnConfig.findFirst.mockResolvedValue(existing);
      prisma.orgVpnConfig.updateMany.mockResolvedValue({ count: 0 });

      const result = await repository.upsert('org-1', 'nordvpn', { name: 'x' });

      expect(result).toBeNull();
    });
  });
});
