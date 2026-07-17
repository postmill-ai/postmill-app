'use client';

import { FC, useCallback, useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import clsx from 'clsx';
import useSWR, { mutate as swrMutate } from 'swr';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useLaunchStore } from '@gitroom/frontend/components/composer/store';
import { Composer } from '@gitroom/frontend/components/composer/composer';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Integrations } from '@gitroom/frontend/components/launches/calendar.context';
import { Button } from '@gitroom/react/form/button';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { DataTable, StatusPill } from '@gitroom/frontend/components/ui/data-table';
import { PlatformAvatar } from '@gitroom/frontend/components/shared/platform-avatar';
import { CloseModalButton } from '@gitroom/frontend/components/shared/close-modal-button';

interface CampaignPost {
  id: string;
  title?: string;
  content?: string;
  publishDate?: string;
  state?: string;
  lastViews?: number | null;
  lastLikes?: number | null;
  lastComments?: number | null;
  integration?: {
    id: string;
    name: string;
    picture?: string;
    providerIdentifier?: string;
  };
}

const STATE_PILL: Record<string, { status: 'green' | 'blue' | 'amber' | 'red'; labelKey: string; label: string }> = {
  PUBLISHED: { status: 'green', labelKey: 'post_state_published', label: 'Published' },
  QUEUE: { status: 'blue', labelKey: 'post_state_queue', label: 'Scheduled' },
  DRAFT: { status: 'amber', labelKey: 'post_state_draft', label: 'Draft' },
};

const ListIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
    <circle cx="3.5" cy="6" r="1" fill="currentColor" stroke="none" /><circle cx="3.5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="3.5" cy="18" r="1" fill="currentColor" stroke="none" />
  </svg>
);
const GridIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
);

