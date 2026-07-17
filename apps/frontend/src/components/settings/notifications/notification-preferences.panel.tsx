'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { createFetchError } from '@gitroom/frontend/components/settings/shared/fetch-error';

export type NotificationChannel = 'email' | 'push' | 'inApp';
export type NotificationCategory =
  | 'post_published'
  | 'post_failed'
  | 'channels'
  | 'comments'
  | 'budget'
  | 'media'
  | 'announcements'
  | 'streak'
  | 'agent'
  | 'analytics';

export interface ChannelToggles {
  email: boolean;
  push: boolean;
  inApp: boolean;
}

// Fallback for a category the API response doesn't include yet (e.g. a stale
// backend during a deploy, or a newly added category). Keeps the panel from
// crashing on `categories[category]` being undefined.
const EMPTY_TOGGLES: ChannelToggles = { email: false, push: false, inApp: false };

export interface NotificationPreferences {
  masters: ChannelToggles;
  categories: Record<NotificationCategory, ChannelToggles>;
  digestFrequency: 'instant' | 'daily' | 'weekly' | 'never';
}

const CATEGORY_ORDER: NotificationCategory[] = [
  'post_published',
  'post_failed',
  'channels',
  'comments',
  'budget',
  'media',
  'announcements',
  'streak',
  'agent',
  'analytics',
];

const CATEGORY_LABEL_KEYS: Record<NotificationCategory, [string, string]> = {
  post_published: ['notification_cat_post_published', 'Post published'],
  post_failed: ['notification_cat_post_failed', 'Post failed'],
  channels: ['notification_cat_channels', 'Channel issues'],
  comments: ['notification_cat_comments', 'Replies'],
  budget: ['notification_cat_budget', 'AI budget'],
  media: ['notification_cat_media', 'Media jobs'],
  announcements: ['notification_cat_announcements', 'Announcements'],
  streak: ['notification_cat_streak', 'Streak reminders'],
  agent: ['notification_cat_agent', 'Agent briefs'],
  analytics: ['notification_cat_analytics', 'Analytics alerts'],
};

const CHANNEL_ORDER: NotificationChannel[] = ['email', 'push', 'inApp'];

const CHANNEL_LABEL_KEYS: Record<NotificationChannel, [string, string]> = {
  email: ['notification_channel_email', 'Email'],
  push: ['notification_channel_push', 'Push'],
  inApp: ['notification_channel_inapp', 'In-app'],
};

export const useNotificationPreferences = () => {
  const fetch = useFetch();
  const load = useCallback(async (): Promise<NotificationPreferences> => {
    const res = await fetch('/notifications/preferences');
    if (!res.ok) throw createFetchError('failed_to_load_notification_preferences', 'Failed to load notification preferences');
    return res.json();
  }, [fetch]);
  return useSWR<NotificationPreferences>('notification-preferences', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
  });
};

const Toggle: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}> = ({ checked, onChange, label }) => {
  return (
    <label className="inline-flex items-center gap-[8px] cursor-pointer">
      <input
        type="checkbox"
        className="sr-only peer"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div className="relative w-[44px] h-[24px] bg-newTableBorder peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-[20px] after:w-[20px] after:transition-all peer-checked:bg-btnPrimary" />
      {label && <span className="text-[13px] text-textColor">{label}</span>}
    </label>
  );
};

