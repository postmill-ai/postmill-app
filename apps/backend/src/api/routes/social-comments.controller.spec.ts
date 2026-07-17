import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock(
  '@gitroom/nestjs-libraries/database/prisma/social-comments/social.comments.service',
  () => ({
    SocialCommentsService: class MockSocialCommentsService {
      getComments = vi.fn();
      addComment = vi.fn();
      replyToCommentGuarded = vi.fn();
      likeComment = vi.fn();
      markAsRead = vi.fn();
      getUnreadCount = vi.fn();
      getInbox = vi.fn();
      parseInboxFilters = vi.fn();
      syncInbox = vi.fn();
      bulkMarkRead = vi.fn();
      getInboxUnreadCount = vi.fn();
      updateCommentStatus = vi.fn();
      assignComment = vi.fn();
    },
  })
);

import { SocialCommentsController } from './social-comments.controller';
import { SocialCommentsService } from '@gitroom/nestjs-libraries/database/prisma/social-comments/social.comments.service';

const mockOrg = { id: 'org-1', name: 'Test Org' } as any;
const mockUser = { id: 'user-1', name: 'Test User' } as any;

describe('SocialCommentsController', () => {
  let controller: SocialCommentsController;
  let service: SocialCommentsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new (SocialCommentsService as any)();
    controller = new SocialCommentsController(
      service as unknown as SocialCommentsService
    );
  });

  describe('GET /:id/social-comments', () => {
    it('returns comments for a post with cursor query param', async () => {
      const mockResult: {
        comments: Array<{ id: string }>;
        nextCursor: string | undefined;
        unreadCount: number;
      } = {
        comments: [{ id: 'c1' }],
        nextCursor: undefined,
        unreadCount: 0,
      };
      (service.getComments as any).mockResolvedValue(mockResult);

      const result = await controller.getComments(
        'post-1',
        'cursor-value',
        mockOrg,
        mockUser
      );

      expect(service.getComments).toHaveBeenCalledWith(
        'org-1',
        'user-1',
        'post-1',
        'cursor-value'
      );
      expect(result).toEqual(mockResult);
    });

    it('passes undefined when cursor query is not provided', async () => {
      (service.getComments as any).mockResolvedValue({
        comments: [],
        nextCursor: undefined,
        unreadCount: 0,
      });

      await controller.getComments('post-1', undefined, mockOrg, mockUser);

      expect(service.getComments).toHaveBeenCalledWith(
        'org-1',
        'user-1',
        'post-1',
        undefined
      );
    });
  });

  describe('GET /inbox', () => {
    it('parses filters and delegates to the service', async () => {
      const filters = { status: 'needs_reply', limit: 25 };
      const mockResult: {
        comments: Array<{ id: string }>;
        nextCursor: string | undefined;
      } = { comments: [], nextCursor: undefined };
      (service.parseInboxFilters as any).mockReturnValue(filters);
      (service.getInbox as any).mockResolvedValue(mockResult);

      const query = { status: 'needs_reply', limit: 25 } as any;
      const result = await controller.getInbox(mockOrg, mockUser, query);

      expect(service.parseInboxFilters).toHaveBeenCalledWith(query);
      expect(service.getInbox).toHaveBeenCalledWith(
        'org-1',
        'user-1',
        filters
      );
      expect(result).toEqual(mockResult);
    });
  });

  describe('POST /:id/social-comments', () => {
    it('delegates to SocialCommentsService.addComment', async () => {
      (service.addComment as any).mockResolvedValue({
        platformCommentId: 'new-comment-1',
      });

      const result = await controller.addComment(
        'post-1',
        { message: 'Hello world!' },
        'idem-key',
        mockOrg,
        mockUser
      );

      expect(service.addComment).toHaveBeenCalledWith(
        'org-1',
        'user-1',
        'post-1',
        'Hello world!',
        mockOrg,
        mockUser,
        'idem-key'
      );
      expect(result).toEqual({ platformCommentId: 'new-comment-1' });
    });
  });

  describe('POST /:id/social-comments/:commentId/reply', () => {
    it('delegates to SocialCommentsService.replyToCommentGuarded', async () => {
      (service.replyToCommentGuarded as any).mockResolvedValue({
        platformCommentId: 'reply-1',
      });

      const result = await controller.replyToComment(
        'post-1',
        'comment-1',
        { message: 'This is a reply' },
        'idem-key',
        mockOrg,
        mockUser
      );

      expect(service.replyToCommentGuarded).toHaveBeenCalledWith(
        'org-1',
        'user-1',
        'post-1',
        'comment-1',
        'This is a reply',
        mockOrg,
        mockUser,
        'idem-key'
      );
      expect(result).toEqual({ platformCommentId: 'reply-1' });
    });
  });

  describe('POST /:id/social-comments/:commentId/like', () => {
    it('likes a comment via likeComment with like=true', async () => {
      (service.likeComment as any).mockResolvedValue({
        liked: true,
        likeCount: 11,
      });

      const result = await controller.likeComment(
        'post-1',
        'comment-1',
        { like: true },
        mockOrg,
        mockUser
      );

      expect(service.likeComment).toHaveBeenCalledWith(
        'org-1',
        'user-1',
        'post-1',
        'comment-1',
        true
      );
      expect(result).toEqual({ liked: true, likeCount: 11 });
    });
  });

  describe('POST /:id/social-comments/read', () => {
    it('marks post comments as read via markAsRead', async () => {
      const readState = {
        userId: 'user-1',
        postId: 'post-1',
        lastReadAt: new Date(),
        lastReadCount: 10,
      };
      (service.markAsRead as any).mockResolvedValue(readState);

      const result = await controller.markAsRead('post-1', mockOrg, mockUser);

      expect(service.markAsRead).toHaveBeenCalledWith(
        'org-1',
        'user-1',
        'post-1'
      );
      expect(result).toEqual(readState);
    });
  });

  describe('GET /:id/social-comments/unread-count', () => {
    it('returns unread count for a post', async () => {
      (service.getUnreadCount as any).mockResolvedValue({ unreadCount: 5 });

      const result = await controller.getUnreadCount(
        'post-1',
        mockOrg,
        mockUser
      );

      expect(service.getUnreadCount).toHaveBeenCalledWith(
        'org-1',
        'user-1',
        'post-1'
      );
      expect(result).toEqual({ unreadCount: 5 });
    });
  });
});
