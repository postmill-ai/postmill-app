import { describe, expect, it, vi } from 'vitest';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { PostsRepository } from './posts.repository';

dayjs.extend(utc);

describe('PostsRepository', () => {
  describe('claimForPublish (0.7)', () => {
    it('flips exactly a QUEUE, non-deleted row to PUBLISHING and returns the count', async () => {
      const updateMany = vi.fn().mockResolvedValue({ count: 1 });
      const repository = Object.create(PostsRepository.prototype) as PostsRepository;
      (repository as any)._post = { model: { post: { updateMany } } };

      const count = await repository.claimForPublish('post-1', 'org-1');

      expect(count).toBe(1);
      expect(updateMany).toHaveBeenCalledWith({
        where: { id: 'post-1', organizationId: 'org-1', state: 'QUEUE', deletedAt: null },
        data: { state: 'PUBLISHING' },
      });
    });

    it('returns 0 when the row is no longer QUEUE (already claimed / published)', async () => {
      const updateMany = vi.fn().mockResolvedValue({ count: 0 });
      const repository = Object.create(PostsRepository.prototype) as PostsRepository;
      (repository as any)._post = { model: { post: { updateMany } } };

      expect(await repository.claimForPublish('post-1', 'org-1')).toBe(0);
    });

    it('does not claim a post from a different org', async () => {
      const updateMany = vi.fn().mockResolvedValue({ count: 0 });
      const repository = Object.create(PostsRepository.prototype) as PostsRepository;
      (repository as any)._post = { model: { post: { updateMany } } };

      await repository.claimForPublish('post-1', 'org-a');

      expect(updateMany).toHaveBeenCalledWith({
        where: { id: 'post-1', organizationId: 'org-a', state: 'QUEUE', deletedAt: null },
        data: { state: 'PUBLISHING' },
      });
    });
  });

  describe('searchForMissingThreeHoursPosts (2.1)', () => {
    it('only recovers posts overdue by more than 3 hours', () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const repository = Object.create(PostsRepository.prototype) as PostsRepository;
      (repository as any)._post = { model: { post: { findMany } } };

      repository.searchForMissingThreeHoursPosts();

      const where = findMany.mock.calls[0][0].where;
      const upper = dayjs.utc(where.publishDate.lt);
      const lower = dayjs.utc(where.publishDate.gte);

      // A 1-minute-overdue QUEUE post is NOT within [gte, lt) — it is after the
      // now-3h upper bound, so it is excluded.
      const oneMinOverdue = dayjs.utc().subtract(1, 'minute');
      expect(oneMinOverdue.isAfter(upper)).toBe(true);

      // A 4-hour-overdue post falls inside the window and is recovered.
      const fourHoursOverdue = dayjs.utc().subtract(4, 'hour');
      expect(fourHoursOverdue.isBefore(upper)).toBe(true);
      expect(fourHoursOverdue.isAfter(lower)).toBe(true);
    });
  });

  describe('_redactSensitive (4.1a)', () => {
    it('redacts compound sensitive keys like client_secret', () => {
      const repository = Object.create(PostsRepository.prototype) as PostsRepository;
      const out = (repository as any)._redactSensitive('{"client_secret":"abc"}');
      expect(out).not.toContain('abc');
      expect(out).toContain('[REDACTED]');
    });

    it('still redacts cookie and privateKey variants', () => {
      const repository = Object.create(PostsRepository.prototype) as PostsRepository;
      const out = (repository as any)._redactSensitive(
        '{"cookie":"sess=1","private_key":"xyz"}'
      );
      expect(out).not.toContain('sess=1');
      expect(out).not.toContain('xyz');
    });
  });

  describe('createPopularPosts', () => {
    it('persists the supplied popular post fields', async () => {
      const create = vi.fn().mockResolvedValue({ id: 'popular-1' });
      const repository = Object.create(PostsRepository.prototype) as PostsRepository;
      (repository as any)._popularPosts = {
        model: {
          popularPosts: { create },
        },
      };

      await repository.createPopularPosts({
        category: 'growth',
        topic: 'launch',
        content: 'Ship the update',
        hook: 'New feature',
      });

      expect(create).toHaveBeenCalledWith({
        data: {
          category: 'growth',
          topic: 'launch',
          content: 'Ship the update',
          hook: 'New feature',
        },
      });
    });
  });

  describe('createOrUpdatePost tag lookup (I4c)', () => {
    it('excludes soft-deleted tags via deletedAt: null', async () => {
      const upsert = vi.fn().mockResolvedValue({ id: 'post-1' });
      const tagsDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
      const tagsFindMany = vi.fn().mockResolvedValue([{ id: 'tag-1' }]);
      const postUpdate = vi.fn().mockResolvedValue({ id: 'post-1' });

      const repository = Object.create(PostsRepository.prototype) as PostsRepository;
      (repository as any)._post = { model: { post: { upsert, update: postUpdate } } };
      (repository as any)._tagsPosts = {
        model: { tagsPosts: { deleteMany: tagsDeleteMany } },
      };
      (repository as any)._tags = { model: { tags: { findMany: tagsFindMany } } };

      await repository.createOrUpdatePost(
        'schedule',
        'org-1',
        new Date().toISOString(),
        {
          integration: { id: 'int-1' },
          settings: {},
          value: [{ id: 'post-1', content: 'hello', image: [] }],
        } as any,
        [{ value: 'launch', label: 'launch' }],
        'manual' as any
      );

      expect(tagsFindMany).toHaveBeenCalledTimes(1);
      const where = tagsFindMany.mock.calls[0][0].where;
      expect(where.deletedAt).toBeNull();
      expect(where.orgId).toBe('org-1');

      expect(tagsDeleteMany).toHaveBeenCalledWith({
        where: {
          post: {
            id: 'post-1',
            organizationId: 'org-1',
          },
        },
      });
      expect(postUpdate).toHaveBeenCalledWith({
        where: {
          id: 'post-1',
          organizationId: 'org-1',
        },
        data: {
          tags: {
            createMany: {
              data: [{ tagId: 'tag-1' }],
            },
          },
        },
      });
    });
  });
});

