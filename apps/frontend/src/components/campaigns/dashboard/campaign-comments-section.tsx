'use client';

import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  useCampaignComments,
  CampaignCommentFilters,
} from '@gitroom/frontend/components/campaigns/hooks/campaign.hooks';
import { useTeamMembers } from '@gitroom/frontend/components/settings/roles/hooks/use-roles';
import {
  CommentInboxFilters,
  InboxFilters,
  ChannelOption,
} from '@gitroom/frontend/components/comments/comment.inbox.filters';
import { CommentCard, InboxComment } from '@gitroom/frontend/components/comments/comment.card';

interface CampaignCommentsSectionProps {
  campaignId: string;
  channels: ChannelOption[];
  // Bubbles up so the dashboard can refresh the KPI/goal after a status change.
  onMutate?: () => void;
}

export const CampaignCommentsSection: FC<CampaignCommentsSectionProps> = ({
  campaignId,
  channels,
  onMutate,
}) => {
  const t = useT();
  const fetch = useFetch();
  const [filters, setFilters] = useState<InboxFilters>({ unreadOnly: false });
  // Page 1 comes from SWR; "load more" appends extra pages (better than the inbox,
  // which drops earlier pages on paginate).
  const [extraPages, setExtraPages] = useState<{ comments: InboxComment[]; nextCursor?: string }[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: team } = useTeamMembers();

  const swrFilters: CampaignCommentFilters = useMemo(
    () => ({
      status: filters.status,
      assigneeId: filters.assigneeId,
      integrationId: filters.integrationId,
      unreadOnly: filters.unreadOnly,
    }),
    [filters]
  );

  const { data, isLoading, error, mutate } = useCampaignComments(campaignId, swrFilters);

  // Reset paging + selection only when the page-1 comment list actually changes,
  // not on every SWR revalidation (which only refreshes object identity).
  const prevCommentIdsRef = useRef<string[]>([]);
  useEffect(() => {
    const currentIds = (data?.comments || []).map((c) => c.id);
    const prevIds = prevCommentIdsRef.current;
    const same =
      currentIds.length === prevIds.length &&
      currentIds.every((id, i) => id === prevIds[i]);

    if (!same) {
      setExtraPages([]);
      setSelected(new Set());
      prevCommentIdsRef.current = currentIds;
    }
  }, [data]);

  const refresh = useCallback(() => {
    mutate();
    onMutate?.();
  }, [mutate, onMutate]);

  const comments: InboxComment[] = useMemo(() => {
    const base = (data?.comments as InboxComment[]) || [];
    return [...base, ...extraPages.flatMap((p) => p.comments)];
  }, [data, extraPages]);

  const moreCursor = extraPages.length
    ? extraPages[extraPages.length - 1].nextCursor
    : data?.nextCursor;

  const handleFiltersChange = useCallback((next: InboxFilters) => {
    setFilters(next);
  }, []);

  const loadMore = useCallback(async () => {
    if (!moreCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams();
      params.set('campaignId', campaignId);
      if (filters.status) params.set('status', filters.status);
      if (filters.assigneeId) params.set('assigneeId', filters.assigneeId);
      if (filters.integrationId) params.set('integrationId', filters.integrationId);
      if (filters.unreadOnly) params.set('unreadOnly', 'true');
      params.set('cursor', moreCursor);
      const res = await fetch(`/posts/inbox?${params.toString()}`);
      if (res.ok) {
        const page = await res.json();
        setExtraPages((prev) => [...prev, { comments: page.comments || [], nextCursor: page.nextCursor }]);
      }
    } finally {
      setLoadingMore(false);
    }
  }, [moreCursor, loadingMore, campaignId, filters, fetch]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const bulkMarkHandled = useCallback(async () => {
    if (!selected.size) return;
    await fetch('/posts/inbox/bulk-read', {
      method: 'POST',
      body: JSON.stringify({ commentIds: [...selected] }),
    });
    setSelected(new Set());
    refresh();
  }, [selected, fetch, refresh]);

  return (
    <div className="p-[16px] border border-newTableBorder rounded-[12px] bg-newBgColor flex flex-col gap-[16px]">
      <div className="flex items-center gap-[8px]">
        <h3 className="text-[14px] font-semibold text-textColor">{t('replies', 'Replies')}</h3>
        <span className="text-[12px] text-newTableText">({comments.length})</span>
      </div>

      <CommentInboxFilters
        filters={filters}
        onChange={handleFiltersChange}
        channels={channels}
        teamMembers={team}
      />

      {selected.size > 0 && (
        <div className="flex items-center gap-[12px] text-[12px] text-newTableText">
          <span>{t('selected', 'Selected')}: {selected.size}</span>
          <button onClick={bulkMarkHandled} className="text-btnPrimaryAccent hover:underline">
            {t('comment_inbox.mark_handled', 'Mark handled')}
          </button>
          <button onClick={() => setSelected(new Set())} className="hover:underline">
            {t('clear', 'Clear')}
          </button>
        </div>
      )}

      {error && (error as Error).message === 'UPGRADE_REQUIRED' && (
        <div className="text-[13px] text-newTableText py-[24px] text-center">
          {t('comment_inbox.upgrade_required', 'Replies not available on your current plan')}
        </div>
      )}

      {error && (error as Error).message !== 'UPGRADE_REQUIRED' && (
        <div className="text-[13px] text-red-500 py-[24px] text-center">
          {t('comment_inbox.failed_to_load', 'Failed to load replies')}
        </div>
      )}

      {!error && isLoading && (
        <div className="text-[13px] text-newTableText py-[24px] text-center">{t('loading', 'Loading')}</div>
      )}

      {!error && !isLoading && comments.length === 0 && (
        <div className="text-[13px] text-newTableText py-[24px] text-center">
          {t('campaign_comments_empty', 'No replies for this campaign yet')}
        </div>
      )}

      {comments.length > 0 && (
        <div className="flex flex-col gap-[8px]">
          {comments.map((comment) => (
            <div key={comment.id} className="flex items-start gap-[10px]">
              <input
                type="checkbox"
                checked={selected.has(comment.id)}
                onChange={() => toggleSelect(comment.id)}
                className="mt-[18px] w-[16px] h-[16px] rounded-[4px] accent-btnPrimary flex-shrink-0"
              />
              <div className="flex-1 min-w-0">
                <CommentCard
                  comment={comment}
                  onChanged={refresh}
                  enableReply
                  enableLike
                  enableStatusCycle
                  teamMembers={team}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {moreCursor && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          className="self-center px-[20px] py-[8px] bg-btnPrimary text-white text-[13px] font-medium rounded-[8px] hover:bg-btnPrimary/90 disabled:opacity-50"
        >
          {loadingMore ? t('loading', 'Loading') : t('comment_inbox.load_more', 'Load more')}
        </button>
      )}
    </div>
  );
};
