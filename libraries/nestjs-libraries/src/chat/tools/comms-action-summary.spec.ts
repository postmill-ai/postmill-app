import { describe, it, expect } from 'vitest';
import { summarizeToolCall } from './comms-action-summary';

describe('summarizeToolCall', () => {
  it('describes a scheduled post with type, channel, time, stripped preview, attachments and comments', () => {
    const text = summarizeToolCall('schedulePostTool', {
      socialPost: [
        {
          integrationId: 'int-1',
          date: '2026-09-15T10:00:00Z',
          type: 'schedule',
          postsAndComments: [
            { content: '<p>Hello <strong>world</strong></p>', attachments: ['a.png'] },
            { content: '<p>first comment</p>', attachments: [] },
          ],
        },
      ],
    });
    expect(text).toBe(
      '1 post(s): Schedule on channel int-1 at 2026-09-15T10:00:00Z (UTC) — "Hello world", 1 attachment(s), 1 comment(s)',
    );
  });

  it('uses the type words Publish now / Save as draft', () => {
    const base = { integrationId: 'i', date: 'd', postsAndComments: [{ content: 'x', attachments: [] }] };
    expect(summarizeToolCall('schedulePostTool', { socialPost: [{ ...base, type: 'now' }] })).toContain('Publish now');
    expect(summarizeToolCall('schedulePostTool', { socialPost: [{ ...base, type: 'draft' }] })).toContain('Save as draft');
  });

  it('truncates long previews', () => {
    const text = summarizeToolCall('commentReply', { postId: 'p', message: 'x'.repeat(200) });
    expect(text).toContain(`"${'x'.repeat(140)}…"`);
  });

  it.each([
    ['deletePost', { group: 'g1' }, 'Delete post group g1 (every channel in the group)'],
    ['approveDraft', { postId: 'p1' }, 'Approve draft post p1'],
    ['reschedulePost', { id: 'p1', date: '2026-09-20T09:00:00Z' }, 'Move post p1 to 2026-09-20T09:00:00Z (UTC)'],
    ['commentReply', { postId: 'p1', commentId: 'c1', message: 'thanks' }, 'Reply to comment c1 on post p1: "thanks"'],
    ['commentReply', { postId: 'p1', message: 'hi' }, 'Reply as a new comment on post p1: "hi"'],
    [
      'mediaStudioGenerate',
      { provider: 'runway', operation: 'video', model: 'gen3', input: { prompt: 'a lighthouse' } },
      'Generate video with runway/gen3: "a lighthouse" (this starts a paid media job)',
    ],
    ['generateImageTool', { prompt: 'a cat' }, 'Generate an image: "a cat" (uses AI credits)'],
    ['generateVideoTool', { prompt: 'waves', imageUrl: 'https://x/y.png' }, 'Generate a video: "waves" from https://x/y.png (uses AI credits)'],
    ['uploadFromUrlTool', { url: 'https://x/y.png' }, 'Upload https://x/y.png into the media library'],
    ['designerDesign', { templateId: 't1', name: 'Promo' }, 'Create a design from template t1 named "Promo"'],
    ['designerDesign', { designId: 'd1' }, 'Update design d1'],
    ['campaignCreate', { name: 'Q3', startDate: '2026-07-01', endDate: '2026-09-30' }, 'Create campaign "Q3" (2026-07-01 → 2026-09-30)'],
    ['campaignUpdate', { id: 'c1', name: 'New', color: undefined }, 'Update campaign c1: name=New'],
    ['campaignTag', { campaignId: 'c1', action: 'tag', entityType: 'post', entityId: 'p1' }, 'Tag post p1 to campaign c1'],
    ['campaignTag', { campaignId: 'c1', action: 'untag', entityType: 'post', entityId: 'p1' }, 'Untag post p1 from campaign c1'],
    ['brandMemoryReindex', {}, 'Rebuild the brand memory index (re-embeds all brand content)'],
    [
      'runGenerator',
      { research: 'AI news', format: 'thread', tone: 'witty', isPicture: true },
      'Run the research generator (thread, witty, with pictures) for: "AI news" (uses AI credits)',
    ],
  ])('%s', (toolId, args, expected) => {
    expect(summarizeToolCall(toolId, args)).toBe(expected);
  });

  it('falls back to a bounded JSON form for unknown tools', () => {
    const text = summarizeToolCall('someNewTool', { a: 1 });
    expect(text).toBe('Run someNewTool with {"a":1}');
    expect(summarizeToolCall('someNewTool', { big: 'x'.repeat(1000) }).length).toBeLessThan(450);
  });
});
