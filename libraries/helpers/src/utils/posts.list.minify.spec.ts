import { describe, it, expect } from 'vitest';
import {
  minifyPostItem,
  expandPostItem,
  minifyPostsList,
  expandPostsList,
  minifyPosts,
  expandPosts,
} from './posts.list.minify';

const post = {
  id: '123',
  content: 'Hello',
  publishDate: '2024-01-01',
  releaseURL: 'https://example.com',
  releaseId: 'abc',
  state: 'PUBLISHED',
  group: 'grp1',
  tags: [{ tag: { id: 't1', name: 'test', color: '#fff' } }],
  integration: { id: 'i1', providerIdentifier: 'x', name: 'X', picture: 'x.png' },
  intervalInDays: null,
  actualDate: null,
  creationMethod: 'MANUAL',
  lastViews: 1500,
  lastLikes: 234,
  lastComments: 56,
  commentCount: 56,
  unreadComments: 3,
};

describe('minifyPostItem', () => {
  it('maps new analytics fields to short keys', () => {
    const result = minifyPostItem(post);
    expect(result.lv).toBe(1500);
    expect(result.ll).toBe(234);
    expect(result.lc).toBe(56);
    expect(result.cc).toBe(56);
    expect(result.ur).toBe(3);
  });

  it('maps original fields correctly', () => {
    const result = minifyPostItem(post);
    expect(result.i).toBe('123');
    expect(result.c).toBe('Hello');
    expect(result.d).toBe('2024-01-01');
  });

  it('passes through unknown fields', () => {
    const result = minifyPostItem({ ...post, customField: 'survive' });
    expect(result.customField).toBe('survive');
  });

  it('handles null integration', () => {
    const result = minifyPostItem({ ...post, integration: null });
    expect(result.n).toBeNull();
  });

  it('handles undefined tags', () => {
    const { tags, ...withoutTags } = post;
    const result = minifyPostItem(withoutTags);
    expect(result.tg).toBeUndefined();
  });

  it('handles null values for optional fields', () => {
    const result = minifyPostItem({
      ...post,
      lastViews: null,
      lastLikes: null,
      lastComments: null,
      commentCount: null,
      unreadComments: null,
    });
    expect(result.lv).toBeNull();
    expect(result.ll).toBeNull();
    expect(result.lc).toBeNull();
    expect(result.cc).toBeNull();
    expect(result.ur).toBeNull();
  });

  it('handles undefined values for optional fields', () => {
    const { lastViews, lastLikes, lastComments, commentCount, unreadComments, ...rest } = post;
    const result = minifyPostItem(rest);
    expect(result.lv).toBeUndefined();
    expect(result.ll).toBeUndefined();
    expect(result.lc).toBeUndefined();
    expect(result.cc).toBeUndefined();
    expect(result.ur).toBeUndefined();
  });
});

describe('expandPostItem', () => {
  it('reverses mapping of new analytics fields', () => {
    const minified = minifyPostItem(post);
    const expanded = expandPostItem(minified);
    expect(expanded.lastViews).toBe(1500);
    expect(expanded.lastLikes).toBe(234);
    expect(expanded.lastComments).toBe(56);
    expect(expanded.commentCount).toBe(56);
    expect(expanded.unreadComments).toBe(3);
  });

  it('restores original fields', () => {
    const minified = minifyPostItem(post);
    const expanded = expandPostItem(minified);
    expect(expanded.id).toBe('123');
    expect(expanded.content).toBe('Hello');
    expect(expanded.publishDate).toBe('2024-01-01');
  });

  it('expands nested integration object', () => {
    const minified = minifyPostItem(post);
    const expanded = expandPostItem(minified);
    expect(expanded.integration).toEqual({
      id: 'i1',
      providerIdentifier: 'x',
      name: 'X',
      picture: 'x.png',
    });
  });

  it('expands nested tags', () => {
    const minified = minifyPostItem(post);
    const expanded = expandPostItem(minified);
    expect(expanded.tags).toEqual([
      { tag: { id: 't1', name: 'test', color: '#fff' } },
    ]);
  });
});

describe('round-trip', () => {
  it('preserves all new field values through minify/expand', () => {
    const result = expandPostItem(minifyPostItem(post));
    expect(result.lastViews).toBe(post.lastViews);
    expect(result.lastLikes).toBe(post.lastLikes);
    expect(result.lastComments).toBe(post.lastComments);
    expect(result.commentCount).toBe(post.commentCount);
    expect(result.unreadComments).toBe(post.unreadComments);
  });

  it('preserves all original field values through minify/expand', () => {
    const result = expandPostItem(minifyPostItem(post));
    expect(result.id).toBe(post.id);
    expect(result.content).toBe(post.content);
    expect(result.publishDate).toBe(post.publishDate);
    expect(result.releaseURL).toBe(post.releaseURL);
    expect(result.releaseId).toBe(post.releaseId);
    expect(result.state).toBe(post.state);
    expect(result.group).toBe(post.group);
    expect(result.intervalInDays).toBe(post.intervalInDays);
    expect(result.actualDate).toBe(post.actualDate);
    expect(result.creationMethod).toBe(post.creationMethod);
  });

  it('passes through unknown fields after round-trip', () => {
    const result = expandPostItem(minifyPostItem({ ...post, extra: 'pass' }));
    expect(result.extra).toBe('pass');
  });

  it('preserves nested objects in stats', () => {
    const postWithStats = {
      ...post,
      stats: { views: 100, likes: { count: 50, trend: 'up' } },
    };
    const result = expandPostItem(minifyPostItem(postWithStats));
    expect(result.stats).toEqual({ views: 100, likes: { count: 50, trend: 'up' } });
  });

  it('round-trips null/undefined for optional fields', () => {
    const noStats = {
      ...post,
      lastViews: null,
      lastLikes: undefined,
    };
    const result = expandPostItem(minifyPostItem(noStats));
    expect(result.lastViews).toBeNull();
    expect(result.lastLikes).toBeUndefined();
  });
});

describe('minifyPostsList / expandPostsList', () => {
  it('round-trips a full list with new fields', () => {
    const data = {
      posts: [post],
      total: 1,
      page: 1,
      limit: 20,
      hasMore: false,
    };
    const minified = minifyPostsList(data);
    const expanded = expandPostsList(minified);
    expect(expanded.total).toBe(1);
    expect(expanded.posts[0].lastViews).toBe(1500);
    expect(expanded.posts[0].unreadComments).toBe(3);
  });
});

describe('minifyPosts / expandPosts', () => {
  it('round-trips a calendar payload with new fields', () => {
    const data = { posts: [post] };
    const minified = minifyPosts(data);
    const expanded = expandPosts(minified);
    expect(expanded.posts[0].lastViews).toBe(1500);
    expect(expanded.posts[0].unreadComments).toBe(3);
  });
});