describe('1.1 / 1.3 / 1.4 — dashboard repository queries', () => {
  it('getFailedPosts filters to live ERROR root posts within the window', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = Object.create(PostsRepository.prototype) as PostsRepository;
    (repository as any)._post = { model: { post: { findMany } } };

    const since = new Date('2026-06-04T00:00:00.000Z');
    await repository.getFailedPosts('org-1', since, 10);

    const args = findMany.mock.calls[0][0];
    expect(args.where.state).toBe('ERROR');
    expect(args.where.deletedAt).toBeNull();
    expect(args.where.parentPostId).toBeNull();
    expect(args.where.updatedAt.gte).toBe(since);
    expect(args.orderBy).toEqual({ updatedAt: 'desc' });
    expect(args.take).toBe(10);
    expect(args.select.integration.select).not.toHaveProperty('token');
  });

  it('getPendingApprovalPosts filters to pending draft approvals', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = Object.create(PostsRepository.prototype) as PostsRepository;
    (repository as any)._post = { model: { post: { findMany } } };

    await repository.getPendingApprovalPosts('org-1', 5);

    const args = findMany.mock.calls[0][0];
    expect(args.where.state).toBe('DRAFT');
    expect(args.where.approvalStatus).toBe('pending');
    expect(args.where.deletedAt).toBeNull();
    expect(args.orderBy).toEqual({ createdAt: 'asc' });
    expect(args.select.campaign).toBeDefined();
  });

  it('getScheduledPostDates selects only publishDate in the window', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = Object.create(PostsRepository.prototype) as PostsRepository;
    (repository as any)._post = { model: { post: { findMany } } };

    const from = new Date('2026-06-11T00:00:00.000Z');
    const to = new Date('2026-06-17T23:59:59.999Z');
    await repository.getScheduledPostDates('org-1', from, to);

    const args = findMany.mock.calls[0][0];
    expect(args.where.state).toBe('QUEUE');
    expect(args.where.publishDate.gte).toBe(from);
    expect(args.where.publishDate.lte).toBe(to);
    expect(args.select).toEqual({ publishDate: true });
  });
});
