'use client';

import { FC, Fragment } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { PostDetail, FetchError } from './utils';
import { usePostDetail } from './hooks/usePostDetail';
import { usePostShortlinkStats } from './hooks/usePostShortlinkStats';
import { PostDetailChart } from './post.detail.chart';
import { Drawer } from './kit/drawer';
import { ChannelAvatar } from './kit/channel-avatar';

interface PostDetailBodyProps {
  postDetail?: PostDetail;
  isLoading: boolean;
  error?: Error;
  onClose: () => void;
}

// Shared post-detail presentation (header + skeleton/error/metrics/chart),
// factored out of views/posts.tab.tsx so the posts table and the calendar's
// PostAnalyticsDrawer render one source of truth.
export const PostDetailBody: FC<PostDetailBodyProps> = ({
  postDetail,
  isLoading,
  error,
  onClose,
}) => {
  const t = useT();
  return (
    <>
      <div className="sticky top-0 bg-newBgColorInner border-b border-newTableBorder px-[20px] py-[14px] flex items-center justify-between z-10">
        <h3 className="text-[16px] font-semibold truncate">
          {isLoading
            ? t('post_detail_loading', 'Loading...')
            : postDetail?.content || t('post_detail', 'Post Detail')}
        </h3>
        <button
          onClick={onClose}
          className="p-[6px] hover:bg-boxHover rounded-[6px] shrink-0"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M4 4L12 12M12 4L4 12"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
      <div className="p-[20px] space-y-[16px]">
        {isLoading && (
          <div className="animate-pulse space-y-[12px]">
            <div className="flex items-center gap-[8px]">
              <div className="w-[24px] h-[24px] rounded-[6px] bg-newTableHeader" />
              <div className="space-y-[6px]">
                <div className="w-[120px] h-[14px] bg-newTableHeader rounded-[4px]" />
                <div className="w-[180px] h-[11px] bg-newTableHeader rounded-[4px]" />
              </div>
            </div>
            <div className="space-y-[8px]">
              <div className="w-full h-[14px] bg-newTableHeader rounded-[4px]" />
              <div className="w-3/4 h-[14px] bg-newTableHeader rounded-[4px]" />
            </div>
            <div className="grid grid-cols-2 gap-[8px]">
              {[1, 2, 3, 4].map((i) => (
                <div key={`metric-skeleton-${i}`} className="h-[64px] bg-newTableHeader rounded-[8px]" />
              ))}
            </div>
          </div>
        )}
        {error && (
          <div className="flex flex-col items-center justify-center py-[24px] text-center">
            <p className="text-[var(--negative,#f97066)] text-[14px] mb-[4px]">
              {t('failed_to_load_post_details', 'Failed to load post details')}
            </p>
            <p className="text-[12px] text-newTableText opacity-60">
              {(() => {
                const fe = error as FetchError;
                return fe.messageKey ? t(fe.messageKey, fe.message) : fe.message;
              })()}
            </p>
          </div>
        )}
        {postDetail && (
          <>
            <div className="flex items-center gap-[8px]">
              <ChannelAvatar
                src={postDetail.integration.picture}
                name={postDetail.integration.name}
                identifier={postDetail.integration.identifier}
                size={24}
                className="rounded-[6px] object-cover"
              />
              <div>
                <div className="text-[14px] font-medium">
                  {postDetail.integration.name}
                </div>
                <div className="text-[11px] text-newTableText">
                  {new Date(postDetail.publishedAt).toLocaleString()}
                </div>
              </div>
            </div>
            <div className="text-[13px] leading-relaxed whitespace-pre-wrap max-h-[200px] overflow-y-auto">
              {postDetail.content}
            </div>
            <div className="grid grid-cols-2 gap-[8px]">
              {Object.entries(postDetail.metrics).map(([key, value]) => (
                <div
                  key={key}
                  className="px-[12px] py-[10px] bg-newTableHeader rounded-[8px]"
                >
                  <div className="text-[11px] text-newTableText capitalize">
                    {key}
                  </div>
                  <div className="text-[18px] font-semibold tabular-nums">
                    {new Intl.NumberFormat().format(Math.round(value))}
                  </div>
                </div>
              ))}
            </div>
            <PostDetailChart series={postDetail.series} />
          </>
        )}
      </div>
    </>
  );
};

interface PostAnalyticsDrawerProps {
  postId: string;
  open: boolean;
  onClose: () => void;
}

// Right slide-over post analytics: v2 post detail (GET /analytics/v2/post/:postId)
// plus the short-link click stats (GET /posts/:id/statistics). Replaces the
// broken StatisticsModal, which fetched a non-existent internal /analytics/post route.
export const PostAnalyticsDrawer: FC<PostAnalyticsDrawerProps> = ({
  postId,
  open,
  onClose,
}) => {
  const t = useT();
  const {
    data: postDetail,
    isLoading: postDetailLoading,
    error: postDetailError,
  } = usePostDetail(open ? postId : '');
  const { data: shortlinkStats } = usePostShortlinkStats(open ? postId : '');

  const clicks = shortlinkStats?.clicks;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      ariaLabel={postDetail?.content || t('post_detail', 'Post Detail')}
    >
      <PostDetailBody
        postDetail={postDetail}
        isLoading={postDetailLoading}
        error={postDetailError as Error | undefined}
        onClose={onClose}
      />
      {clicks && clicks.length > 0 && (
        <div className="px-[20px] pb-[20px] flex flex-col gap-[10px]">
          <h4 className="text-[14px] font-semibold">
            {t('short_links_statistics', 'Short Links Statistics')}
          </h4>
          <div className="grid grid-cols-3 text-[12px] rounded-[8px] overflow-hidden border border-newTableBorder">
            <div className="bg-newTableHeader p-[8px] font-medium">
              {t('short_link', 'Short Link')}
            </div>
            <div className="bg-newTableHeader p-[8px] font-medium">
              {t('original_link', 'Original Link')}
            </div>
            <div className="bg-newTableHeader p-[8px] font-medium text-right">
              {t('clicks', 'Clicks')}
            </div>
            {clicks.map((c) => (
              <Fragment key={`${c.short}-${c.original}`}>
                <div className="p-[8px] bg-newBgColorInner break-all">
                  {c.short}
                </div>
                <div className="p-[8px] bg-newBgColorInner break-all">
                  {c.original}
                </div>
                <div className="p-[8px] bg-newBgColorInner text-right tabular-nums">
                  {c.clicks}
                </div>
              </Fragment>
            ))}
          </div>
        </div>
      )}
    </Drawer>
  );
};
