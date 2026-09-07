'use client';

import { FC, useCallback, useState } from 'react';
import Link from 'next/link';
import useSWR, { useSWRConfig } from 'swr';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import ReactLoading from '@postmill-ai/frontend/components/layout/loading';
import {
  NotificationItem,
  NotificationRow,
} from '@postmill-ai/frontend/components/notifications/notification.component';

interface PaginatedNotifications {
  notifications: NotificationItem[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

/**
 * Full notification manager (/notifications) — the bell dropdown only shows
 * the latest 10; this page paginates the complete list (100/page) with
 * mark-read / delete / mark-all-read over the existing /notifications API.
 */
export const NotificationsPage: FC = () => {
  const fetch = useFetch();
  const t = useT();
  const { mutate: mutateUnread } = useSWRConfig();
  // Server pages are 0-based (page=0 → first 100 rows).
  const [page, setPage] = useState(0);

  const load = useCallback(async (): Promise<PaginatedNotifications> => {
    const res = await fetch(`/notifications/list?page=${page}`);
    if (!res.ok) {
      throw new Error(`Failed to load notifications: ${res.status}`);
    }
    return res.json();
  }, [fetch, page]);

  const { data, isLoading, mutate } = useSWR(
    `notifications-page-${page}`,
    load
  );

  const markAsRead = useCallback(
    async (id: string) => {
      const res = await fetch(`/notifications/${id}/read`, { method: 'PATCH' });
      if (!res.ok) return;
      mutate(
        (prev) =>
          prev
            ? {
                ...prev,
                notifications: prev.notifications.map((n) =>
                  n.id === id ? { ...n, readAt: new Date().toISOString() } : n
                ),
              }
            : prev,
        false
      );
      mutateUnread('notifications-count');
    },
    [fetch, mutate, mutateUnread]
  );

  const markAllAsRead = useCallback(async () => {
    const res = await fetch('/notifications/read-all', { method: 'POST' });
    if (!res.ok) return;
    mutate(
      (prev) =>
        prev
          ? {
              ...prev,
              notifications: prev.notifications.map((n) => ({
                ...n,
                readAt: n.readAt || new Date().toISOString(),
              })),
            }
          : prev,
      false
    );
    mutateUnread('notifications-count');
  }, [fetch, mutate, mutateUnread]);

  const deleteNotification = useCallback(
    async (id: string) => {
      const res = await fetch(`/notifications/${id}`, { method: 'DELETE' });
      if (!res.ok) return;
      mutate(
        (prev) =>
          prev
            ? {
                ...prev,
                notifications: prev.notifications.filter((n) => n.id !== id),
              }
            : prev,
        false
      );
      mutateUnread('notifications-count');
    },
    [fetch, mutate, mutateUnread]
  );

  const total = data?.total ?? 0;
  const totalPages = data ? Math.ceil(total / data.limit) : 0;

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex items-center justify-between flex-wrap gap-[8px]">
        <div className="flex flex-col gap-[4px]">
          <h3 className="text-[18px] font-semibold text-textColor">
            {t('notifications', 'Notifications')}
          </h3>
          <p className="text-[13px] text-newTableText">
            {t(
              'notifications_page_description',
              'Every notification for this workspace — read, dismiss, or manage delivery preferences.'
            )}
          </p>
        </div>
        <div className="flex items-center gap-[12px]">
          <Link
            href="/user/me/notifications"
            className="text-[13px] text-btnPrimaryAccent hover:underline"
          >
            {t('notification_preferences', 'Notification preferences')}
          </Link>
          {!!data?.notifications.length && (
            <button
              type="button"
              onClick={markAllAsRead}
              className="text-[13px] px-[16px] py-[8px] rounded-[8px] border border-newTableBorder hover:bg-boxHover transition-colors"
            >
              {t('mark_all_read', 'Mark all read')}
            </button>
          )}
        </div>
      </div>

      <div className="bg-newBgColorInner border border-newTableBorder rounded-[12px] overflow-hidden">
        {isLoading && (
          <div className="flex justify-center py-[48px]">
            <ReactLoading type="spin" color="#fff" width={36} height={36} />
          </div>
        )}
        {!isLoading && !data?.notifications.length && (
          <div className="text-center p-[24px] text-[13px] text-newTableText">
            {t('no_notifications', 'No notifications')}
          </div>
        )}
        {!isLoading &&
          data?.notifications.map((notification) => (
            <NotificationRow
              key={notification.id}
              notification={notification}
              onMarkRead={markAsRead}
              onDelete={deleteNotification}
            />
          ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="text-[13px] px-[16px] py-[8px] rounded-[8px] border border-newTableBorder hover:bg-boxHover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('previous', 'Previous')}
          </button>
          <span className="text-[12px] text-newTableText">
            {t('page_x_of_y', 'Page {{page}} of {{pages}}', {
              page: String(page + 1),
              pages: String(totalPages),
            })}
          </span>
          <button
            type="button"
            disabled={!data?.hasMore}
            onClick={() => setPage((p) => p + 1)}
            className="text-[13px] px-[16px] py-[8px] rounded-[8px] border border-newTableBorder hover:bg-boxHover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('next', 'Next')}
          </button>
        </div>
      )}
    </div>
  );
};
