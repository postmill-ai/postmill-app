'use client';

import React, { FC, Fragment, memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { useDrop } from 'react-dnd';
import { Post } from '@prisma/client';
import { useCalendar } from './context';
import dayjs from 'dayjs';
import { random } from 'lodash';
import { useInterval } from '@mantine/hooks';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useAddProvider } from '@gitroom/frontend/components/launches/add.provider.component';
import SafeImage from '@gitroom/react/helpers/safe.image';
import { usePostActions } from './helpers';
import { CalendarItem } from './card';
import { Button } from '@gitroom/react/form/button';

export const SetSelectionModal: FC<{
  sets: any[];
  onSelect: (set: any) => void;
  onContinueWithoutSet: () => void;
}> = ({ sets, onSelect, onContinueWithoutSet }) => {
  const t = useT();

  return (
    <div className="flex flex-col gap-4">
      <div className="text-lg font-medium">
        {t('choose_set_or_continue', 'Choose a set or continue without one')}
      </div>

      <div className="flex flex-col gap-2 max-h-60 overflow-y-auto">
        {sets.map((set) => (
          <button
            type="button"
            key={set.id}
            onClick={() => onSelect(set)}
            className="w-full text-left m-0 p-0 border-0 bg-transparent p-3 border border-newTableBorder rounded-lg cursor-pointer hover:transition-colors"
          >
            <div className="font-medium">{set.name}</div>
            {set.description && (
              <div className="text-sm text-gray-400 mt-1">
                {set.description}
              </div>
            )}
          </button>
        ))}
      </div>

      <div className="flex gap-2 pt-2 border-t border-newTableBorder">
        <button
          onClick={onContinueWithoutSet}
          className="flex-1 px-4 py-2 text-textColor rounded-lg hover:transition-colors"
        >
          {t('continue_without_set', 'Continue without set')}
        </button>
      </div>
    </div>
  );
};

