import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@gitroom/nestjs-libraries/database/prisma/prisma.service', () => ({
  PrismaRepository: vi.fn(function() { return { model: {} }; }),
}));

import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { SocialCommentsRepository } from './social.comments.repository';

describe('SocialCommentsRepository', () => {
  let repository: SocialCommentsRepository;
  let mockSocialComment: Record<string, ReturnType<typeof vi.fn>>;
  let mockPostCommentRead: Record<string, ReturnType<typeof vi.fn>>;
  let mockUserOrganization: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSocialComment = {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      count: vi.fn().mockResolvedValue(0),
    };

    mockPostCommentRead = {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    };

    mockUserOrganization = {
      findFirst: vi.fn().mockResolvedValue(null),
    };

    const socialCommentRepo = new (PrismaRepository as any)();
    socialCommentRepo.model = { socialComment: mockSocialComment };

    const postCommentReadRepo = new (PrismaRepository as any)();
    postCommentReadRepo.model = { postCommentRead: mockPostCommentRead };

    const userOrganizationRepo = new (PrismaRepository as any)();
    userOrganizationRepo.model = { userOrganization: mockUserOrganization };

    repository = new SocialCommentsRepository(
      socialCommentRepo,
      postCommentReadRepo,
      userOrganizationRepo,
    );
  });

  describe('getComments', () => {
    it('returns paginated comments ordered by platformCreatedAt desc scoped to org', async () => {
      const comments = [
        { id: 'c1', platformCreatedAt: new Date('2024-01-03'), postId: 'p1' },
        { id: 'c2', platformCreatedAt: new Date('2024-01-02'), postId: 'p1' },
      ];
      mockSocialComment.findMany.mockResolvedValue(comments);

      const result = await repository.getComments('org1', 'p1');

      expect(mockSocialComment.findMany).toHaveBeenCalledWith({
        where: { postId: 'p1', deletedAt: null, post: { organizationId: 'org1' } },
        orderBy: [{ platformCreatedAt: 'desc' }, { id: 'desc' }],
        take: 51,
      });
      expect(result).toEqual(comments);
    });

    it('respects cursor parameter', async () => {
      const cursorDate = '2024-01-10T00:00:00.000Z';
      mockSocialComment.findMany.mockResolvedValue([]);

      await repository.getComments('org1', 'p1', cursorDate);

      expect(mockSocialComment.findMany).toHaveBeenCalledWith({
        where: {
          postId: 'p1',
          deletedAt: null,
          post: { organizationId: 'org1' },
          platformCreatedAt: { lt: new Date(cursorDate) },
        },
        orderBy: [{ platformCreatedAt: 'desc' }, { id: 'desc' }],
        take: 51,
      });
    });

    it('fetches limit + 1 items to detect hasMore', async () => {
      mockSocialComment.findMany.mockResolvedValue([]);

      await repository.getComments('org1', 'p1', undefined, 20);

      expect(mockSocialComment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 21 })
      );
    });
  });

  describe('getInbox pagination (1.1)', () => {
    const rows = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `c${i}`,
        postId: 'p1',
        // strictly-descending timestamps so the cursor is deterministic
        platformCreatedAt: new Date(2024, 0, 1, 0, 0, n - i),
      }));

    it('threads limit → take pageSize+1 and derives cursor from the last RETURNED item', async () => {
      const data = rows(26); // one more than the page size
      mockSocialComment.findMany.mockResolvedValue(data);

      const result = await repository.getInbox('org1', 'u1', { limit: 25 } as any);

      // take is pageSize + 1
      expect(mockSocialComment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 26 })
      );
      // only pageSize items surface
      expect(result.comments).toHaveLength(25);
      // cursor is the 25th (last returned) item, NOT the 26th
      expect(result.nextCursor).toBe(data[24].platformCreatedAt.toISOString());
    });

    it('clamps limit into [1,50]', async () => {
      mockSocialComment.findMany.mockResolvedValue([]);
      await repository.getInbox('org1', 'u1', { limit: 999 } as any);
      expect(mockSocialComment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 51 })
      );

      mockSocialComment.findMany.mockClear();
      await repository.getInbox('org1', 'u1', { limit: 0 } as any);
      expect(mockSocialComment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 2 })
      );
    });

    it('absent limit keeps the byte-identical 50/51 math', async () => {
      const data = rows(51);
      mockSocialComment.findMany.mockResolvedValue(data);

      const result = await repository.getInbox('org1', 'u1', {} as any);

      expect(mockSocialComment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 51 })
      );
      expect(result.comments).toHaveLength(50);
      expect(result.nextCursor).toBe(data[49].platformCreatedAt.toISOString());
    });

    it('no cursor when the result fits in one page', async () => {
      mockSocialComment.findMany.mockResolvedValue(rows(10));
      const result = await repository.getInbox('org1', 'u1', { limit: 25 } as any);
      expect(result.comments).toHaveLength(10);
      expect(result.nextCursor).toBeUndefined();
    });
  });

  describe('isOrganizationMember', () => {
    it('returns true when the user belongs to the organization', async () => {
      mockUserOrganization.findFirst.mockResolvedValue({ userId: 'u1' });

      await expect(repository.isOrganizationMember('u1', 'org1')).resolves.toBe(true);

      expect(mockUserOrganization.findFirst).toHaveBeenCalledWith({
        where: { userId: 'u1', organizationId: 'org1' },
        select: { userId: true },
      });
    });

    it('returns false when no membership exists', async () => {
      mockUserOrganization.findFirst.mockResolvedValue(null);

      await expect(repository.isOrganizationMember('u1', 'org1')).resolves.toBe(false);
    });
  });

  describe('getCommentById', () => {
    it('returns a single comment by id scoped to the organization', async () => {
      const comment = { id: 'c1', postId: 'p1', platformCommentId: 'pc1', organizationId: 'org1' };
      mockSocialComment.findFirst.mockResolvedValue(comment);

      const result = await repository.getCommentById('c1', 'org1');

      expect(mockSocialComment.findFirst).toHaveBeenCalledWith({
        where: { id: 'c1', organizationId: 'org1' },
      });
      expect(result).toEqual(comment);
    });

    it('returns null when comment does not exist in the organization', async () => {
      mockSocialComment.findFirst.mockResolvedValue(null);

      const result = await repository.getCommentById('nonexistent', 'org1');

      expect(result).toBeNull();
    });
  });

  describe('updateCommentStatus', () => {
    it('updates the status scoped to the organization', async () => {
      mockSocialComment.update.mockResolvedValue({ id: 'c1', status: 'handled' });

      const result = await repository.updateCommentStatus('c1', 'org1', 'handled');

      expect(mockSocialComment.update).toHaveBeenCalledWith({
        where: { id: 'c1', organizationId: 'org1' },
        data: { status: 'handled' },
      });
      expect(result.status).toBe('handled');
    });

    it('rejects cross-org updates', async () => {
      mockSocialComment.update.mockRejectedValue({ code: 'P2025' });

      await expect(
        repository.updateCommentStatus('c1', 'org2', 'handled')
      ).rejects.toBeDefined();
    });
  });

  describe('assignComment', () => {
    it('assigns the comment scoped to the organization', async () => {
      mockSocialComment.update.mockResolvedValue({ id: 'c1', assigneeId: 'u2' });

      const result = await repository.assignComment('c1', 'org1', 'u2');

      expect(mockSocialComment.update).toHaveBeenCalledWith({
        where: { id: 'c1', organizationId: 'org1' },
        data: { assigneeId: 'u2' },
      });
      expect(result.assigneeId).toBe('u2');
    });

    it('clears the assignee scoped to the organization', async () => {
      mockSocialComment.update.mockResolvedValue({ id: 'c1', assigneeId: null });

      const result = await repository.assignComment('c1', 'org1', null);

      expect(mockSocialComment.update).toHaveBeenCalledWith({
        where: { id: 'c1', organizationId: 'org1' },
        data: { assigneeId: null },
      });
      expect(result.assigneeId).toBeNull();
    });

    it('rejects cross-org assignments', async () => {
      mockSocialComment.update.mockRejectedValue({ code: 'P2025' });

      await expect(
        repository.assignComment('c1', 'org2', 'u2')
      ).rejects.toBeDefined();
    });
  });

  describe('upsertComment', () => {
    const commentData = {
      organizationId: 'org-1',
      postId: 'p1',
      integrationId: 'i1',
      platformCommentId: 'pc1',
      parentPlatformCommentId: undefined,
      authorId: 'a1',
      authorName: 'Author',
      authorUsername: 'author_user',
      authorPicture: 'https://pic.example.com/avatar.jpg',
      content: 'Test comment content',
      likeCount: 5,
      replyCount: 2,
      likedByMe: false,
      isOwn: true,
      platformCreatedAt: new Date('2024-01-01T12:00:00Z'),
      raw: '{"key":"value"}',
    };

    it('creates a new comment via upsert', async () => {
      const created = { id: 'new-id', ...commentData };
      mockSocialComment.upsert.mockResolvedValue(created);

      const result = await repository.upsertComment(commentData);

      expect(mockSocialComment.upsert).toHaveBeenCalledWith({
        where: {
          integrationId_platformCommentId: {
            integrationId: 'i1',
            platformCommentId: 'pc1',
          },
        },
        create: {
          ...commentData,
          likeCount: 5,
          replyCount: 2,
          likedByMe: false,
          isOwn: true,
        },
        update: {
          authorName: 'Author',
          authorUsername: 'author_user',
          authorPicture: 'https://pic.example.com/avatar.jpg',
          content: 'Test comment content',
          likeCount: 5,
          replyCount: 2,
          likedByMe: false,
          isOwn: true,
          raw: '{"key":"value"}',
          deletedAt: null,
        },
      });
      expect(result).toEqual(created);
    });

    it('updates an existing comment via upsert', async () => {
      const existing = { id: 'existing-id', ...commentData };
      mockSocialComment.upsert.mockResolvedValue(existing);

      const result = await repository.upsertComment(commentData);

      expect(result).toEqual(existing);
    });

    it('applies defaults for optional fields', async () => {
      const minimalData = {
        organizationId: 'org-1',
        postId: 'p1',
        integrationId: 'i1',
        platformCommentId: 'pc1',
        authorId: 'a1',
        authorName: 'Author',
        content: 'Hello',
        platformCreatedAt: new Date('2024-01-01'),
      } as any;

      mockSocialComment.upsert.mockResolvedValue({ id: 'new' });

      await repository.upsertComment(minimalData);

      expect(mockSocialComment.upsert).toHaveBeenCalledWith({
        where: {
          integrationId_platformCommentId: {
            integrationId: 'i1',
            platformCommentId: 'pc1',
          },
        },
        create: {
          ...minimalData,
          likeCount: 0,
          replyCount: 0,
          likedByMe: false,
          isOwn: false,
        },
        update: {
          authorName: 'Author',
          authorUsername: undefined,
          authorPicture: undefined,
          content: 'Hello',
          deletedAt: null,
        },
      });
    });

    it('does not clobber unspecified counts on a partial update (e.g. a like toggle)', async () => {
      const partial = {
        organizationId: 'org-1',
        postId: 'p1',
        integrationId: 'i1',
        platformCommentId: 'pc1',
        authorId: 'a1',
        authorName: 'Author',
        content: 'Hello',
        platformCreatedAt: new Date('2024-01-01'),
        likeCount: 7,
        likedByMe: true,
      } as any;

      mockSocialComment.upsert.mockResolvedValue({ id: 'new' });

      await repository.upsertComment(partial);

      const call = mockSocialComment.upsert.mock.calls[0][0];
      expect(call.update).toEqual({
        authorName: 'Author',
        authorUsername: undefined,
        authorPicture: undefined,
        content: 'Hello',
        likeCount: 7,
        likedByMe: true,
        deletedAt: null,
      });
      expect(call.update).not.toHaveProperty('replyCount');
      expect(call.update).not.toHaveProperty('isOwn');
    });
  });

  describe('getActiveCommentIds', () => {
    it('returns id + platformCommentId for active comments of a post scoped to org', async () => {
      mockSocialComment.findMany.mockResolvedValue([
        { id: 'db-1', platformCommentId: 'c1' },
      ]);

      const result = await repository.getActiveCommentIds('p1', 'org1');

      expect(mockSocialComment.findMany).toHaveBeenCalledWith({
        where: { postId: 'p1', deletedAt: null, post: { organizationId: 'org1' } },
        select: { id: true, platformCommentId: true },
      });
      expect(result).toEqual([{ id: 'db-1', platformCommentId: 'c1' }]);
    });
  });

  describe('softDeleteCommentsByIds', () => {
    it('no-ops on an empty id list', async () => {
      const result = await repository.softDeleteCommentsByIds([], 'org-1');
      expect(mockSocialComment.updateMany).not.toHaveBeenCalled();
      expect(result).toEqual({ count: 0 });
    });

    it('soft-deletes only ids whose post belongs to the org', async () => {
      mockSocialComment.updateMany.mockResolvedValue({ count: 2 });

      const result = await repository.softDeleteCommentsByIds(
        ['db-2', 'db-3'],
        'org-1'
      );

      expect(mockSocialComment.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['db-2', 'db-3'] },
          post: { organizationId: 'org-1' },
        },
        data: { deletedAt: expect.any(Date) },
      });
      expect(result).toEqual({ count: 2 });
    });
  });

  describe('read state', () => {
    it('getReadState returns existing read state', async () => {
      const readState = {
        userId: 'u1',
        postId: 'p1',
        lastReadAt: new Date('2024-01-15'),
        lastReadCount: 10,
      };
      mockPostCommentRead.findUnique.mockResolvedValue(readState);

      const result = await repository.getReadState('u1', 'p1');

      expect(mockPostCommentRead.findUnique).toHaveBeenCalledWith({
        where: { userId_postId: { userId: 'u1', postId: 'p1' } },
      });
      expect(result).toEqual(readState);
    });

    it('getReadState returns null when no read state exists', async () => {
      mockPostCommentRead.findUnique.mockResolvedValue(null);

      const result = await repository.getReadState('u1', 'p1');

      expect(result).toBeNull();
    });

    it('upsertReadState creates a new read state', async () => {
      const now = new Date('2024-01-20T12:00:00Z');
      mockPostCommentRead.upsert.mockResolvedValue({
        userId: 'u1',
        postId: 'p1',
        lastReadAt: now,
        lastReadCount: 10,
      });

      const result = await repository.upsertReadState('u1', 'p1', now, 10);

      expect(mockPostCommentRead.upsert).toHaveBeenCalledWith({
        where: { userId_postId: { userId: 'u1', postId: 'p1' } },
        create: { userId: 'u1', postId: 'p1', lastReadAt: now, lastReadCount: 10 },
        update: { lastReadAt: now, lastReadCount: 10 },
      });
      expect(result).toEqual({
        userId: 'u1',
        postId: 'p1',
        lastReadAt: now,
        lastReadCount: 10,
      });
    });

    it('upsertReadState updates existing state without lastReadCount', async () => {
      const now = new Date('2024-01-20T12:00:00Z');
      mockPostCommentRead.upsert.mockResolvedValue({
        userId: 'u1',
        postId: 'p1',
        lastReadAt: now,
        lastReadCount: 0,
      });

      const result = await repository.upsertReadState('u1', 'p1', now);

      expect(mockPostCommentRead.upsert).toHaveBeenCalledWith({
        where: { userId_postId: { userId: 'u1', postId: 'p1' } },
        create: { userId: 'u1', postId: 'p1', lastReadAt: now, lastReadCount: 0 },
        update: { lastReadAt: now },
      });
      expect(result).toEqual({
        userId: 'u1',
        postId: 'p1',
        lastReadAt: now,
        lastReadCount: 0,
      });
    });
  });

  describe('countComments', () => {
    it('returns count of non-deleted comments for a post scoped to org', async () => {
      mockSocialComment.count.mockResolvedValue(7);

      const result = await repository.countComments('p1', 'org1');

      expect(mockSocialComment.count).toHaveBeenCalledWith({
        where: { postId: 'p1', deletedAt: null, post: { organizationId: 'org1' } },
      });
      expect(result).toBe(7);
    });

    it('returns 0 when no comments exist', async () => {
      mockSocialComment.count.mockResolvedValue(0);

      const result = await repository.countComments('p1', 'org1');

      expect(result).toBe(0);
    });
  });

  describe('getUnreadCount', () => {
    it('counts non-own comments when no read state exists scoped to org', async () => {
      mockPostCommentRead.findUnique.mockResolvedValue(null);
      mockSocialComment.count.mockResolvedValue(3);

      const result = await repository.getUnreadCount('u1', 'p1', 'org1');

      expect(mockPostCommentRead.findUnique).toHaveBeenCalledWith({
        where: { userId_postId: { userId: 'u1', postId: 'p1' } },
      });
      expect(mockSocialComment.count).toHaveBeenCalledWith({
        where: {
          postId: 'p1',
          deletedAt: null,
          isOwn: false,
          post: { organizationId: 'org1' },
        },
      });
      expect(result).toBe(3);
    });

    it('filters by platformCreatedAt after lastReadAt when read state exists scoped to org', async () => {
      const lastReadAt = new Date('2024-01-10T10:00:00Z');
      mockPostCommentRead.findUnique.mockResolvedValue({
        userId: 'u1',
        postId: 'p1',
        lastReadAt,
        lastReadCount: 5,
      });
      mockSocialComment.count.mockResolvedValue(2);

      const result = await repository.getUnreadCount('u1', 'p1', 'org1');

      expect(mockSocialComment.count).toHaveBeenCalledWith({
        where: {
          postId: 'p1',
          deletedAt: null,
          isOwn: false,
          platformCreatedAt: { gt: lastReadAt },
          post: { organizationId: 'org1' },
        },
      });
      expect(result).toBe(2);
    });
  });
});
