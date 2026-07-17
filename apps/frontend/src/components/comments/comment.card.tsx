'use client';

import { FC, useCallback, useState } from 'react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import ProviderIcon from '@gitroom/frontend/components/shared/provider-icon';
import { CommentComposer } from '@gitroom/frontend/components/launches/post-detail/comment.composer';
import { TeamMemberItem } from '@gitroom/frontend/components/settings/roles/hooks/use-roles';

dayjs.extend(relativeTime);

// The inbox endpoint returns the full SocialComment row + a post preview, so a single
// shape backs both the standalone inbox and the campaign dashboard section.
export interface InboxComment {
  id: string;
  content: string;
  authorName: string;
  authorUsername?: string | null;
  authorPicture?: string | null;
  platformCreatedAt: string;
  status?: string | null;
  isOwn: boolean;
  likeCount?: number;
  likedByMe?: boolean;
  assigneeId?: string | null;
  post?: {
    id: string;
    content?: string;
    integration?: {
      name: string;
      providerIdentifier: string;
      picture?: string;
    };
  };
}

interface CommentCardProps {
  comment: InboxComment;
  // Called after any mutation so the parent can revalidate its list.
  onChanged: () => void;
  // Opt-in richer actions (the campaign section turns these on; the inbox leaves them off).
  enableReply?: boolean;
  enableLike?: boolean;
  enableStatusCycle?: boolean;
  teamMembers?: TeamMemberItem[];
}

const STATUS_DOT: Record<string, string> = {
  needs_reply: 'bg-yellow-500',
  handled: 'bg-green-500',
  ignored: 'bg-gray-400',
};
const STATUS_CYCLE: Record<string, string> = {
  needs_reply: 'handled',
  handled: 'ignored',
  ignored: 'needs_reply',
};

const HeartIcon: FC<{ filled: boolean }> = ({ filled }) => (
  <svg width="13" height="13" viewBox="0 0 32 32" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5">
    <path d="M22.5 4C19.48 4 16.92 5.84 16 8.26C15.08 5.84 12.52 4 9.5 4C5.92 4 3 6.92 3 10.5C3 17.32 9.08 22.46 15.08 27.48L16 28.28L16.92 27.46C22.92 22.46 29 17.32 29 10.5C29 6.92 26.08 4 22.5 4ZM16 25.12C11.02 20.88 5 16.3 5 10.5C5 7.98 6.98 6 9.5 6C12.24 6 14.12 7.94 14.12 10.5H17.88C17.88 7.94 19.76 6 22.5 6C25.02 6 27 7.98 27 10.5C27 16.3 20.98 20.88 16 25.12Z" />
  </svg>
);

