import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@gitroom/nestjs-libraries/database/prisma/prisma.service', () => ({
  PrismaRepository: vi.fn(function () {
    return { model: {} };
  }),
}));

import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { IntegrationRepository } from './integration.repository';

describe('IntegrationRepository', () => {
  let repository: IntegrationRepository;
  let mockIntegration: Record<string, ReturnType<typeof vi.fn>>;
  let mockPosts: Record<string, ReturnType<typeof vi.fn>>;
  let mockPlugs: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockIntegration = {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({ id: 'int-1' }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    };

    mockPosts = {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    };

    mockPlugs = {
      findFirst: vi.fn().mockResolvedValue(null),
    };

    const integrationRepo = new (PrismaRepository as any)();
    integrationRepo.model = { integration: mockIntegration };

    const postsRepo = new (PrismaRepository as any)();
    postsRepo.model = { post: mockPosts };

    const plugsRepo = new (PrismaRepository as any)();
    plugsRepo.model = { plugs: mockPlugs };

    const customersRepo = new (PrismaRepository as any)();
    customersRepo.model = { customer: {} };

    const mentionsRepo = new (PrismaRepository as any)();
    mentionsRepo.model = { mentions: {} };

    repository = new IntegrationRepository(
      integrationRepo,
      postsRepo,
      plugsRepo,
      customersRepo,
      mentionsRepo
    );
  });

  describe('updateIntegration', () => {
    it('soft-deletes posts scoped to the organization when the integration is found', async () => {
      mockIntegration.findUnique.mockResolvedValue({ id: 'existing-id' });

      await repository.updateIntegration('int-1', {
        organizationId: 'org-1',
        internalId: 'internal-1',
      });

      expect(mockPosts.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            integrationId: 'int-1',
            organizationId: 'org-1',
          }),
          data: { deletedAt: expect.any(Date) },
        })
      );
    });

    it('does not soft-delete posts for a cross-org integration lookup', async () => {
      mockIntegration.findUnique.mockResolvedValue(null);

      await repository.updateIntegration('int-1', {
        organizationId: 'org-2',
        internalId: 'internal-1',
      });

      expect(mockPosts.updateMany).not.toHaveBeenCalled();
    });

    it('scopes both the duplicate soft-delete and the revival update by organizationId', async () => {
      mockIntegration.findUnique.mockResolvedValue({ id: 'existing-id' });

      await repository.updateIntegration('int-1', {
        organizationId: 'org-1',
        internalId: 'internal-1',
        name: 'Revived',
      });

      expect(mockIntegration.update).toHaveBeenCalledTimes(2);
      expect(mockIntegration.update).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'existing-id',
            organizationId: 'org-1',
          }),
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        })
      );
      expect(mockIntegration.update).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'int-1',
            organizationId: 'org-1',
          }),
          data: expect.objectContaining({ name: 'Revived', disabled: false }),
        })
      );
    });

    it('scopes the revival update by organizationId when no duplicate exists', async () => {
      await repository.updateIntegration('int-1', {
        organizationId: 'org-1',
        internalId: 'internal-1',
        name: 'Updated',
      });

      expect(mockIntegration.update).toHaveBeenCalledTimes(1);
      expect(mockIntegration.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'int-1',
            organizationId: 'org-1',
          }),
          data: expect.objectContaining({ name: 'Updated', disabled: false }),
        })
      );
    });
  });

  describe('setBetweenRefreshSteps', () => {
    it('updates only the integration matching id and organizationId', async () => {
      await repository.setBetweenRefreshSteps('org-1', 'int-1');

      expect(mockIntegration.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'int-1', organizationId: 'org-1' },
          data: { inBetweenSteps: true },
        })
      );
    });
  });

  describe('updateNameAndUrl', () => {
    it('updates only the integration matching id and organizationId', async () => {
      await repository.updateNameAndUrl('org-1', 'int-1', 'New Name', 'https://pic.png');

      expect(mockIntegration.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'int-1', organizationId: 'org-1' },
          data: { name: 'New Name', picture: 'https://pic.png' },
        })
      );
    });
  });

  describe('getPlugForOrg', () => {
    it('returns the plug scoped to the organization', async () => {
      await repository.getPlugForOrg('org-1', 'plug-1');

      expect(mockPlugs.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'plug-1', organizationId: 'org-1' },
        })
      );
    });
  });

  describe('getPlugForSystem', () => {
    it('returns the plug without org scoping for the Inngest worker', async () => {
      await repository.getPlugForSystem('plug-1');

      expect(mockPlugs.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'plug-1' },
        })
      );
    });
  });

  describe('disableIntegrations', () => {
    it('includes organizationId in the bulk disable update', async () => {
      mockIntegration.findMany.mockResolvedValue([{ id: 'int-1' }, { id: 'int-2' }]);

      await repository.disableIntegrations('org-1', 10);

      expect(mockIntegration.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: ['int-1', 'int-2'] },
            organizationId: 'org-1',
          }),
          data: { disabled: true },
        })
      );
    });
  });
});