export const NotificationPreferencesPanel: React.FC = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const { data, isLoading, error, mutate } = useNotificationPreferences();
  const [local, setLocal] = useState<NotificationPreferences | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) {
      setLocal(data);
    }
  }, [data]);

  const savePreferences = useCallback(
    async (next: NotificationPreferences) => {
      setSaving(true);
      try {
        const res = await fetch('/notifications/preferences', {
          method: 'POST',
          body: JSON.stringify({
            masters: next.masters,
            categories: next.categories,
            digestFrequency: next.digestFrequency,
          }),
        });
        if (!res.ok) {
          toaster.show(t('save_failed', 'Failed to save'), 'warning');
          return;
        }
        const saved = await res.json();
        setLocal(saved);
        mutate(saved, false);
        toaster.show(t('settings_updated', 'Settings Updated'), 'success');
      } finally {
        setSaving(false);
      }
    },
    [fetch, mutate, toaster, t]
  );

  const updateMaster = useCallback(
    (channel: NotificationChannel, value: boolean) => {
      if (!local) return;
      const next = {
        ...local,
        masters: { ...local.masters, [channel]: value },
      };
      setLocal(next);
      savePreferences(next);
    },
    [local, savePreferences]
  );

  const updateCategory = useCallback(
    (category: NotificationCategory, channel: NotificationChannel, value: boolean) => {
      if (!local) return;
      const next = {
        ...local,
        categories: {
          ...local.categories,
          [category]: {
            ...(local.categories[category] ?? EMPTY_TOGGLES),
            [channel]: value,
          },
        },
      };
      setLocal(next);
      savePreferences(next);
    },
    [local, savePreferences]
  );

  const updateDigest = useCallback(
    (value: NotificationPreferences['digestFrequency']) => {
      if (!local) return;
      const next = { ...local, digestFrequency: value };
      setLocal(next);
      savePreferences(next);
    },
    [local, savePreferences]
  );

  const allCategories = useMemo(() => {
    if (!local) return [];
    return CATEGORY_ORDER.map((category) => ({
      category,
      label: CATEGORY_LABEL_KEYS[category],
      channels: CHANNEL_ORDER.map((channel) => ({
        channel,
        label: CHANNEL_LABEL_KEYS[channel],
        checked: (local.categories[category] ?? EMPTY_TOGGLES)[channel],
        disabled: !local.masters[channel],
      })),
    }));
  }, [local]);

  if (isLoading || !local) {
    return (
      <div className="flex flex-col gap-[16px]">
        <div className="text-[20px]">{t('notifications', 'Notifications')}</div>
        <div className="bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[24px] animate-pulse">
          {t('loading', 'Loading')}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-[16px]">
        <div className="text-[20px]">{t('notifications', 'Notifications')}</div>
        <div className="bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[24px] flex flex-col items-center gap-[12px]">
          <span className="text-[14px] text-red-500">
            {t('failed_to_load_preferences', 'Failed to load preferences')}
          </span>
          <button
            className="text-[13px] bg-newBgColorInner border border-newTableBorder rounded-[8px] px-[16px] py-[8px] hover:bg-boxHover transition-colors"
            onClick={() => window.location.reload()}
          >
            {t('try_again', 'Try again')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-col gap-[4px]">
        <h3 className="text-[20px]">{t('notifications', 'Notifications')}</h3>
        <p className="text-[13px] text-newTableText max-w-[640px]">
          {t(
            'notifications_settings_description',
            'Choose which channels and categories of notifications you receive. Master toggles control each channel; category toggles let you opt in or out of specific notification types.'
          )}
        </p>
      </div>

      <div className="bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[24px] flex flex-col gap-[24px]">
        <div>
          <h4 className="text-[16px] font-semibold mb-[4px]">
            {t('notification_channels', 'Channels')}
          </h4>
          <p className="text-[13px] text-newTableText mb-[12px]">
            {t(
              'notification_channels_description',
              'Enable or disable each delivery channel. Disabling a channel turns off all notifications sent through it.'
            )}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-[16px]">
            {CHANNEL_ORDER.map((channel) => (
              <div
                key={channel}
                className="flex items-center justify-between border border-newTableBorder rounded-[8px] p-[12px]"
              >
                <span className="text-[14px]">{t(CHANNEL_LABEL_KEYS[channel][0], CHANNEL_LABEL_KEYS[channel][1])}</span>
                <Toggle
                  checked={local.masters[channel]}
                  onChange={(value) => updateMaster(channel, value)}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-newTableBorder pt-[24px]">
          <h4 className="text-[16px] font-semibold mb-[4px]">
            {t('notification_categories', 'Categories')}
          </h4>
          <p className="text-[13px] text-newTableText mb-[12px]">
            {t(
              'notification_categories_description',
              'Fine-tune which categories are delivered on each channel.'
            )}
          </p>
          <div className="border border-newTableBorder rounded-[8px] overflow-hidden">
            <div className="grid grid-cols-[1fr_repeat(3,auto)] gap-[12px] px-[16px] py-[10px] bg-newTableHeader text-[12px] text-newTableText uppercase tracking-wider">
              <span>{t('category', 'Category')}</span>
              {CHANNEL_ORDER.map((channel) => (
                <span key={channel} className="text-center w-[60px]">
                  {t(CHANNEL_LABEL_KEYS[channel][0], CHANNEL_LABEL_KEYS[channel][1])}
                </span>
              ))}
            </div>
            {allCategories.map((row, idx) => (
              <div
                key={row.category}
                className={`grid grid-cols-[1fr_repeat(3,auto)] gap-[12px] px-[16px] py-[12px] items-center ${
                  idx !== allCategories.length - 1 ? 'border-b border-newTableBorder' : ''
                }`}
              >
                <span className="text-[14px]">{t(row.label[0], row.label[1])}</span>
                {row.channels.map(({ channel, checked, disabled }) => (
                  <div key={channel} className="flex justify-center w-[60px]">
                    <Toggle
                      checked={checked}
                      onChange={(value) => updateCategory(row.category, channel, value)}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-newTableBorder pt-[24px]">
          <h4 className="text-[16px] font-semibold mb-[4px]">
            {t('digest_settings', 'Digest')}
          </h4>
          <p className="text-[13px] text-newTableText mb-[12px]">
            {t(
              'digest_settings_description',
              'Choose how often to receive summary emails for supported notification categories.'
            )}
          </p>
          <select
            value={local.digestFrequency}
            onChange={(e) =>
              updateDigest(e.target.value as NotificationPreferences['digestFrequency'])
            }
            disabled={saving}
            className="px-[12px] py-[8px] bg-newBgColor border border-newTableBorder rounded-[8px] text-[14px] outline-none"
          >
            <option value="instant">{t('instant', 'Instant')}</option>
            <option value="daily">{t('daily', 'Daily')}</option>
            <option value="weekly">{t('weekly', 'Weekly')}</option>
            <option value="never">{t('never', 'Never')}</option>
          </select>
        </div>
      </div>
    </div>
  );
};
