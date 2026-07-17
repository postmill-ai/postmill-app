'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR, { useSWRConfig } from 'swr';
import { FC, useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useClickAway } from '@uidotdev/usehooks';
import ReactLoading from '@gitroom/frontend/components/layout/loading';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { SafeContent } from '@gitroom/frontend/components/shared/safe-content';

dayjs.extend(relativeTime);

export interface NotificationItem {
  id: string;
  type: string;
  title?: string | null;
  content: string;
  link?: string | null;
  metadata?: Record<string, any> | null;
  createdAt: string;
  readAt?: string | null;
}

function replaceLinks(text: string) {
  const urlRegex =
    /(\bhttps?:\/\/[-A-Z0-9+&@#/%?=~_|!:,.;]*[-A-Z0-9+&@#/%=~_|])/gi;
  return text.replace(
    urlRegex,
    '<a class="cursor-pointer underline font-bold" target="_blank" href="$1">$1</a>'
  );
}

const NotificationRow: FC<{
  notification: NotificationItem;
  onMarkRead: (id: string) => void;
  onDelete: (id: string) => void;
}> = ({ notification, onMarkRead, onDelete }) => {
  const t = useT();
  const createdAt = dayjs(notification.createdAt);
  const isWithin24h = dayjs().diff(createdAt, 'hour') < 24;
  const fullDate = createdAt.format(t('notification_full_date_format', 'MMM D, YYYY h:mm A'));
  const isUnread = !notification.readAt;

  return (
    <div
      className={clsx(
        'px-[16px] py-[12px] border-b border-newTableBorder last:border-b-0 transition-colors group',
        isUnread && 'bg-seventh/40'
      )}
    >
      <div className="flex items-start justify-between gap-[12px]">
        <div className="flex-1 min-w-0">
          {notification.title && (
            <div
              className={clsx(
                'text-[13px] mb-[2px]',
                isUnread ? 'font-semibold text-textColor' : 'text-textColor'
              )}
            >
              {notification.title}
            </div>
          )}
          <SafeContent
            className="text-[13px] text-textColor/90 break-words"
            content={replaceLinks(notification.content)}
          />
          {notification.link && (
            <a
              href={notification.link}
              target="_blank"
              rel="noreferrer"
              className="text-[12px] text-btnPrimaryAccent hover:underline mt-[4px] inline-block"
            >
              {t('view', 'View')}
            </a>
          )}
        </div>
        <div className="flex items-center gap-[4px] shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {isUnread && (
            <button
              type="button"
              onClick={() => onMarkRead(notification.id)}
              className="text-[11px] text-btnPrimaryAccent hover:underline px-[6px] py-[2px]"
              title={t('mark_as_read', 'Mark as read')}
            >
              {t('read', 'Read')}
            </button>
          )}
          <button
            type="button"
            onClick={() => onDelete(notification.id)}
            className="text-[11px] text-red-600 dark:text-red-500 hover:underline px-[6px] py-[2px]"
            title={t('delete', 'Delete')}
          >
            {t('delete', 'Delete')}
          </button>
        </div>
      </div>
      <div
        className="text-[11px] mt-[4px] opacity-60 font-normal"
        title={isWithin24h ? fullDate : undefined}
      >
        {isWithin24h ? createdAt.fromNow() : fullDate}
      </div>
    </div>
  );
};

export const NotificationOpenComponent: FC<{
  onClose: () => void;
}> = ({ onClose }) => {
  const fetch = useFetch();
  const t = useT();
  const { mutate: mutateUnread } = useSWRConfig();

  const loadNotifications = useCallback(
    async (): Promise<{ notifications: NotificationItem[] }> => {
      return (await fetch('/notifications/list')).json();
    },
    [fetch]
  );

  const { data, isLoading, mutate } = useSWR(
    'notifications-list',
    loadNotifications,
    { refreshInterval: 30000 }
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

  return (
    <div
      id="notification-popup"
      className="opacity-0 animate-normalFadeDown mt-[10px] absolute w-[420px] min-h-[200px] top-[100%] end-0 bg-newBgColorInner text-textColor rounded-[16px] flex flex-col border border-newTableBorder z-[600] shadow-lg"
    >
      <div className="p-[16px] border-b border-newTableBorder flex items-center justify-between">
        <div className="font-bold">{t('notifications', 'Notifications')}</div>
        {!!data?.notifications.length && (
          <button
            type="button"
            onClick={markAllAsRead}
            className="text-[12px] text-btnPrimaryAccent hover:underline"
          >
            {t('mark_all_read', 'Mark all read')}
          </button>
        )}
      </div>

      <div className="flex flex-col max-h-[400px] overflow-y-auto scrollbar scrollbar-thumb-fifth scrollbar-track-newBgColor">
        {isLoading && (
          <div className="flex-1 flex justify-center pt-12">
            <ReactLoading type="spin" color="#fff" width={36} height={36} />
          </div>
        )}
        {!isLoading && !data?.notifications.length && (
          <div className="text-center p-[16px] text-textColor flex-1 flex justify-center items-center mt-[20px]">
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

      <div className="p-[12px] border-t border-newTableBorder text-center">
        <a
          href="/user/me"
          onClick={onClose}
          className="text-[12px] text-btnPrimaryAccent hover:underline"
        >
          {t('notification_preferences', 'Notification preferences')}
        </a>
      </div>
    </div>
  );
};

const NotificationComponent = () => {
  const fetch = useFetch();
  const t = useT();
  const [show, setShow] = useState(false);

  const loadUnreadCount = useCallback(async (): Promise<{ total: number }> => {
    return (await fetch('/notifications')).json();
  }, [fetch]);

  const { data, mutate } = useSWR('notifications-count', loadUnreadCount, {
    refreshInterval: 30000,
    revalidateOnFocus: true,
  });

  const changeShow = useCallback(() => {
    setShow((prev) => !prev);
    if (!show) {
      mutate((prev) => (prev ? { ...prev, total: 0 } : prev), false);
    }
  }, [show, mutate]);

  const ref = useClickAway<HTMLDivElement>(() => setShow(false));

  return (
    <div className="relative cursor-pointer select-none" ref={ref}>
      <button
        type="button"
        aria-label={t('notifications', 'Notifications')}
        onClick={changeShow}
        className="relative cursor-pointer"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          className="hover:text-newTextColor"
        >
          <path
            d="M14 21H10M18 8C18 6.4087 17.3679 4.88258 16.2427 3.75736C15.1174 2.63214 13.5913 2 12 2C10.4087 2 8.8826 2.63214 7.75738 3.75736C6.63216 4.88258 6.00002 6.4087 6.00002 8C6.00002 11.0902 5.22049 13.206 4.34968 14.6054C3.61515 15.7859 3.24788 16.3761 3.26134 16.5408C3.27626 16.7231 3.31488 16.7926 3.46179 16.9016C3.59448 17 4.19261 17 5.38887 17H18.6112C19.8074 17 20.4056 17 20.5382 16.9016C20.6852 16.7926 20.7238 16.7231 20.7387 16.5408C20.7522 16.3761 20.3849 15.7859 19.6504 14.6054C18.7795 13.206 18 11.0902 18 8Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {!!data?.total && (
          <span className="absolute -top-[2px] -right-[2px] min-w-[16px] h-[16px] px-[4px] flex items-center justify-center bg-badge text-white text-[10px] font-bold rounded-full border border-newBgColorInner">
            {data.total > 99 ? '99+' : data.total}
          </span>
        )}
      </button>
      {show && <NotificationOpenComponent onClose={() => setShow(false)} />}
    </div>
  );
};

export default NotificationComponent;
