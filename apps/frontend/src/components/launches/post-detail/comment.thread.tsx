'use client';

import React, { FC, useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import SafeImage from '@gitroom/react/helpers/safe.image';
import { CommentComposer } from './comment.composer';

dayjs.extend(relativeTime);

interface SocialComment {
  id: string;
  postId: string;
  integrationId: string;
  platformCommentId: string;
  parentPlatformCommentId: string | null;
  authorId: string;
  authorName: string;
  authorUsername: string | null;
  authorPicture: string | null;
  content: string;
  likeCount: number;
  replyCount: number;
  likedByMe: boolean;
  isOwn: boolean;
  platformCreatedAt: string;
  status?: string | null;
  assigneeId?: string | null;
}

interface CommentThreadProps {
  postId: string;
  integrationId: string;
  releaseId: string;
  integrationName: string;
}

type LikeOverride = { likedByMe: boolean; likeCount: number };

const statusColors: Record<string, string> = {
  needs_reply: 'bg-yellow-500',
  handled: 'bg-green-500',
  ignored: 'bg-gray-400',
};

const statusCycle: Record<string, string> = {
  needs_reply: 'handled',
  handled: 'ignored',
  ignored: 'needs_reply',
};

const useSocialComments = (postId: string) => {
  const fetch = useFetch();
  const loadComments = useCallback(async () => {
    const res = await fetch(`/posts/${postId}/social-comments`);
    if (!res.ok) {
      if (res.status === 400 || res.status === 404 || res.status === 501 || res.status === 405) {
        return { comments: [], nextCursor: undefined, unreadCount: 0, notSupported: true };
      }
      throw new Error('failed_to_load_comments');
    }
    return res.json();
  }, [postId, fetch]);
  return useSWR(`/posts/${postId}/social-comments`, loadComments, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });
};

const HeartIcon: FC<{ filled: boolean }> = ({ filled }) => (
  <svg width="14" height="14" viewBox="0 0 32 32" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5">
    <path d="M22.5 4C19.48 4 16.92 5.84 16 8.26C15.08 5.84 12.52 4 9.5 4C5.92 4 3 6.92 3 10.5C3 17.32 9.08 22.46 15.08 27.48L16 28.28L16.92 27.46C22.92 22.46 29 17.32 29 10.5C29 6.92 26.08 4 22.5 4ZM16 25.12C11.02 20.88 5 16.3 5 10.5C5 7.98 6.98 6 9.5 6C12.24 6 14.12 7.94 14.12 10.5H17.88C17.88 7.94 19.76 6 22.5 6C25.02 6 27 7.98 27 10.5C27 16.3 20.98 20.88 16 25.12Z" />
  </svg>
);