export const CommentCard: FC<CommentCardProps> = ({
  comment,
  onChanged,
  enableReply,
  enableLike,
  enableStatusCycle,
  teamMembers,
}) => {
  const t = useT();
  const fetch = useFetch();
  const postId = comment.post?.id;
  const integration = comment.post?.integration;

  const [replying, setReplying] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [liked, setLiked] = useState(!!comment.likedByMe);
  const [likeCount, setLikeCount] = useState(comment.likeCount || 0);

  const currentStatus = comment.status || 'needs_reply';

  const markHandled = useCallback(async () => {
    setBusy(true);
    try {
      await fetch('/posts/inbox/bulk-read', {
        method: 'POST',
        body: JSON.stringify({ commentIds: [comment.id] }),
      });
      onChanged();
    } finally {
      setBusy(false);
    }
  }, [fetch, comment.id, onChanged]);

  const cycleStatus = useCallback(async () => {
    if (!postId) return;
    const next = STATUS_CYCLE[currentStatus] || 'needs_reply';
    setBusy(true);
    try {
      await fetch(`/posts/${postId}/social-comments/${comment.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: next }),
      });
      onChanged();
    } finally {
      setBusy(false);
    }
  }, [fetch, postId, comment.id, currentStatus, onChanged]);

  const toggleLike = useCallback(async () => {
    if (!postId) return;
    const next = !liked;
    // optimistic
    setLiked(next);
    setLikeCount((c) => Math.max(0, c + (next ? 1 : -1)));
    try {
      const res = await fetch(`/posts/${postId}/social-comments/${comment.id}/like`, {
        method: 'POST',
        body: JSON.stringify({ like: next }),
      });
      if (!res.ok) throw new Error('like failed');
      const json = await res.json().catch(() => null);
      if (json && typeof json.likeCount === 'number') setLikeCount(json.likeCount);
    } catch {
      // revert
      setLiked(!next);
      setLikeCount((c) => Math.max(0, c + (next ? -1 : 1)));
    }
  }, [fetch, postId, comment.id, liked]);

  const assign = useCallback(
    async (assigneeId: string | null) => {
      if (!postId) return;
      setBusy(true);
      try {
        await fetch(`/posts/${postId}/social-comments/${comment.id}/assign`, {
          method: 'POST',
          body: JSON.stringify({ assigneeId }),
        });
        setAssigning(false);
        onChanged();
      } finally {
        setBusy(false);
      }
    },
    [fetch, postId, comment.id, onChanged]
  );

  return (
    <div className="bg-newBgColorInner rounded-[8px] border border-newTableBorder p-[16px] flex items-start gap-[12px]">
      {comment.authorPicture ? (
        // eslint-disable-next-line @next/next/no-img-element -- external comment author avatar
        <img
          src={comment.authorPicture}
          alt={comment.authorName}
          className="w-[36px] h-[36px] rounded-full object-cover flex-shrink-0"
        />
      ) : (
        <div className="w-[36px] h-[36px] rounded-full bg-btnPrimary flex items-center justify-center text-white text-[14px] font-bold flex-shrink-0">
          {comment.authorName?.[0]?.toUpperCase() || '?'}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-[8px] mb-[4px] flex-wrap">
          <span className="text-[13px] font-semibold text-textColor">{comment.authorName}</span>
          {comment.authorUsername && (
            <span className="text-[11px] text-newTableText">@{comment.authorUsername}</span>
          )}
          {integration && (
            <span className="flex items-center gap-[4px] text-[11px] text-newTableText">
              <ProviderIcon identifier={integration.providerIdentifier} name={integration.name} size={16} />
              {integration.name}
            </span>
          )}
          <span className="text-[11px] text-newTableText ml-auto flex items-center gap-[6px]">
            <button
              type="button"
              onClick={enableStatusCycle && postId ? cycleStatus : undefined}
              disabled={busy || !enableStatusCycle || !postId}
              className={`inline-block w-[8px] h-[8px] rounded-full ${STATUS_DOT[currentStatus] || STATUS_DOT.needs_reply} ${
                enableStatusCycle && postId ? 'cursor-pointer hover:opacity-80' : ''
              }`}
              title={t(`comment_status_${currentStatus}`, currentStatus.replace(/_/g, ' '))}
            />
            {dayjs(comment.platformCreatedAt).fromNow()}
          </span>
        </div>

        <p className="text-[13px] text-textColor break-words whitespace-pre-wrap mb-[8px]">{comment.content}</p>

        {comment.post && (
          <div className="text-[11px] text-newTableText mb-[8px] truncate">
            {t('comment_inbox.post_label', 'Post')}: {comment.post.content?.substring(0, 100) || comment.post.id}
          </div>
        )}

        <div className="flex items-center gap-[14px] flex-wrap">
          {enableLike && postId && (
            <button
              type="button"
              onClick={toggleLike}
              aria-pressed={liked}
              aria-label={liked ? t('unlike', 'Unlike') : t('like', 'Like')}
              className={`flex items-center gap-[3px] text-[11px] ${
                liked ? 'text-red-600 dark:text-red-500' : 'text-newTableText'
              } hover:text-dangerText transition-colors`}
            >
              <HeartIcon filled={liked} />
              {likeCount > 0 && likeCount}
            </button>
          )}
          {enableReply && postId && (
            <button
              type="button"
              onClick={() => setReplying((v) => !v)}
              className="text-[11px] text-newTableText hover:text-textColor transition-colors"
            >
              {t('reply', 'Reply')}
            </button>
          )}
          {teamMembers && postId && (
            <button
              type="button"
              onClick={() => setAssigning((v) => !v)}
              className="text-[11px] text-newTableText hover:text-textColor transition-colors"
            >
              {t('assign', 'Assign')}
            </button>
          )}
          {currentStatus !== 'handled' && (
            <button
              type="button"
              onClick={markHandled}
              disabled={busy}
              className="text-[12px] text-textColor hover:underline disabled:opacity-50"
            >
              {t('comment_inbox.mark_handled', 'Mark handled')}
            </button>
          )}
          <span className="text-[11px] text-newTableText capitalize">
            {t(`comment_status_${currentStatus}`, currentStatus.replace(/_/g, ' '))}
          </span>
        </div>

        {assigning && teamMembers && (
          <div className="mt-[8px]">
            <select
              value={comment.assigneeId || ''}
              onChange={(e) => assign(e.target.value || null)}
              disabled={busy}
              className="bg-newBgColor border border-newTableBorder rounded-[6px] px-[8px] py-[4px] text-[12px] text-textColor outline-none"
            >
              <option value="">{t('unassigned', 'Unassigned')}</option>
              {teamMembers.map((m) => (
                <option key={m.user.id} value={m.user.id}>
                  {m.user.profile?.name || m.user.email}
                </option>
              ))}
            </select>
          </div>
        )}

        {replying && postId && integration && (
          <CommentComposer
            postId={postId}
            replyToCommentId={comment.id}
            integrationName={integration.name}
            parentCommentText={comment.content}
            onClose={() => setReplying(false)}
            onSubmitted={() => {
              setReplying(false);
              onChanged();
            }}
          />
        )}
      </div>
    </div>
  );
};
