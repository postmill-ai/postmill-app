'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { useCalendar } from './context';
import { CalendarItem } from './card';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
import { isUSCitizen } from '@gitroom/frontend/components/launches/helpers/isuscitizen.utils';
import { usePostActions } from './helpers';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useUser } from '@gitroom/frontend/components/layout/user.context';

// Mobile calendar: the SAME calendar data as every other view (same `useCalendar`
// posts/filters/window), rendered as a dense single column of the existing post
// cards — only where posts exist, so there are no empty hours to scroll past. The
// static day/time headers are replaced by ONE fixed date·time label that sits above
// the scroll area; only its text changes, updating to the post currently in view.
const DAYS_PER_PAGE = 7;

export const MobileView = () => {
  const t = useT();
  const user = useUser();
  const { integrations, loading, posts, listState } = useCalendar();
  const {
    editPost,
    deletePost,
    copyDebugJson,
    openStatistics,
    openMissingRelease,
    openPostDetail,
    changeColor,
    postAnalyticsDrawer,
  } = usePostActions();

  const emptyMessage =
    listState === 'scheduled'
      ? t('no_upcoming_posts', 'No upcoming posts scheduled')
      : listState === 'draft'
      ? t('no_draft_posts', 'No draft posts')
      : listState === 'published'
      ? t('no_published_posts', 'No published posts')
      : t('no_posts', 'No posts');

  // `posts` (filteredPosts) is NOT chronologically sorted and is engagement-sorted
  // for top_performers — so sort here: group by user-tz day, order the days, and
  // order posts within each day by publish time. Otherwise the floating label would
  // jump backwards/forwards as you scroll.
  const groupedPosts = useMemo(() => {
    const groups: { [key: string]: any[] } = {};
    posts.forEach((post) => {
      const dateKey = newDayjs(post.publishDate).format('YYYY-MM-DD');
      (groups[dateKey] = groups[dateKey] || []).push(post);
    });
    return Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([dateKey, list]) =>
          [
            dateKey,
            [...list].sort(
              (p1, p2) =>
                +new Date(p1.publishDate) - +new Date(p2.publishDate)
            ),
          ] as [string, any[]]
      );
  }, [posts]);

  // Same 7-day pagination as ListView so a busy month window stays bounded (each
  // card mounts a useDrag + an observer target). `current` = index of the card the
  // floating label reflects. Init 0 so the label is populated on mount / under jsdom.
  const [page, setPage] = useState(0);
  const [current, setCurrent] = useState(0);

  // Reset to the first page + first card when the underlying day-set changes
  // (window/filter change). Done during render — React's documented "adjust state
  // while rendering" pattern — so it never triggers a set-state-in-effect cascade.
  const daysKey = groupedPosts.map(([k]) => k).join('|');
  const [prevDaysKey, setPrevDaysKey] = useState(daysKey);
  if (daysKey !== prevDaysKey) {
    setPrevDaysKey(daysKey);
    setPage(0);
    setCurrent(0);
  }

  const totalPages = Math.max(1, Math.ceil(groupedPosts.length / DAYS_PER_PAGE));
  const safePage = Math.min(page, totalPages - 1);
  // Memoized so its reference is stable across renders — otherwise `flat` (and the
  // IntersectionObserver effect keyed on it) would rebuild on every render.
  const pageGroups = useMemo(
    () =>
      groupedPosts.slice(
        safePage * DAYS_PER_PAGE,
        safePage * DAYS_PER_PAGE + DAYS_PER_PAGE
      ),
    [groupedPosts, safePage]
  );

  // Flatten the current page to a card list, marking the first card of each day.
  const flat = useMemo(() => {
    const out: { post: any; dateKey: string; isFirstOfDay: boolean }[] = [];
    pageGroups.forEach(([dateKey, list]) => {
      list.forEach((post, i) =>
        out.push({ post, dateKey, isFirstOfDay: i === 0 })
      );
    });
    return out;
  }, [pageGroups]);

  // Floating label tracks the top-most visible card (the observer callback runs
  // async, so setCurrent here is not a synchronous set-state-in-effect).
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') {
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (!visible.length) {
          return; // keep the last value — anti-flicker guard
        }
        const top = visible.reduce((a, b) =>
          a.boundingClientRect.top < b.boundingClientRect.top ? a : b
        );
        const idx = Number((top.target as HTMLElement).dataset.index);
        if (!Number.isNaN(idx)) {
          setCurrent(idx);
        }
      },
      { root, rootMargin: '0px 0px -80% 0px', threshold: 0 }
    );
    root.querySelectorAll('[data-index]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [flat]);

  const labelPost = flat[Math.min(current, Math.max(0, flat.length - 1))]?.post;
  const labelText = labelPost
    ? newDayjs(labelPost.publishDate)
        .local()
        .format(isUSCitizen() ? 'ddd, MMM D · hh:mm A' : 'ddd, D MMM · HH:mm')
    : '';

  return (
    <div className="flex flex-col gap-[8px] flex-1 relative min-h-0">
      {postAnalyticsDrawer}
      {/* Fixed floating date·time label — lives ABOVE the scroll area (fixed height,
          never reflows); only its text changes as you scroll. Replaces static headers. */}
      <div className="shrink-0 h-[36px] flex items-center px-[10px]">
        {labelText && (
          <div className="px-[12px] h-[28px] flex items-center rounded-full bg-newTableHeader text-textColor text-[13px] font-[600]">
            {labelText}
          </div>
        )}
      </div>

      <div className="flex-1 relative min-h-0">
        <div
          ref={scrollRef}
          className="absolute inset-0 flex flex-col overflow-auto scrollbar scrollbar-thumb-fifth scrollbar-track-newBgColor"
        >
          {loading ? (
            <div className="flex-1 flex items-center justify-center text-textColor">
              {t('loading', 'Loading')}
            </div>
          ) : posts.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-textColor text-[16px]">
              {emptyMessage}
            </div>
          ) : (
            flat.map(({ post, isFirstOfDay }, index) => (
              <React.Fragment key={post.id}>
                {/* Muted, non-sticky day boundary — a thin hairline (NOT a header);
                    the authoritative date lives in the floating label above. */}
                {isFirstOfDay && index > 0 && (
                  <div className="px-[10px] pt-[10px] pb-[2px]">
                    <div className="h-px bg-newTableBorder/50" />
                  </div>
                )}
                <div data-index={index} className="px-[10px] pb-[10px]">
                  <CalendarItem
                    display="day"
                    isBeforeNow={false}
                    date={newDayjs(post.publishDate)}
                    state={post.state}
                    statistics={openStatistics(post.id)}
                    missingRelease={openMissingRelease(post.id)}
                    editPost={editPost(post, false)}
                    duplicatePost={editPost(post, true)}
                    copyDebugJson={
                      user?.isSuperAdmin ? copyDebugJson(post) : undefined
                    }
                    openPostDetail={openPostDetail(post)}
                    changeColor={changeColor(post)}
                    post={post}
                    integrations={integrations}
                    deletePost={deletePost(post)}
                    showTime={true}
                  />
                </div>
              </React.Fragment>
            ))
          )}
        </div>
      </div>

      {totalPages > 1 && (
        <div className="shrink-0 flex items-center justify-center gap-[10px] select-none text-textColor pt-[2px]">
          <div className="border h-[36px] border-newTableBorder bg-newTableBorder gap-[1px] flex items-center rounded-[8px] overflow-hidden">
            <div
              onClick={() => {
                setPage((p) => Math.max(0, p - 1));
                setCurrent(0);
              }}
              className={clsx(
                'rtl:rotate-180 px-[10px] bg-newBgColorInner h-full flex items-center justify-center',
                safePage > 0
                  ? 'cursor-pointer text-textColor hover:text-textItemFocused hover:bg-boxFocused'
                  : 'opacity-40 cursor-not-allowed text-textColor'
              )}
            >
              <svg width="8" height="12" viewBox="0 0 8 12" fill="none">
                <path
                  d="M6.5 11L1.5 6L6.5 1"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div className="min-w-[130px] text-center bg-newBgColorInner h-full flex items-center justify-center text-[13px] px-[9px]">
              {t('page_of', 'Page {{page}} of {{total}}', {
                page: String(safePage + 1),
                total: String(totalPages),
              })}
            </div>
            <div
              onClick={() => {
                setPage((p) => Math.min(totalPages - 1, p + 1));
                setCurrent(0);
              }}
              className={clsx(
                'rtl:rotate-180 px-[10px] bg-newBgColorInner h-full flex items-center justify-center',
                safePage < totalPages - 1
                  ? 'cursor-pointer text-textColor hover:text-textItemFocused hover:bg-boxFocused'
                  : 'opacity-40 cursor-not-allowed text-textColor'
              )}
            >
              <svg width="8" height="12" viewBox="0 0 8 12" fill="none">
                <path
                  d="M1.5 11L6.5 6L1.5 1"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