export const CampaignPostsSection: FC<{ campaignId: string; posts: CampaignPost[] }> = ({
  campaignId,
  posts,
}) => {
  const t = useT();
  const fetch = useFetch();
  const modal = useModals();
  const setCampaignId = useLaunchStore((state) => state.setCampaignId);

  const { data: integrations } = useSWR<Integrations[]>(
    '/integrations/list',
    async () => {
      const r = await fetch('/integrations/list');
      if (!r.ok) throw new Error(t('failed_to_load_channels', 'Failed to load channels'));
      return (await r.json()).integrations;
    },
    { revalidateOnFocus: false }
  );

  const PAGE_SIZE = 10;

  // View mode: card is the default on mobile, list on desktop; a manual toggle overrides.
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const [viewOverride, setViewOverride] = useState<'list' | 'card' | null>(null);
  const view = viewOverride ?? (isMobile ? 'card' : 'list');

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'DRAFT' | 'QUEUE' | 'PUBLISHED'>('all');
  const [channel, setChannel] = useState('');
  const [sort, setSort] = useState<'newest' | 'oldest' | 'views' | 'likes' | 'comments'>('newest');
  const [page, setPage] = useState(0);

  // Reset to the first page whenever the filters change.
  const update = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(0);
  };

  const channels = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of posts || []) {
      if (p.integration?.id) map.set(p.integration.id, p.integration.name);
    }
    return [...map.entries()];
  }, [posts]);

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = (posts || []).filter((p) => {
      if (status !== 'all' && p.state !== status) return false;
      if (channel && p.integration?.id !== channel) return false;
      if (q) {
        const hay = [p.title, p.content?.replace(/<[^>]+>/g, ' '), p.integration?.name]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const time = (p: CampaignPost) => (p.publishDate ? new Date(p.publishDate).getTime() : 0);
    return [...filtered].sort((a, b) => {
      switch (sort) {
        case 'oldest': return time(a) - time(b);
        case 'views': return (b.lastViews || 0) - (a.lastViews || 0);
        case 'likes': return (b.lastLikes || 0) - (a.lastLikes || 0);
        case 'comments': return (b.lastComments || 0) - (a.lastComments || 0);
        default: return time(b) - time(a); // newest
      }
    });
  }, [posts, search, status, channel, sort]);

  const totalPages = Math.ceil(results.length / PAGE_SIZE);
  const paged = useMemo(
    () => results.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [results, page]
  );

  const refreshDashboard = useCallback(() => {
    swrMutate(`campaign-dashboard-${campaignId}`);
  }, [campaignId]);

  const openNewDraft = useCallback(() => {
    setCampaignId(campaignId);
    const close = () => {
      useLaunchStore.getState().setCampaignId(null);
      modal.closeAll();
    };
    modal.openModal({
      withCloseButton: false,
      fullScreen: true,
      removeLayout: true,
      size: '100%',
      height: '100%',
      children: (
        <div className="relative w-full h-full">
          <CloseModalButton onClick={close} />
          <Composer
            date={newDayjs()}
            integrations={integrations || []}
            allIntegrations={integrations || []}
            reopenModal={() => undefined}
            mutate={refreshDashboard}
            customClose={close}
            padding="p-0"
          />
        </div>
      ),
    });
  }, [campaignId, integrations, modal, refreshDashboard, setCampaignId, t]);

  const columns = useMemo(
    () => [
      {
        key: 'date',
        header: t('date', 'Date'),
        width: '140px',
        render: (post: CampaignPost) => (
          <span className="text-[13px] text-textColor">
            {post.publishDate ? dayjs(post.publishDate).format(t('campaign_post_date_format', 'MMM D, YYYY HH:mm')) : '—'}
          </span>
        ),
      },
      {
        key: 'channel',
        header: t('channel', 'Channel'),
        render: (post: CampaignPost) => (
          <div className="flex items-center gap-[8px]">
            <PlatformAvatar
              picture={post.integration?.picture}
              identifier={post.integration?.providerIdentifier}
              size={24}
            />
            <span className="text-[13px] text-textColor">
              {post.integration?.name || '—'}
            </span>
          </div>
        ),
      },
      {
        key: 'content',
        header: t('content', 'Content'),
        render: (post: CampaignPost) => (
          <span className="text-[13px] text-textColor line-clamp-1">
            {post.title || post.content?.replace(/<[^>]+>/g, ' ') || '—'}
          </span>
        ),
      },
      {
        key: 'state',
        header: t('status', 'Status:'),
        width: '110px',
        render: (post: CampaignPost) => {
          const pill = STATE_PILL[post.state || ''] || { status: 'blue' as const, labelKey: `post_state_${post.state?.toLowerCase()}`, label: post.state || '—' };
          return <StatusPill status={pill.status} label={t(pill.labelKey, pill.label)} />;
        },
      },
      {
        key: 'engagement',
        header: t('engagement', 'Engagement'),
        width: '180px',
        render: (post: CampaignPost) => (
          <div className="flex items-center gap-[12px] text-[12px] text-newTableText">
            <span>{Math.round(post.lastViews || 0).toLocaleString()} {t('views', 'Views')}</span>
            <span>{Math.round(post.lastLikes || 0).toLocaleString()} {t('likes', 'Likes')}</span>
            <span>{Math.round(post.lastComments || 0).toLocaleString()} {t('replies', 'Replies')}</span>
          </div>
        ),
      },
    ],
    [t]
  );

  const viewToggle = (visibility: string) => (
    <div
      className={clsx(
        'rounded-[8px] border border-newTableBorder overflow-hidden shrink-0',
        visibility
      )}
    >
      <button
        type="button"
        onClick={() => setViewOverride('list')}
        aria-label={t('list_view', 'List view')}
        aria-pressed={view === 'list'}
        className={clsx(
          'px-[10px] py-[8px] transition-colors',
          view === 'list' ? 'bg-btnPrimary text-white' : 'text-newTableText hover:text-textColor'
        )}
      >
        {ListIcon}
      </button>
      <button
        type="button"
        onClick={() => setViewOverride('card')}
        aria-label={t('card_view', 'Card view')}
        aria-pressed={view === 'card'}
        className={clsx(
          'px-[10px] py-[8px] transition-colors',
          view === 'card' ? 'bg-btnPrimary text-white' : 'text-newTableText hover:text-textColor'
        )}
      >
        {GridIcon}
      </button>
    </div>
  );

  return (
    <div className="p-[16px] border border-newTableBorder rounded-[12px] bg-newBgColor flex flex-col gap-[12px]">
      <div className="flex items-center justify-between gap-[8px]">
        <h3 className="text-[16px] font-semibold text-textColor">{t('posts', 'Posts')}</h3>
        <div className="flex items-center gap-[8px]">
          <Button onClick={openNewDraft} className="!h-[32px] !px-[12px] text-[13px]">
            {t('new_draft', 'New Draft')}
          </Button>
          {viewToggle('flex lg:hidden')}
        </div>
      </div>

      {(posts?.length || 0) > 0 && (
        <div className="flex flex-wrap items-center gap-[8px]">
          <input
            type="text"
            value={search}
            onChange={(e) => update(setSearch)(e.target.value)}
            placeholder={t('search_posts', 'Search content or channel...')}
            className="flex-1 min-w-[160px] px-[12px] py-[8px] bg-newBgColorInner border border-newTableBorder rounded-[8px] text-[14px] outline-none"
          />
          <select
            value={status}
            onChange={(e) => update(setStatus)(e.target.value as typeof status)}
            aria-label={t('status', 'Status:')}
            className="px-[12px] py-[8px] bg-newBgColorInner border border-newTableBorder rounded-[8px] text-[14px] outline-none"
          >
            <option value="all">{t('all_statuses', 'All statuses')}</option>
            <option value="DRAFT">{t('draft', 'Draft')}</option>
            <option value="QUEUE">{t('scheduled', 'Scheduled')}</option>
            <option value="PUBLISHED">{t('published', 'Published')}</option>
          </select>
          {channels.length > 1 && (
            <select
              value={channel}
              onChange={(e) => update(setChannel)(e.target.value)}
              aria-label={t('channel', 'Channel')}
              className="px-[12px] py-[8px] bg-newBgColorInner border border-newTableBorder rounded-[8px] text-[14px] outline-none max-w-[180px]"
            >
              <option value="">{t('all_channels', 'All channels')}</option>
              {channels.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          )}
          <select
            value={sort}
            onChange={(e) => update(setSort)(e.target.value as typeof sort)}
            aria-label={t('sort_by', 'Sort by')}
            className="px-[12px] py-[8px] bg-newBgColorInner border border-newTableBorder rounded-[8px] text-[14px] outline-none"
          >
            <option value="newest">{t('sort_newest', 'Newest')}</option>
            <option value="oldest">{t('sort_oldest', 'Oldest')}</option>
            <option value="views">{t('sort_most_views', 'Most views')}</option>
            <option value="likes">{t('sort_most_likes', 'Most likes')}</option>
            <option value="comments">{t('sort_most_comments', 'Most replies')}</option>
          </select>
          {viewToggle('hidden lg:flex')}
        </div>
      )}

      {(posts?.length || 0) > 0 && results.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-[32px] gap-[8px]">
          <span className="text-[14px] text-newTableText">
            {t('no_posts_match', 'No posts match your filters')}
          </span>
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setStatus('all');
              setChannel('');
              setSort('newest');
              setPage(0);
            }}
            className="text-[13px] text-btnPrimaryAccent hover:underline"
          >
            {t('clear_filters', 'Clear filters')}
          </button>
        </div>
      ) : view === 'card' && (posts?.length || 0) > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-[12px]">
          {paged.map((post) => {
            const pill = STATE_PILL[post.state || ''] || {
              status: 'blue' as const,
              labelKey: `post_state_${post.state?.toLowerCase()}`,
              label: post.state || '—',
            };
            return (
              <div
                key={post.id}
                className="p-[12px] border border-newTableBorder rounded-[10px] bg-newBgColorInner flex flex-col gap-[8px]"
              >
                <div className="flex items-center justify-between gap-[8px]">
                  <div className="flex items-center gap-[8px] min-w-0">
                    <PlatformAvatar
              picture={post.integration?.picture}
              identifier={post.integration?.providerIdentifier}
              size={24}
            />
                    <span className="text-[13px] text-textColor truncate">
                      {post.integration?.name || '—'}
                    </span>
                  </div>
                  <StatusPill status={pill.status} label={t(pill.labelKey, pill.label)} />
                </div>
                <div className="text-[13px] text-textColor line-clamp-2">
                  {post.title || post.content?.replace(/<[^>]+>/g, ' ') || '—'}
                </div>
                <div className="flex items-center justify-between gap-[8px] flex-wrap text-[12px] text-newTableText">
                  <span>
                    {post.publishDate
                      ? dayjs(post.publishDate).format(t('campaign_post_date_format', 'MMM D, YYYY HH:mm'))
                      : '—'}
                  </span>
                  <div className="flex items-center gap-[10px]">
                    <span>{Math.round(post.lastViews || 0).toLocaleString()} {t('views', 'Views')}</span>
                    <span>{Math.round(post.lastLikes || 0).toLocaleString()} {t('likes', 'Likes')}</span>
                    <span>{Math.round(post.lastComments || 0).toLocaleString()} {t('replies', 'Replies')}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <DataTable<CampaignPost>
          columns={columns}
          data={paged}
          keyExtractor={(post) => post.id}
          emptyState={{
            title: t('no_posts', 'No posts yet'),
            description: t(
              'campaign_posts_empty_hint',
              'Create a draft to start building this campaign.'
            ),
            action: (
              <Button onClick={openNewDraft} className="!h-[32px] !px-[12px] text-[13px]">
                {t('new_draft', 'New Draft')}
              </Button>
            ),
          }}
        />
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-[4px]">
          <span className="text-[12px] text-newTableText">
            {page + 1} / {totalPages}
          </span>
          <div className="flex gap-[8px]">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-[12px] py-[6px] text-[13px] bg-newBgColorInner border border-newTableBorder rounded-[8px] disabled:opacity-40"
            >
              {t('previous', 'Previous')}
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="px-[12px] py-[6px] text-[13px] bg-newBgColorInner border border-newTableBorder rounded-[8px] disabled:opacity-40"
            >
              {t('next', 'Next')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
