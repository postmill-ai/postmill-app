'use client';

import React, { FC, memo, useCallback } from 'react';
import clsx from 'clsx';
import Image from 'next/image';
import { useDrag } from 'react-dnd';
import { Post, State, Tags, Integration } from '@prisma/client';
import type { Integrations } from './context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
import { isUSCitizen } from '@gitroom/frontend/components/launches/helpers/isuscitizen.utils';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { CreationMethodBadge } from '@gitroom/frontend/components/launches/creation.method.badge';
import {
  formatCompactNumber,
  ViewsIcon,
  LikesIcon,
  CommentsIcon,
} from './helpers';
import {
  KebabMenu,
  KebabMenuItem,
} from '@gitroom/frontend/components/ui/kebab-menu';
import dayjs from 'dayjs';

export const CalendarItem: FC<{
  date: dayjs.Dayjs;
  isBeforeNow: boolean;
  editPost: () => void;
  duplicatePost: () => void;
  copyDebugJson?: () => void;
  deletePost: () => void;
  statistics: () => void;
  missingRelease?: () => void;
  openPostDetail: (e: React.MouseEvent) => void;
  changeColor: () => void;
  integrations: Integrations[];
  state: State;
  display: 'day' | 'week' | 'month';
  showTime?: boolean;
  post: Post & {
    integration: Integration;
    color?: string | null;
    tags: {
      tag: Tags;
    }[];
    lastViews?: number | null;
    lastLikes?: number | null;
    lastComments?: number | null;
    commentCount?: number;
    unreadComments?: number;
  };
}> = memo(function CalendarItem(props) {
  const t = useT();
  const {
    editPost,
    statistics,
    duplicatePost,
    copyDebugJson,
    post,
    date,
    isBeforeNow,
    state,
    display,
    deletePost,
    showTime,
    missingRelease,
    openPostDetail,
    changeColor,
  } = props;
  // Per-post heading colour (falls back to a tag colour, then the default primary blue).
  const headerColor = post.color || post?.tags?.[0]?.tag?.color;
  const { disableXAnalytics } = useVariables();
  const user = useUser();
  const showCreationMethodBadge =
    user?.impersonate &&
    post.creationMethod &&
    post.creationMethod !== 'UNKNOWN';
  const preview = useCallback(() => {
    window.open(`/p/` + post.id + '?share=true', '_blank');
  }, [post]);
  const [{ opacity }, dragRef] = useDrag(
    () => ({
      type: 'post',
      item: {
        id: post.id,
        interval: !!post.intervalInDays,
        date,
      },
      collect: (monitor) => ({
        opacity: monitor.isDragging() ? 0 : 1,
      }),
    }),
    [post.id, post.intervalInDays, date]
  );

  // Card actions — a visible kebab menu (was hover-only icons, unusable on touch).
  const actionItems: KebabMenuItem[] = [
    { label: t('edit_post', 'Edit Post'), onClick: editPost },
    { label: t('duplicate_post', 'Duplicate Post'), onClick: duplicatePost },
    { label: t('preview_post', 'Preview Post'), onClick: preview },
  ];
  const analyticsHidden =
    (post.integration.providerIdentifier === 'x' && disableXAnalytics) ||
    !post.releaseId;
  if (!analyticsHidden) {
    if (post.releaseId === 'missing' && missingRelease) {
      actionItems.push({
        label: t('link_release', 'Link to published post'),
        onClick: missingRelease,
      });
    } else if (post.releaseId !== 'missing') {
      actionItems.push({ label: t('statistics', 'Statistics'), onClick: statistics });
    }
  }
  if (copyDebugJson) {
    actionItems.push({
      label: t('copy_debug_json', 'Copy debug JSON'),
      onClick: copyDebugJson,
    });
  }
  actionItems.push({
    label: t('change_color', 'Change color'),
    onClick: changeColor,
  });
  actionItems.push({ divider: true });
  actionItems.push({
    label: t('delete_post', 'Delete Post'),
    onClick: deletePost,
    danger: true,
  });

  return (
    <div
      // @ts-ignore
      ref={dragRef}
      className={clsx(
        'w-full flex h-full flex-1 flex-col group',
        'relative',
        state === 'ERROR' && 'rounded-[10px] ring-2 ring-red-500'
      )}
      style={{
        opacity,
      }}
    >
      {state === 'ERROR' && (
        <div
          className="absolute -top-[6px] -left-[6px] z-20 w-[18px] h-[18px] rounded-full bg-red-500 flex items-center justify-center text-white text-[11px] font-bold cursor-pointer"
          data-tooltip-id="tooltip"
          data-tooltip-content={
            post.error ||
            t(
              'post_error_occurred',
              'An error occurred while publishing this post'
            )
          }
        >
          !
        </div>
      )}
      {(post.unreadComments || 0) > 0 && (
        <div
          className="absolute -top-[6px] -end-[6px] z-20 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1"
          data-tooltip-id="tooltip"
          data-tooltip-content={t('unread_comments', '{{count}} unread reply', {
            count: post.unreadComments,
          })}
        >
          {post.unreadComments > 99 ? '99+' : post.unreadComments}
        </div>
      )}
      {showCreationMethodBadge && (
        <div className="absolute -bottom-[4px] -right-[4px] z-10">
          <CreationMethodBadge
            creationMethod={post.creationMethod}
            ringColor="var(--new-bgColor)"
          />
        </div>
      )}
      <div
        className={clsx(
          'text-white text-[11px] max-h-[24px] h-[24px] min-h-[24px] w-full rounded-tr-[10px] rounded-tl-[10px] flex items-center justify-between gap-[4px] ps-[8px] pe-[3px] bg-btnPrimary'
        )}
        style={{
          backgroundColor: headerColor,
        }}
      >
        <div
          className={clsx(headerColor ? 'mix-blend-difference' : '', 'truncate')}
        >
          {post.tags.map((p) => p.tag.name).join(', ')}
        </div>
        <KebabMenu
          ariaLabel={t('post_actions', 'Post actions')}
          align="right"
          size={20}
          width={188}
          items={actionItems}
          triggerClassName={clsx(
            '!text-white hover:!bg-white/25',
            headerColor && 'mix-blend-difference'
          )}
        />
      </div>
      <div
        onClick={openPostDetail}
        className={clsx(
          'gap-[5px] w-full flex h-full flex-1 rounded-br-[10px] rounded-bl-[10px] p-[8px] text-[14px] bg-newColColor cursor-pointer',
          'relative',
          isBeforeNow && '!grayscale'
        )}
      >
        <div className={clsx('relative min-w-[20px]')}>
          {/* eslint-disable-next-line @next/next/no-img-element -- external channel avatar */}
          <img
            alt=""
            className="w-[20px] h-[20px] rounded-[8px]"
            src={post.integration.picture! || '/no-picture.jpg'}
          />
          <Image
            alt=""
            className="w-[12px] h-[12px] rounded-[8px] absolute z-10 top-[10px] end-0 border border-newTableBorder"
            src={`/icons/platforms/${post.integration?.providerIdentifier}.png`}
            width={12}
            height={12}
          />
        </div>
        <div className="w-full flex-1 flex flex-col min-h-[40px] gap-[2px]">
          <div className="flex items-center gap-[6px] flex-wrap">
            <div className="text-start text-[12px]">
              {state === 'DRAFT' ? t('draft', 'Draft') + ': ' : ''}
            </div>
            {state === 'PUBLISHED' && (
              <div className="inline-flex items-center gap-[3px] bg-green-500 text-white text-[10px] px-[5px] py-[1px] rounded-full leading-[14px]">
                <div className="w-[4px] h-[4px] rounded-full bg-white" />
                {t('published', 'Published')}
              </div>
            )}
            {state === 'QUEUE' && (
              <div className="inline-flex items-center gap-[3px] bg-blue-500 text-white text-[10px] px-[5px] py-[1px] rounded-full leading-[14px]">
                <div className="w-[4px] h-[4px] rounded-full bg-white" />
                {t('scheduled', 'Scheduled')}
              </div>
            )}
            {state === 'DRAFT' && (
              <div className="inline-flex items-center gap-[3px] bg-amber-500 text-white text-[10px] px-[5px] py-[1px] rounded-full leading-[14px]">
                <div className="w-[4px] h-[4px] rounded-full bg-white" />
                {t('draft', 'Draft')}
              </div>
            )}
          </div>
            <div className="w-full text-ellipsis break-words line-clamp-1 text-start min-h-[18px]">
              {stripHtmlValidation('none', post.content, false, true, false) ||
                t('no_content', 'no content')}
            </div>
          {(post.lastViews !== undefined && post.lastViews !== null) ||
          (post.lastLikes !== undefined && post.lastLikes !== null) ||
          (post.lastComments !== undefined && post.lastComments !== null) ||
          post.commentCount ? (
            <div className="flex items-center gap-3 mt-2 text-[12px] text-textColor">
              {post.lastViews !== undefined && post.lastViews !== null && (
                <span className="flex items-center gap-1" title={t('views', 'Views')} aria-label={t('views', 'Views')}>
                  <ViewsIcon /> {formatCompactNumber(post.lastViews)}
                </span>
              )}
              {post.lastLikes !== undefined && post.lastLikes !== null && (
                <span className="flex items-center gap-1" title={t('likes', 'Likes')} aria-label={t('likes', 'Likes')}>
                  <LikesIcon /> {formatCompactNumber(post.lastLikes)}
                </span>
              )}
              {post.lastComments !== undefined && post.lastComments !== null ? (
                <span className="flex items-center gap-1" title={t('replies', 'Replies')} aria-label={t('replies', 'Replies')}>
                  <CommentsIcon /> {formatCompactNumber(post.lastComments)}
                </span>
              ) : post.commentCount ? (
                <span className="flex items-center gap-1" title={t('replies', 'Replies')} aria-label={t('replies', 'Replies')}>
                  <CommentsIcon /> {formatCompactNumber(post.commentCount)}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        {showTime && (
          <div className="text-textColor/50 text-[12px] whitespace-nowrap flex items-center">
            {newDayjs(post.publishDate).local().format(isUSCitizen() ? 'hh:mm A' : 'HH:mm')}
          </div>
        )}
      </div>
    </div>
  );
}, arePropsEqual);

// The grid passes a fresh curried lambda for every action handler on each render
// (e.g. `editPost(post, false)`), plus a fresh `getDate` dayjs — which defeats the
// default shallow `memo` and re-renders (and re-registers `useDrag` on) every card
// whenever any calendar context value changes (a few hundred cards per keystroke in
// the filter search). Those handlers are semantically stable for a given post, so we
// compare the meaningful inputs (post identity + the primitive/value props) and skip
// re-render otherwise. `post` keeps object identity across filter re-renders; a data
// refresh mints new post objects, so a genuine change still re-renders.
function arePropsEqual(
  prev: React.ComponentProps<typeof CalendarItem>,
  next: React.ComponentProps<typeof CalendarItem>
) {
  return (
    prev.post === next.post &&
    prev.state === next.state &&
    prev.display === next.display &&
    prev.isBeforeNow === next.isBeforeNow &&
    prev.showTime === next.showTime &&
    prev.integrations === next.integrations &&
    prev.date.valueOf() === next.date.valueOf()
  );
}
