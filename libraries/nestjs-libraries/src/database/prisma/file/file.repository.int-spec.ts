import { inject } from 'vitest';
import { getTestPrisma } from '@postmill-ai/nestjs-libraries/testing/test-db';
import {
  PrismaRepository,
  PrismaService,
} from '@postmill-ai/nestjs-libraries/database/prisma/prisma.service';
import { FileRepository } from './file.repository';

describe('FileRepository working-asset visibility (integration)', () => {
  it('hides working rows from ordinary queries without breaking owned references or tenant isolation', async () => {
    const prisma = getTestPrisma(inject('dbUrl'));
    const repository = new FileRepository(
      new PrismaRepository<'file'>(prisma as unknown as PrismaService),
      new PrismaRepository<'fileFolder'>(prisma as unknown as PrismaService),
    );
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const orgOne = `file-library-org-one-${suffix}`;
    const orgTwo = `file-library-org-two-${suffix}`;
    const folderId = `file-library-folder-${suffix}`;
    const ids = {
      user: `library-user-${suffix}`,
      internal: `library-internal-${suffix}`,
      preview: `library-preview-${suffix}`,
      ai: `library-ai-${suffix}`,
      deleted: `library-deleted-${suffix}`,
      otherOrg: `library-other-org-${suffix}`,
    };

    try {
      await prisma.organization.createMany({
        data: [{ id: orgOne, name: 'Library org one' }, { id: orgTwo, name: 'Library org two' }],
      });
      await prisma.fileFolder.create({
        data: { id: folderId, organizationId: orgOne, name: 'Design assets' },
      });
      await prisma.file.createMany({
        data: [
          {
            id: ids.user,
            organizationId: orgOne,
            folderId,
            name: 'shared-user.png',
            originalName: 'Shared user photo',
            path: '/uploads/shared-user.png',
            metadata: { source: 'upload' },
          },
          {
            id: ids.internal,
            organizationId: orgOne,
            folderId,
            name: 'shared-paint.png',
            originalName: 'Shared paint working file',
            path: '/uploads/shared-paint.png',
            metadata: { internal: 'design-asset' },
          },
          {
            id: ids.preview,
            organizationId: orgOne,
            folderId,
            name: 'shared-preview.png',
            originalName: 'Shared preview',
            path: '/uploads/shared-preview.png',
            metadata: { internal: 'design-preview' },
          },
          {
            id: ids.ai,
            organizationId: orgOne,
            folderId,
            name: 'shared-ai.png',
            originalName: 'Shared AI working file',
            path: '/uploads/shared-ai.png',
            metadata: { aiDesigner: 'asset' },
          },
          {
            id: ids.deleted,
            organizationId: orgOne,
            folderId,
            name: 'shared-deleted.png',
            path: '/uploads/shared-deleted.png',
            deletedAt: new Date(),
          },
          {
            id: ids.otherOrg,
            organizationId: orgTwo,
            name: 'shared-other-org.png',
            originalName: 'Shared other org photo',
            path: '/uploads/shared-other-org.png',
          },
        ],
      });

      const listed = await repository.getFiles(orgOne, 1, 'Shared');
      expect(listed.results.map((file) => file.id)).toEqual([ids.user]);
      expect(listed.pages).toBe(1);

      const searched = await repository.searchFiles(orgOne, 'Shared', folderId);
      expect(searched.map((file) => file.id)).toEqual([ids.user]);

      const folder = await repository.getFilesByFolder(orgOne, folderId, 1);
      expect(folder.results.map((file) => file.id)).toEqual([ids.user]);
      expect(folder.pages).toBe(1);

      const otherOrgSearch = await repository.searchFiles(orgTwo, 'Shared');
      expect(otherOrgSearch.map((file) => file.id)).toEqual([ids.otherOrg]);

      expect(await repository.getFileById(orgOne, ids.internal)).toMatchObject({ id: ids.internal });
      expect(await repository.getFileById(orgTwo, ids.internal)).toBeNull();
      expect((await repository.getByIds(orgTwo, [ids.internal, ids.otherOrg])).map((file) => file.id))
        .toEqual([ids.otherOrg]);

      await expect(repository.softDeleteFile(orgTwo, ids.internal)).rejects.toThrow();
      expect(await repository.getFileById(orgOne, ids.internal)).toMatchObject({
        id: ids.internal,
        deletedAt: null,
      });
    } finally {
      await prisma.organization.deleteMany({ where: { id: { in: [orgOne, orgTwo] } } });
      await prisma.$disconnect();
    }
  });
});
