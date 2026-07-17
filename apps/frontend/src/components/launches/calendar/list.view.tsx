'use client';

import React, { Fragment, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useCalendar } from './context';
import { CalendarItem } from './card';
import dayjs from 'dayjs';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
import { isUSCitizen } from '@gitroom/frontend/components/launches/helpers/isuscitizen.utils';
import { usePostActions } from './helpers';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useUser } from '@gitroom/frontend/components/layout/user.context';

export const ListView = () => {
  const t = useT();
  const user = useUser();
  const { integrations, loading, posts, listState } = useCalendar();
  const emptyMessage =
    listState === 'scheduled'
      ? t('no_upcoming_posts', 'No upcoming posts scheduled')
      : listState === 'draft'
      ? t('no_draft_posts', 'No draft posts')
      : listState === 'published'
      ? t('no_published_posts', 'No published posts')
      : t('no_posts', 'No posts');

  const { editPost, deletePost, copyDebugJson, openStatistics, openMissingRelease, openPostDetail, changeColor, postAnalyticsDrawer } = usePostActions();

  // The list renders the same date-range window as the calendar. Both the state
  // filter (Scheduled/Draft/Published) and engagement filter are already applied
  // upstream in the context, so `posts` is the final set to show here.
  const groupedPosts = useMemo(() => {
    const groups: { [key: string]: any[] } = {};
    posts.forEach((post) => {
      // newDayjs renders in the user's timezone, so days group by the user's local date.
      const dateKey = newDayjs(post.publishDate).format('YYYY-MM-DD');
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(post);
    });
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [posts]);

  // Client-side pagination over the current window: one week (7 days) of dates
  // per page. Does not touch the window/filters — a month window just spans
  // multiple pages.
  const DAYS_PER_PAGE = 7;
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(groupedPosts.length / DAYS_PER_PAGE));
  // Clamp the page in case the underlying set shrinks (window/filters); no
  // effect-derived reset is needed because `safePage` is derived from state.
  const safePage = Math.min(page, totalPages - 1);
  const pageGroups = groupedPosts.slice(
    safePage * DAYS_PER_PAGE,
    safePage * DAYS_PER_PAGE + DAYS_PER_PAGE
  );

  return (
    <div className="flex flex-col gap-[10px] flex-1 relative min-h-0">
      {postAnalyticsDrawer}
      <div className="flex-1 relative">
        <div className="absolute inset-0 flex flex-col overflow-auto scrollbar scrollbar-thumb-fifth scrollbar-track-newBgColor">
          {loading ? (
            <div className="flex-1 flex items-center justify-center text-textColor">
              {t('loading', 'Loading')}
            </div>
          ) : posts.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-textColor text-[16px]">
              {emptyMessage}
            </div>
          ) : (
            pageGroups.map(([dateKey, datePosts]) => (
              <Fragment key={dateKey}>
                <div className="text-start px-[10px] text-[14px] min-h-[21px] text-textColor font-[600] mt-[10px] mb-[6px]">
                  {newDayjs(dateKey).format(isUSCitizen() ? 'dddd, MMMM D, YYYY' : 'dddd, D MMMM YYYY')}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-[10px] mb-[20px] px-[10px] items-start">
                  {datePosts.map((post) => (
                    <CalendarItem
                      key={post.id}
                      display="day"
                      isBeforeNow={false}
                      date={newDayjs(post.publishDate)}
                      state={post.state}
                      statistics={openStatistics(post.id)}
                      missingRelease={openMissingRelease(post.id)}
                      editPost={editPost(post, false)}
                      duplicatePost={editPost(post, true)}
                      copyDebugJson={user?.isSuperAdmin ? copyDebugJson(post) : undefined}
                      openPostDetail={openPostDetail(post)}
                      changeColor={changeColor(post)}
                      post={post}
                      integrations={integrations}
                      deletePost={deletePost(post)}
                      showTime={true}
                    />
                  ))}
                </div>
              </Fragment>
            ))
          )}
        </div>
      </div>

      {totalPages > 1 && (
        <div className="shrink-0 flex items-center justify-center gap-[10px] select-none text-textColor pt-[4px]">
          <div className="border h-[36px] border-newTableBorder bg-newTableBorder gap-[1px] flex items-center rounded-[8px] overflow-hidden">
            <div
              onClick={() => setPage((p) => Math.max(0, p - 1))}
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
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
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