const CalendarColumn: FC<{
  getDate: dayjs.Dayjs;
  randomHour?: boolean;
}> = memo((props) => {
  const t = useT();

  const { getDate, randomHour } = props;
  const [now, setNow] = useState(() => newDayjs());
  const user = useUser();
  const {
    integrations,
    posts,
    changeDate,
    display,
    reloadCalendarView,
    sets,
    signature,
    loading,
  } = useCalendar();
  const modal = useModals();
  const toaster = useToaster();
  const fetch = useFetch();

  const { editPost, deletePost, copyDebugJson, openStatistics, openMissingRelease, openPostDetail, changeColor, postAnalyticsDrawer } = usePostActions();
  const postList = useMemo(() => {
    return posts.filter((post) => {
      const pList = newDayjs(post.publishDate);
      const check =
        display === 'day'
          ? pList.format('YYYY-MM-DD HH:mm') ===
            getDate.format('YYYY-MM-DD HH:mm')
          : display === 'week'
          ? pList.isSameOrAfter(getDate.startOf('hour')) &&
            pList.isBefore(getDate.endOf('hour'))
          : pList.format('DD/MM/YYYY') === getDate.format('DD/MM/YYYY');
      return check;
    });
  }, [posts, display, getDate]);
  const [showAll, setShowAll] = useState(false);
  const showAllFunc = useCallback(() => {
    setShowAll(true);
  }, []);
  const showLessFunc = useCallback(() => {
    setShowAll(false);
  }, []);
  const list = useMemo(() => {
    if (showAll) {
      return postList;
    }
    return postList.slice(0, 3);
  }, [postList, showAll]);

  const isBeforeNow = useMemo(() => {
    const originalUtc = getDate.startOf('hour');
    return originalUtc.startOf('hour').isBefore(now.startOf('hour').utc());
  }, [getDate, now]);

  const { start, stop } = useInterval(
    useCallback(() => {
      if (isBeforeNow) {
        return;
      }
      setNow(newDayjs());
    }, [isBeforeNow]),
    random(120000, 150000)
  );

  useEffect(() => {
    start();
    return () => {
      stop();
    };
  }, [start, stop]);
  const [{ canDrop }, drop] = useDrop(() => ({
    accept: 'post',
    drop: async (item: any) => {
      if (isBeforeNow) return;

      const post = posts.find((p) => p.id === item.id);
      let action: 'schedule' | 'update' = 'schedule';

      if (
        post &&
        (post.state === 'PUBLISHED' ||
          (post.state === 'QUEUE' && newDayjs().isAfter(newDayjs(post.publishDate))))
      ) {
        const whatToDo = await new Promise<'schedule' | 'update' | 'cancel'>(
          (resolve) => {
            modal.openModal({
              title: t('what_do_you_want_to_do', 'What do you want to do?'),
              children: (
                <div className="flex flex-col">
                  <div className="text-[20px] mb-[20px]">
                    {t(
                      'post_already_published_drag',
                      'This post was already published, what do you want to do?'
                    )}
                  </div>
                  <div className="flex w-full gap-[10px]">
                    <div className="flex-1 flex">
                      <Button
                        type="button"
                        className="flex-1"
                        onClick={() => {
                          modal.closeAll();
                          resolve('update');
                        }}
                      >
                        {t('just_update_post_details', 'Just update the post details')}
                      </Button>
                    </div>
                    <div className="flex-1 flex">
                      <Button
                        type="button"
                        className="flex-1"
                        onClick={() => {
                          modal.closeAll();
                          resolve('schedule');
                        }}
                      >
                        {t('reschedule_post', 'Reschedule the post')}
                      </Button>
                    </div>
                  </div>
                </div>
              ),
              onClose: () => resolve('cancel'),
            });
          }
        );

        if (whatToDo === 'cancel') {
          return;
        }
        action = whatToDo;
      }

      // Whole-day cells (month view) render `getDate` at 23:59:59 — preserve the
      // dragged post's original time-of-day instead of snapping to end-of-day.
      let targetDate = getDate;
      if (display === 'month' && post) {
        const orig = newDayjs(post.publishDate);
        targetDate = getDate
          .startOf('day')
          .hour(orig.hour())
          .minute(orig.minute());
      }

      if (!item.interval) {
        changeDate(item.id, targetDate);
      }
      try {
        const res = await fetch(`/posts/${item.id}/date`, {
          method: 'PUT',
          body: JSON.stringify({
            date: targetDate.utc().format('YYYY-MM-DDTHH:mm:ss'),
            action,
          }),
        });
        if (!res.ok) {
          // Any non-2xx (500, 403/402/409/CSRF, …) is a failure: revert the
          // optimistic move and surface the server message.
          let message = t('failed_to_reschedule', 'Failed to reschedule the post');
          try {
            const body = await res.json();
            if (body?.message) {
              message = Array.isArray(body.message)
                ? body.message.join(', ')
                : body.message;
            }
          } catch {
            // non-JSON error body — keep the generic message
          }
          toaster.show(message, 'warning');
          reloadCalendarView();
          return;
        }
        if (item.interval || action === 'schedule') {
          reloadCalendarView();
        }
      } catch {
        // Network error — useFetch does not throw for HTTP status, so this is a
        // genuine connection failure. Revert the optimistic move.
        toaster.show(
          t('network_error_try_again', 'Network error, please try again'),
          'warning'
        );
        reloadCalendarView();
      }
    },
    collect: (monitor) => ({
      canDrop: isBeforeNow ? false : !!monitor.canDrop() && !!monitor.isOver(),
    }),
  }), [posts, isBeforeNow, changeDate, getDate, display, fetch, modal, toaster, t, reloadCalendarView]);

  const router = useRouter();
  const addModal = useCallback(async () => {
    const set: any = !sets.length
      ? undefined
      : await new Promise((resolve) => {
          modal.openModal({
            title: t('select_set', 'Select a Set'),
            closeOnClickOutside: true,
            askClose: false,
            closeOnEscape: true,
            withCloseButton: true,
            onClose: () => resolve('exit'),
            children: (
              <SetSelectionModal
                sets={sets}
                onSelect={(selectedSet) => {
                  resolve(selectedSet);
                  modal.closeAll();
                }}
                onContinueWithoutSet={() => {
                  resolve(undefined);
                  modal.closeAll();
                }}
              />
            ),
          });
        });

    if (set === 'exit') return;

    const date =
      randomHour
        ? getDate.hour(Math.floor(Math.random() * 24))
        : getDate.format('YYYY-MM-DDTHH:mm:ss') ===
          newDayjs().startOf('hour').format('YYYY-MM-DDTHH:mm:ss')
        ? newDayjs().add(10, 'minute')
        : getDate;

    const params = new URLSearchParams();
    params.set('date', date.format('YYYY-MM-DDTHH:mm:ss'));

    if (set?.content) {
      try {
        const parsedSet = JSON.parse(set.content);
        if (parsedSet?.posts?.[0]?.value?.[0]?.content) {
          params.set(
            'content',
            encodeURIComponent(parsedSet.posts[0].value[0].content)
          );
        }
      } catch {
        // Malformed Set.content — fall back to opening the composer with no prefill.
      }
    }

    if (signature?.id && !set) {
      params.set('content', encodeURIComponent('\n' + signature.content));
    }

    router.push(`/posts/post?${params.toString()}`);
  }, [getDate, sets, signature, router, modal, randomHour, t]);

  const addProvider = useAddProvider();
  return (
    <div
      className={clsx(
        'flex flex-col w-full min-h-full relative',
        isBeforeNow && 'repeated-strip',
        loading && 'animate-pulse',
        isBeforeNow
          ? 'cursor-not-allowed'
          : 'border border-newTextColor/5 rounded-[8px]'
      )}
      ref={drop as any}
    >
      {postAnalyticsDrawer}
      {display === 'month' && (
        <div className={clsx('pt-[6px] text-[14px]')}>{getDate.date()}</div>
      )}
      <div
        className={clsx(
          'relative flex flex-col flex-1 text-white rounded-[8px] min-h-[60px]',
          canDrop && 'border border-[#2B5CD3]'
        )}
      >
        <div
          className={clsx(
            'flex-col text-[12px] pointer w-full flex scrollbar scrollbar-thumb-tableBorder scrollbar-track-secondary',
            isBeforeNow ? 'flex-1' : 'cursor-pointer',
            isBeforeNow && postList.length === 0 && 'col-calendar'
          )}
        >
          {loading && (
            <div className="h-full w-full p-[5px] animate-pulse absolute left-0 top-0 z-[50]">
              <div className="h-full w-full bg-newSettings rounded-[10px]" />
            </div>
          )}
          {list.map((post) => (
            <div
              key={post.id}
              className={clsx(
                'text-textColor p-[2.5px] relative flex flex-col justify-center items-center'
              )}
            >
              <div className="relative w-full flex flex-col items-center p-[2.5px]">
                <CalendarItem
                  display={display as 'day' | 'week' | 'month'}
                  isBeforeNow={isBeforeNow}
                  date={getDate}
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
                />
              </div>
            </div>
          ))}
          {!showAll && postList.length > 3 && (
            <button
              type="button"
              className="w-full text-center hover:underline py-[5px] text-textColor m-0 p-0 border-0 bg-transparent"
              onClick={showAllFunc}
            >
              {t('show_more', '+ Show more')} ({postList.length - 3})
            </button>
          )}
          {showAll && postList.length > 3 && (
            <button
              type="button"
              className="w-full text-center hover:underline py-[5px] m-0 p-0 border-0 bg-transparent"
              onClick={showLessFunc}
            >
              {t('show_less', '- Show less')}
            </button>
          )}
        </div>
        {!isBeforeNow && (
          <button
            type="button"
            aria-label={t('add_post', 'Add post in a thread')}
            className="pb-[2.5px] px-[5px] flex-1 flex m-0 p-0 border-0 bg-transparent"
            onClick={integrations.length ? addModal : addProvider}
          >
            <div
              className={clsx(
                display === ('month' as any)
                  ? 'flex-1 min-h-[40px] w-full'
                  : !postList.length
                  ? 'min-h-full w-full p-[5px]'
                  : 'min-h-[40px] w-full',
                'flex items-center justify-center cursor-pointer pb-[2.5px]'
              )}
            >
              {display !== 'day' && (
                <div
                  className={clsx(
                    'group hover:before:h-[30px] w-full h-full rounded-[10px] flex justify-center items-center text-white'
                  )}
                >
                  <div
                    className={`group-hover:before:content-["+"] pb-[5px] flex justify-center items-center rounded-[8px] transition-all group-hover:bg-btnPrimary w-full h-full max-w-[40px] max-h-[40px]`}
                  />
                </div>
              )}
              {display === 'day' && (
                <div
                  className={`w-full h-full rounded-[10px] py-[10px] flex-wrap hover:border hover:border-seventh flex justify-center items-center gap-[20px] opacity-30 grayscale hover:grayscale-0 hover:opacity-100`}
                >
                  {integrations.map((selectedIntegrations) => (
                    <div
                      className="relative"
                      key={selectedIntegrations.identifier}
                    >
                      <div
                        className={clsx(
                          'relative w-[34px] h-[34px] rounded-[8px] flex justify-center items-center filter transition-all duration-500'
                        )}
                      >
                        <SafeImage
                          src={
                            selectedIntegrations.picture || '/no-picture.jpg'
                          }
                          className="rounded-[8px]"
                          alt={selectedIntegrations.identifier}
                          width={32}
                          height={32}
                        />
                        {selectedIntegrations.identifier === 'youtube' ? (
                          <SafeImage
                            src="/icons/platforms/youtube.svg"
                            alt={selectedIntegrations.identifier}
                            className="absolute z-10 -bottom-[5px] -end-[5px]"
                            width={20}
                          />
                        ) : (
                          <SafeImage
                            src={`/icons/platforms/${selectedIntegrations.identifier}.png`}
                            className="rounded-[8px] absolute z-10 -bottom-[5px] -end-[5px] border border-newTableBorder"
                            alt={selectedIntegrations.identifier}
                            width={20}
                            height={20}
                          />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </button>
        )}
      </div>
    </div>
  );
});

CalendarColumn.displayName = 'CalendarColumn';
export { CalendarColumn };
