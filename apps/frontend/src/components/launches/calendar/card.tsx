'use client';

import React, { FC, memo, useCallback } from 'react';
import clsx from 'clsx';
import Image from 'next/image';
import { useDrag } from 'react-dnd';
import { Post, State, Tags, Integration } from '@prisma/client';
import type { Integrations } from './context';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { readableTextColor } from '@postmill-ai/frontend/components/shared/readable-text-color';
import { useMediaDirectory } from '@postmill-ai/react/helpers/use.media.directory';
import { VideoOrImage } from '@postmill-ai/react/helpers/video.or.image';
import { stripHtmlValidation } from '@postmill-ai/helpers/utils/strip.html.validation';
import { isVideoPath } from '@postmill-ai/helpers/utils/video.extensions';
import { newDayjs } from '@postmill-ai/frontend/components/layout/set.timezone';
import { isUSCitizen } from '@postmill-ai/frontend/components/launches/helpers/isuscitizen.utils';
import { useVariables } from '@postmill-ai/react/helpers/variable.context';
import { useUser } from '@postmill-ai/frontend/components/layout/user.context';
import { CreationMethodBadge } from '@postmill-ai/frontend/components/launches/creation.method.badge';
import {
  formatCompactNumber,
  ViewsIcon,
  LikesIcon,
  CommentsIcon,
} from './helpers';
import {
  KebabMenu,
  KebabMenuItem,
} from '@postmill-ai/frontend/components/ui/kebab-menu';
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
    thumb?: { path: string; count: number } | null;
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
  // WCAG-AA readable text on the coloured header band (was mix-blend-difference,
  // which could land on mid-contrast text).
  const headerTextColor = headerColor ? readableTextColor(headerColor) : '#ffffff';
  const mediaDir = useMediaDirectory();
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

  // Mini-post identity: the channel's real handle when it provides one. Page-style
  // profiles with whitespace (e.g. a Facebook page name) are shown as-is — they are
  // display names, not handles. No profile → no handle row segment (never a
  // placeholder handle).
  const profile = post.integration?.profile;
  const handle = profile
    ? profile.startsWith('@') || /\s/.test(profile)
      ? profile
      : `@${profile}`
    : undefined;

  // Publishing status as a coloured dot in the header band — green is published,
  // red is failed (tooltip carries the error), blue is scheduled/publishing.
  const statusDot = (() => {
    switch (state) {
      case 'PUBLISHED':
        return { cls: 'bg-green-500', tip: t('published', 'Published') };
      case 'QUEUE':
        return { cls: 'bg-blue-500', tip: t('scheduled', 'Scheduled') };
      case 'PUBLISHING':
        return {
          cls: 'bg-blue-500 animate-pulse',
          tip: t('publishing', 'Publishing'),
        };
      case 'ERROR':
        return {
          cls: 'bg-red-500',
          tip:
            post.error ||
            t(
              'post_error_occurred',
              'An error occurred while publishing this post'
            ),
        };
      case 'DRAFT':
        return { cls: 'bg-amber-500', tip: t('draft', 'Draft') };
      default:
        return null;
    }
  })();

  const hasStats =
    (post.lastViews !== undefined && post.lastViews !== null) ||
    (post.lastLikes !== undefined && post.lastLikes !== null) ||
    (post.lastComments !== undefined && post.lastComments !== null) ||
    !!post.commentCount;

  return (
    <div
      // @ts-ignore
      ref={dragRef}
      className={clsx(
        // text-left: past-day cells sit inside a `text-center` overlay wrapper —
        // keep every row of the mini post left-aligned regardless. No
        // overflow-hidden here: the unread/error/creation badges hang over the
        // card edges; the band and body carry the rounding instead.
        'w-full flex flex-col group relative rounded-[10px] text-left',
        state === 'ERROR' && 'ring-2 ring-red-500'
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
      {/* Header band: tag names · status dot · time · actions. */}
      <div
        className="h-[20px] min-h-[20px] w-full rounded-tr-[10px] rounded-tl-[10px] flex items-center justify-between gap-[4px] ps-[6px] pe-[2px] bg-btnPrimary"
        style={{
          backgroundColor: headerColor,
          color: headerTextColor,
        }}
      >
        <div className="truncate min-w-0 text-[9px] font-medium leading-[20px]">
          {post.tags.map((p) => p.tag.name).join(', ')}
        </div>
        <div className="flex items-center gap-[3px] shrink-0">
          {statusDot && (
            <span
              className={clsx('w-[6px] h-[6px] rounded-full', statusDot.cls)}
              data-tooltip-id="tooltip"
              data-tooltip-content={statusDot.tip}
            />
          )}
          {showTime && (
            <span className="text-[9px] leading-none opacity-80 whitespace-nowrap">
              {newDayjs(post.publishDate)
                .local()
                .format(isUSCitizen() ? 'hh:mm A' : 'HH:mm')}
            </span>
          )}
          <KebabMenu
            ariaLabel={t('post_actions', 'Post actions')}
            align="right"
            size={16}
            width={188}
            items={actionItems}
            triggerClassName={clsx(
              '!text-inherit',
              headerTextColor === '#000000'
                ? 'hover:!bg-black/10'
                : 'hover:!bg-white/25'
            )}
          />
        </div>
      </div>
      {/* Mini post body: identity · content · media · stats. Vertical stack with
          every row truncating/clamping — nothing can overflow the card. */}
      <div
        onClick={openPostDetail}
        className={clsx(
          'w-full flex flex-col gap-[3px] p-[5px] rounded-br-[10px] rounded-bl-[10px] bg-newColColor cursor-pointer',
          // Muted style only for missed QUEUE/DRAFT slots — published and
          // failed posts keep full colour.
          isBeforeNow && (state === 'QUEUE' || state === 'DRAFT') && '!grayscale'
        )}
      >
        <div className="flex items-center gap-[4px] min-w-0">
          <div className="relative shrink-0 w-[18px] h-[18px]">
            {/* eslint-disable-next-line @next/next/no-img-element -- external channel avatar */}
            <img
              alt=""
              className="w-[18px] h-[18px] rounded-full"
              src={post.integration.picture! || '/no-picture.jpg'}
            />
            <Image
              alt=""
              className="w-[9px] h-[9px] rounded-full absolute z-10 -bottom-[2px] -end-[2px] border border-newTableBorder"
              src={`/icons/platforms/${post.integration?.providerIdentifier}.png`}
              width={9}
              height={9}
            />
          </div>
          <div className="shrink-0 max-w-[55%] truncate text-[10px] font-semibold leading-[12px]">
            {post.integration.name}
          </div>
          {handle && (
            <div className="flex-1 min-w-0 truncate text-[9px] leading-[12px] text-textColor/60">
              {handle}
            </div>
          )}
        </div>
        <div className="min-w-0 text-[10px] leading-[13px] whitespace-pre-wrap break-words line-clamp-3">
          {stripHtmlValidation('none', post.content, false, true, false) ||
            t('no_content', 'no content')}
        </div>
        {post.thumb && (
          <div className="relative shrink-0 w-full h-[56px] rounded-[6px] overflow-hidden border border-newTableBorder">
            <VideoOrImage
              autoplay={false}
              src={mediaDir.set(post.thumb.path)}
              videoClassName="object-cover"
            />
            {/* Videos without a poster render a black first frame — a play
                badge makes the strip read as a video either way. */}
            {isVideoPath(post.thumb.path) && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-[18px] h-[18px] rounded-full bg-black/60 flex items-center justify-center">
                  <svg width="7" height="8" viewBox="0 0 7 8" fill="white" aria-hidden="true">
                    <path d="M1 0.8l5 3.2-5 3.2V0.8z" />
                  </svg>
                </div>
              </div>
            )}
            {post.thumb.count > 1 && (
              <div className="absolute bottom-[2px] end-[2px] bg-black/60 text-white text-[8px] px-[3px] rounded-full leading-[11px]">
                +{post.thumb.count - 1}
              </div>
            )}
          </div>
        )}
        {hasStats && (
          <div className="flex items-center gap-[6px] overflow-hidden whitespace-nowrap text-[9px] leading-[12px] text-textColor/70 [&_svg]:h-[9px] [&_svg]:w-[9px]">
            {post.lastViews !== undefined && post.lastViews !== null && (
              <span
                className="flex items-center gap-[2px] shrink-0"
                title={t('views', 'Views')}
                aria-label={t('views', 'Views')}
              >
                <ViewsIcon /> {formatCompactNumber(post.lastViews)}
              </span>
            )}
            {post.lastLikes !== undefined && post.lastLikes !== null && (
              <span
                className="flex items-center gap-[2px] shrink-0"
                title={t('likes', 'Likes')}
                aria-label={t('likes', 'Likes')}
              >
                <LikesIcon /> {formatCompactNumber(post.lastLikes)}
              </span>
            )}
            {post.lastComments !== undefined && post.lastComments !== null ? (
              <span
                className="flex items-center gap-[2px] shrink-0"
                title={t('replies', 'Replies')}
                aria-label={t('replies', 'Replies')}
              >
                <CommentsIcon /> {formatCompactNumber(post.lastComments)}
              </span>
            ) : post.commentCount ? (
              <span
                className="flex items-center gap-[2px] shrink-0"
                title={t('replies', 'Replies')}
                aria-label={t('replies', 'Replies')}
              >
                <CommentsIcon /> {formatCompactNumber(post.commentCount)}
              </span>
            ) : null}
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
