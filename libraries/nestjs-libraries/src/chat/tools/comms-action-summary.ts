/**
 * Human-readable one-liners for outward agent tool calls, shown to a user in a
 * chat app (Slack/Telegram/…) before the action runs. Pure and deterministic:
 * no I/O, so the same call always produces the same text. Channel ids are
 * shown as ids — the model has already listed channel names via
 * integrationList and is instructed to relay this summary in its own words.
 */

const PREVIEW_CHARS = 140;

const stripHtml = (html: unknown): string =>
  String(html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const preview = (text: unknown): string => {
  const plain = stripHtml(text);
  return plain.length > PREVIEW_CHARS ? `${plain.slice(0, PREVIEW_CHARS)}…` : plain;
};

const quote = (value: unknown): string => `"${preview(value)}"`;

const SCHEDULE_TYPE_WORDS: Record<string, string> = {
  now: 'Publish now',
  schedule: 'Schedule',
  draft: 'Save as draft',
};

type Summarizer = (args: any) => string;

const SUMMARIZERS: Record<string, Summarizer> = {
  schedulePostTool: (a) => {
    const posts: any[] = Array.isArray(a?.socialPost) ? a.socialPost : [];
    if (!posts.length) return 'Schedule a post (no channels given)';
    const items = posts.map((p) => {
      const first = p?.postsAndComments?.[0];
      const attachments = first?.attachments?.length ?? 0;
      const comments = Math.max((p?.postsAndComments?.length ?? 1) - 1, 0);
      return (
        `${SCHEDULE_TYPE_WORDS[p?.type] ?? 'Schedule'} on channel ${p?.integrationId ?? '?'}` +
        ` at ${p?.date ?? '?'} (UTC) — ${quote(first?.content)}` +
        (attachments ? `, ${attachments} attachment(s)` : '') +
        (comments ? `, ${comments} comment(s)` : '')
      );
    });
    return `${posts.length} post(s): ${items.join('; ')}`;
  },
  deletePost: (a) => `Delete post group ${a?.group ?? '?'} (every channel in the group)`,
  approveDraft: (a) => `Approve draft post ${a?.postId ?? '?'}`,
  reschedulePost: (a) => `Move post ${a?.id ?? '?'} to ${a?.date ?? '?'} (UTC)`,
  commentReply: (a) =>
    `Reply ${a?.commentId ? `to comment ${a.commentId}` : 'as a new comment'} on post ${a?.postId ?? '?'}: ${quote(a?.message)}`,
  mediaStudioGenerate: (a) => {
    const prompt = a?.input?.prompt ?? a?.input?.text;
    return (
      `Generate ${a?.operation ?? 'media'} with ${a?.provider ?? '?'}${a?.model ? `/${a.model}` : ''}` +
      (prompt ? `: ${quote(prompt)}` : '') +
      ' (this starts a paid media job)'
    );
  },
  generateImageTool: (a) => `Generate an image: ${quote(a?.prompt)} (uses AI credits)`,
  generateVideoTool: (a) =>
    `Generate a video: ${quote(a?.prompt)}${a?.imageUrl ? ` from ${a.imageUrl}` : ''} (uses AI credits)`,
  uploadFromUrlTool: (a) => `Upload ${a?.url ?? '?'} into the media library`,
  designerDesign: (a) =>
    `${a?.designId ? `Update design ${a.designId}` : `Create a design${a?.templateId ? ` from template ${a.templateId}` : ''}`}` +
    (a?.name ? ` named ${quote(a.name)}` : ''),
  campaignCreate: (a) =>
    `Create campaign ${quote(a?.name)}` +
    (a?.startDate || a?.endDate ? ` (${a?.startDate ?? '…'} → ${a?.endDate ?? '…'})` : ''),
  campaignUpdate: (a) => {
    const fields = Object.entries(a ?? {})
      .filter(([k, v]) => k !== 'id' && v !== undefined && v !== null)
      .map(([k, v]) => `${k}=${preview(v)}`);
    return `Update campaign ${a?.id ?? '?'}: ${fields.join(', ') || 'no changes'}`;
  },
  campaignTag: (a) =>
    `${a?.action === 'untag' ? 'Untag' : 'Tag'} ${a?.entityType ?? 'item'} ${a?.entityId ?? '?'} ` +
    `${a?.action === 'untag' ? 'from' : 'to'} campaign ${a?.campaignId ?? '?'}`,
  brandMemoryReindex: () => 'Rebuild the brand memory index (re-embeds all brand content)',
  runGenerator: (a) =>
    `Run the research generator (${a?.format ?? 'post'}, ${a?.tone ?? 'default tone'}${a?.isPicture ? ', with pictures' : ''}) for: ${quote(a?.research)} (uses AI credits)`,
};

export function summarizeToolCall(toolId: string, args: unknown): string {
  const summarizer = SUMMARIZERS[toolId];
  if (summarizer) {
    try {
      return summarizer(args);
    } catch {
      /* fall through to the generic form */
    }
  }
  let json = '';
  try {
    json = JSON.stringify(args ?? {});
  } catch {
    json = '{}';
  }
  return `Run ${toolId} with ${json.length > 400 ? `${json.slice(0, 400)}…` : json}`;
}
