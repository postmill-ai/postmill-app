'use client';

import React from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

// Mirrors NOTIFICATION_CATEGORIES (backend DTO) and the label-key convention of
// notification-preferences.panel.tsx (its consts are module-private). Keep the
// three in lockstep when a category is added.
export const COMMS_CATEGORY_ORDER = [
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
] as const;

export type CommsCategory = (typeof COMMS_CATEGORY_ORDER)[number];

const CATEGORY_LABEL_KEYS: Record<CommsCategory, [string, string]> = {
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

export const CategoryChecklist: React.FC<{
  value: Record<string, boolean>;
  onChange: (next: Record<string, boolean>) => void;
}> = ({ value, onChange }) => {
  const t = useT();
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-[16px] gap-y-[6px]">
      {COMMS_CATEGORY_ORDER.map((category) => {
        const [key, fallback] = CATEGORY_LABEL_KEYS[category];
        return (
          <label
            key={category}
            className="flex items-center gap-[6px] cursor-pointer text-[13px] text-textColor"
          >
            <input
              type="checkbox"
              className="accent-btnPrimary w-[14px] h-[14px]"
              checked={!!value[category]}
              onChange={(e) => onChange({ ...value, [category]: e.target.checked })}
            />
            {t(key, fallback)}
          </label>
        );
      })}
    </div>
  );
};