const CommentItem: FC<{
  comment: SocialComment;
  likedByMe: boolean;
  likeCount: number;
  likePending: boolean;
  onLike: (comment: SocialComment, liked: boolean) => void;
  depth: number;
  postId: string;
  integrationName: string;
  mutate: () => void;
}> = ({ comment, likedByMe, likeCount, likePending, onLike, depth, postId, integrationName, mutate }) => {
  const t = useT();
  const fetch = useFetch();
  const [replying, setReplying] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [assignInput, setAssignInput] = useState('');

  const currentStatus = comment.status || 'needs_reply';
  const statusLabels: Record<string, string> = {
    needs_reply: t('status_needs_reply', 'Needs reply'),
    handled: t('status_handled', 'Handled'),
    ignored: t('status_ignored', 'Ignored'),
  };

  const cycleStatus = useCallback(async () => {
    const next = statusCycle[currentStatus];
    await fetch(`/posts/${postId}/social-comments/${comment.id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status: next }),
    });
    mutate();
  }, [currentStatus, postId, comment.id, fetch, mutate]);

  const handleAssign = useCallback(async () => {
    if (!assignInput.trim()) return;
    await fetch(`/posts/${postId}/social-comments/${comment.id}/assign`, {
      method: 'POST',
      body: JSON.stringify({ assigneeId: assignInput.trim() }),
    });
    setAssignInput('');
    setAssigning(false);
    mutate();
  }, [assignInput, postId, comment.id, fetch, mutate]);

  const timeAgo = useMemo(() => {
    return dayjs(comment.platformCreatedAt).fromNow();
  }, [comment.platformCreatedAt]);

  const sentimentLabel = (comment as any).sentiment as string | undefined;
  const sentimentColors: Record<string, string> = {
    positive: 'bg-green-500/20 text-green-800 dark:text-green-400 border-green-500/30',
    negative: 'bg-red-500/20 text-dangerText border-red-500/30',
    neutral: 'bg-gray-500/20 text-gray-800 dark:text-gray-400 border-gray-500/30',
  };

  return (
    <div
      className="flex gap-[8px]"
      style={{ marginInlineStart: depth > 0 ? `${Math.min(depth * 20, 60)}px` : undefined }}
    >
      <div className="shrink-0">
        {comment.authorPicture ? (
          <SafeImage
            src={comment.authorPicture}
            alt=""
            width={24}
            height={24}
            className="w-[24px] h-[24px] rounded-full object-cover"
          />
        ) : (
          <div className="w-[24px] h-[24px] rounded-full bg-newTableBorder flex items-center justify-center text-[10px] text-newTableText">
            {comment.authorName?.charAt(0) || '?'}
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-[6px] flex-wrap">
          <span className="text-[12px] font-[500] text-textColor">
            {comment.authorName}
          </span>
          {comment.authorUsername && (
            <span className="text-[11px] text-newTableText">
              @{comment.authorUsername}
            </span>
          )}
          <span className="text-[11px] text-newTableText">{timeAgo}</span>
          <button
            type="button"
            onClick={cycleStatus}
            className={`inline-block w-[8px] h-[8px] rounded-full ${statusColors[currentStatus]} cursor-pointer hover:opacity-80 transition-opacity`}
            title={statusLabels[currentStatus] || currentStatus}
          />
          {sentimentLabel && (
            <span className={`text-[10px] px-[6px] py-[1px] rounded-full border ${sentimentColors[sentimentLabel] || sentimentColors.neutral}`}>
              {sentimentLabel}
            </span>
          )}
        </div>
        <div className="text-[13px] mt-[2px] break-words whitespace-pre-wrap">
          {comment.content}
        </div>
        <div className="flex items-center gap-[12px] mt-[4px]">
          <button
            type="button"
            aria-label={t('like_comment', 'Like')}
            aria-pressed={likedByMe}
            disabled={likePending}
            onClick={() => onLike(comment, !likedByMe)}
            className={`flex items-center gap-[3px] text-[11px] ${
              likedByMe ? 'text-red-500' : 'text-newTableText'
            } hover:text-dangerText transition-colors disabled:opacity-50`}
          >
            <HeartIcon filled={likedByMe} />
            {likeCount > 0 && likeCount}
          </button>
          <button
            type="button"
            aria-label={t('reply_to_comment', 'Reply')}
            onClick={() => setReplying(!replying)}
            className="text-[11px] text-newTableText hover:text-textColor transition-colors"
          >
            {t('reply', 'Reply')}
          </button>
          <button
            type="button"
            onClick={() => setAssigning(!assigning)}
            className="text-[11px] text-newTableText hover:text-textColor transition-colors"
          >
            {t('assign', 'Assign')}
          </button>
        </div>
        {assigning && (
          <div className="flex items-center gap-[8px] mt-[4px]">
            <input
              type="text"
              value={assignInput}
              onChange={(e) => setAssignInput(e.target.value)}
              placeholder={t('assignee_placeholder', 'Assignee ID...')}
              className="flex-1 bg-newTableHeader border border-newTableBorder rounded-[4px] px-[8px] py-[4px] text-[12px] text-textColor outline-none"
            />
            <button
              type="button"
              onClick={handleAssign}
              disabled={!assignInput.trim()}
              className="text-[11px] text-btnPrimaryAccent hover:underline disabled:opacity-50"
            >
              {t('save', 'Save')}
            </button>
          </div>
        )}
        {replying && (
          <CommentComposer
            postId={postId}
            replyToCommentId={comment.id}
            onClose={() => setReplying(false)}
            integrationName={integrationName}
            onSubmitted={() => {
              setReplying(false);
              mutate();
            }}
          />
        )}
      </div>
    </div>
  );
};

export const CommentThread: FC<CommentThreadProps> = ({
  postId,
  integrationId,
  releaseId,
  integrationName,
}) => {
  const t = useT();
  const { data, error, isLoading, mutate } = useSocialComments(postId);
  const fetch = useFetch();

  // Cursor pagination: page 1 comes from SWR; "load more" appends extra pages.
  const [extraPages, setExtraPages] = useState<{ comments: SocialComment[]; nextCursor?: string }[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  // Per-comment optimistic like state + transient failure message.
  const [likeOverrides, setLikeOverrides] = useState<Record<string, LikeOverride>>({});
  const [pendingLikes, setPendingLikes] = useState<Record<string, boolean>>({});
  const [likeError, setLikeError] = useState('');
  const [expandedDepths, setExpandedDepths] = useState<Record<string, boolean>>({});

  const [summarizing, setSummarizing] = useState(false);
  const [summary, setSummary] = useState<{ summary: string; keyPoints: string[]; actionItems: string[] } | null>(null);

  // A fresh server payload supersedes optimistic/paged local state.
  useEffect(() => {
    setExtraPages([]);
    setLikeOverrides({});
    setPendingLikes({});
  }, [data]);

  const allComments: SocialComment[] = useMemo(() => {
    const base = (data?.comments as SocialComment[]) || [];
    const extra = extraPages.flatMap((p) => p.comments);
    return [...base, ...extra];
  }, [data, extraPages]);

  const moreCursor = extraPages.length
    ? extraPages[extraPages.length - 1].nextCursor
    : data?.nextCursor;

  const handleSummarize = useCallback(async () => {
    setSummarizing(true);
    setSummary(null);
    try {
      const commentText = allComments.map((c) => c.content).join('\n');
      const res = await fetch('/ai/comment-reply', {
        method: 'POST',
        body: JSON.stringify({
          commentId: '',
          postContent: commentText,
          action: 'summary',
        }),
      });
      if (res.ok) {
        setSummary(await res.json());
      }
    } catch {
      // silently fail — summary is optional UX
    } finally {
      setSummarizing(false);
    }
  }, [allComments, fetch]);

  const groupByParent = useMemo(() => {
    if (!allComments.length) return { topLevel: [] as SocialComment[], childrenMap: {} as Record<string, SocialComment[]> };
    const topLevel: SocialComment[] = [];
    const childrenMap: Record<string, SocialComment[]> = {};
    for (const c of allComments) {
      if (!c.parentPlatformCommentId) {
        topLevel.push(c);
      } else {
        if (!childrenMap[c.parentPlatformCommentId]) {
          childrenMap[c.parentPlatformCommentId] = [];
        }
        childrenMap[c.parentPlatformCommentId].push(c);
      }
    }
    return { topLevel, childrenMap };
  }, [allComments]);

  const loadMore = useCallback(async () => {
    if (!moreCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/posts/${postId}/social-comments?cursor=${encodeURIComponent(moreCursor)}`
      );
      if (res.ok) {
        const page = await res.json();
        setExtraPages((prev) => [
          ...prev,
          { comments: page.comments || [], nextCursor: page.nextCursor },
        ]);
      }
    } catch {
      // keep what we have; the load-more button stays available to retry
    } finally {
      setLoadingMore(false);
    }
  }, [moreCursor, loadingMore, fetch, postId]);

  const handleLike = useCallback(async (comment: SocialComment, liked: boolean) => {
    setLikeError('');

    setLikeOverrides((prev) => {
      const currentCount = prev[comment.id]?.likeCount ?? comment.likeCount;
      const optimisticCount = Math.max(0, currentCount + (liked ? 1 : -1));
      return {
        ...prev,
        [comment.id]: { likedByMe: liked, likeCount: optimisticCount },
      };
    });
    setPendingLikes((prev) => ({ ...prev, [comment.id]: true }));

    try {
      const res = await fetch(`/posts/${postId}/social-comments/${comment.id}/like`, {
        method: 'POST',
        body: JSON.stringify({ like: liked }),
      });
      if (!res.ok) {
        throw new Error('like_failed');
      }
      let serverCount: number | undefined;
      try {
        const json = await res.json();
        serverCount = typeof json?.likeCount === 'number' ? json.likeCount : undefined;
      } catch {
        serverCount = undefined;
      }
      if (serverCount !== undefined) {
        setLikeOverrides((prev) => ({
          ...prev,
          [comment.id]: { likedByMe: liked, likeCount: serverCount as number },
        }));
      }
    } catch {
      setLikeOverrides((prev) => {
        const next = { ...prev };
        delete next[comment.id];
        return next;
      });
      setLikeError(t('like_failed', "Couldn't update like — please try again"));
    } finally {
      setPendingLikes((prev) => {
        const next = { ...prev };
        delete next[comment.id];
        return next;
      });
    }
  }, [postId, fetch, t]);

  const renderCommentTree = (comment: SocialComment, depth: number) => {
    const children = groupByParent.childrenMap[comment.platformCommentId] || [];
    const isExpanded = expandedDepths[comment.platformCommentId];
    const override = likeOverrides[comment.id];

    return (
      <div key={comment.id}>
        <CommentItem
          comment={comment}
          likedByMe={override?.likedByMe ?? comment.likedByMe}
          likeCount={override?.likeCount ?? comment.likeCount}
          likePending={!!pendingLikes[comment.id]}
          onLike={handleLike}
          depth={depth}
          postId={postId}
          integrationName={integrationName}
          mutate={mutate}
        />
        {depth < 3 && children.map((child) => renderCommentTree(child, depth + 1))}
        {depth >= 3 && children.length > 0 && (
          <>
            {!isExpanded && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpandedDepths(prev => ({ ...prev, [comment.platformCommentId]: true }));
                }}
                className="text-[11px] text-btnPrimaryAccent hover:underline ms-[28px] mt-[4px]"
              >
                {t('show_more_replies', 'Show more replies')} ({children.length})
              </button>
            )}
            {isExpanded && (
              <>
                {children.map((child) => renderCommentTree(child, depth + 1))}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpandedDepths(prev => ({ ...prev, [comment.platformCommentId]: false }));
                  }}
                  className="text-[11px] text-newTableText hover:underline ms-[28px] mt-[4px]"
                >
                  {t('show_less_replies', 'Show less')}
                </button>
              </>
            )}
          </>
        )}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div data-testid="comment-skeleton" className="flex flex-col gap-[8px] animate-pulse">
        {[1,2,3].map((i) => (
          <div key={i} className="flex gap-[8px]">
            <div className="w-[24px] h-[24px] rounded-full bg-newTableBorder shrink-0" />
            <div className="flex-1 flex flex-col gap-[4px]">
              <div className="h-[12px] w-[120px] bg-newTableBorder rounded-[4px]" />
              <div className="h-[13px] w-full bg-newTableBorder rounded-[4px]" />
              <div className="h-[11px] w-[40px] bg-newTableBorder rounded-[4px]" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error || data?.notSupported) {
    return (
      <div className="bg-newTableHeader border border-newTableBorder rounded-[8px] p-[20px] text-center">
        <div className="text-newTableText text-[14px]">
          {t('comments_not_available_channel', "Replies aren't available for this channel yet")}
        </div>
      </div>
    );
  }

  if (!allComments.length) {
    return (
      <div className="bg-newTableHeader border border-newTableBorder rounded-[8px] p-[20px] text-center">
        <div className="text-newTableText text-[14px]">
          {t('no_comments_yet', 'No replies yet')}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex gap-[6px] items-center">
        <button
          type="button"
          onClick={handleSummarize}
          disabled={summarizing || allComments.length === 0}
          className="text-[12px] text-btnPrimaryAccent hover:underline disabled:opacity-50"
        >
          {summarizing
            ? t('summarizing', 'Summarizing...')
            : t('summarize_comments', 'Summarize Replies')}
        </button>
      </div>

      {summary && (
        <div className="bg-newTableHeader border border-newTableBorder rounded-[8px] p-[12px] flex flex-col gap-[8px]">
          <div className="text-[13px] leading-[20px]">{summary.summary}</div>
          {summary.keyPoints?.length > 0 && (
            <div>
              <div className="text-[12px] font-[600] mb-[4px]">{t('key_points', 'Key Points')}</div>
              <ul className="list-disc list-inside text-[12px] text-newTableText flex flex-col gap-[2px]">
                {summary.keyPoints.map((kp) => <li key={kp.slice(0, 80)}>{kp}</li>)}
              </ul>
            </div>
          )}
          {summary.actionItems?.length > 0 && (
            <div>
              <div className="text-[12px] font-[600] mb-[4px]">{t('action_items', 'Action Items')}</div>
              <ul className="list-disc list-inside text-[12px] text-newTableText flex flex-col gap-[2px]">
                {summary.actionItems.map((ai) => <li key={ai.slice(0, 80)}>{ai}</li>)}
              </ul>
            </div>
          )}
          <button
            type="button"
            onClick={() => setSummary(null)}
            className="text-[11px] text-newTableText hover:underline self-end"
          >
            {t('dismiss', 'Dismiss')}
          </button>
        </div>
      )}

      {likeError && (
        <div className="text-[12px] text-red-500" role="alert">{likeError}</div>
      )}
      {groupByParent.topLevel.map((comment) => renderCommentTree(comment, 0))}
      {moreCursor && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="self-center text-[12px] text-btnPrimaryAccent hover:underline disabled:opacity-50 mt-[4px]"
        >
          {loadingMore
            ? t('loading_comments', 'Loading replies...')
            : t('load_more_comments', 'Load more replies')}
        </button>
      )}
    </div>
  );
};
