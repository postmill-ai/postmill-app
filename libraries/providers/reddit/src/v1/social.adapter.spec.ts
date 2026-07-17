import { describe, it, expect, vi } from 'vitest';
import { RedditProvider } from './social.adapter';

const makeProvider = (children: any[], capture?: (url: string) => void) => {
  const provider = new RedditProvider();
  (provider as any).fetch = vi.fn(async (url: string) => {
    capture?.(url);
    return {
      json: async () => ({ data: { children } }),
    } as any;
  });
  return provider;
};

const child = (data: Record<string, unknown>) => ({ kind: 't3', data });

describe('RedditProvider.postAnalytics', () => {
  it('aggregates all children of a multi-subreddit post (sum score/comments, average ratio)', async () => {
    let calledUrl = '';
    const provider = makeProvider(
      [
        child({ score: 300, upvote_ratio: 0.9, num_comments: 10 }),
        child({ score: 200, upvote_ratio: 0.8, num_comments: 5 }),
      ],
      (url) => (calledUrl = url)
    );

    const result = await provider.postAnalytics('int', 'token', 't3_aaa,bbb', 0);

    // Per-id t3_ prefixing: already-prefixed kept, bare id prefixed.
    expect(calledUrl).toContain('id=t3_aaa,t3_bbb');

    const byLabel = Object.fromEntries(
      result.map((r) => [r.label, r.data[0].total])
    );
    expect(byLabel['Score']).toBe('500');
    expect(byLabel['Comments']).toBe('15');
    expect(byLabel['Upvote Ratio']).toBe('0.85');
  });

  it('handles a single-child post identically to before', async () => {
    const provider = makeProvider([
      child({ score: 42, upvote_ratio: 0.95, num_comments: 3 }),
    ]);

    const result = await provider.postAnalytics('int', 'token', 't3_solo', 0);
    const byLabel = Object.fromEntries(
      result.map((r) => [r.label, r.data[0].total])
    );
    expect(byLabel['Score']).toBe('42');
    expect(byLabel['Comments']).toBe('3');
    expect(byLabel['Upvote Ratio']).toBe('0.95');
  });

  it('returns [] when no children are present', async () => {
    const provider = makeProvider([]);
    const result = await provider.postAnalytics('int', 'token', 't3_none', 0);
    expect(result).toEqual([]);
  });
});
