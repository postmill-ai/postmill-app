'use client';

import { FC, useCallback } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { TeamMemberItem } from '@gitroom/frontend/components/settings/roles/hooks/use-roles';

export interface InboxFilters {
  status?: string;
  assigneeId?: string;
  integrationId?: string;
  unreadOnly: boolean;
}

export interface ChannelOption {
  id: string;
  name: string;
  providerIdentifier: string;
}

interface CommentInboxFiltersProps {
  filters: InboxFilters;
  onChange: (filters: InboxFilters) => void;
  // Optional — when supplied, a channel and/or assignee dropdown is rendered.
  channels?: ChannelOption[];
  teamMembers?: TeamMemberItem[];
}

export const CommentInboxFilters: FC<CommentInboxFiltersProps> = ({
  filters,
  onChange,
  channels,
  teamMembers,
}) => {
  const t = useT();
  const setStatus = useCallback(
    (status: string | undefined) => {
      onChange({ ...filters, status });
    },
    [filters, onChange]
  );

  const toggleUnreadOnly = useCallback(() => {
    onChange({ ...filters, unreadOnly: !filters.unreadOnly });
  }, [filters, onChange]);

  return (
    <div className="flex items-center gap-[12px] flex-wrap">
      <div className="flex gap-[8px]">
        {[
          { label: t('comment_inbox.filter_all', 'All'), value: undefined },
          { label: t('comment_inbox.filter_needs_reply', 'Needs Reply'), value: 'needs_reply' },
          { label: t('comment_inbox.filter_handled', 'Handled'), value: 'handled' },
          { label: t('comment_inbox.filter_ignored', 'Ignored'), value: 'ignored' },
        ].map((opt) => (
          <button
            key={opt.label}
            onClick={() => setStatus(opt.value)}
            className={`px-[12px] py-[4px] text-[13px] font-medium rounded-[6px] transition-colors ${
              filters.status === opt.value
                ? 'bg-btnPrimary text-white'
                : 'bg-newBgColorInner text-newTableText hover:text-btnText border border-newTableBorder'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {channels && channels.length > 0 && (
        <select
          value={filters.integrationId || ''}
          onChange={(e) => onChange({ ...filters, integrationId: e.target.value || undefined })}
          className="bg-newBgColorInner border border-newTableBorder rounded-[6px] px-[10px] py-[4px] text-[13px] text-newTableText outline-none"
        >
          <option value="">{t('comment_inbox.filter_all_channels', 'All channels')}</option>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      {teamMembers && teamMembers.length > 0 && (
        <select
          value={filters.assigneeId || ''}
          onChange={(e) => onChange({ ...filters, assigneeId: e.target.value || undefined })}
          className="bg-newBgColorInner border border-newTableBorder rounded-[6px] px-[10px] py-[4px] text-[13px] text-newTableText outline-none"
        >
          <option value="">{t('comment_inbox.filter_all_assignees', 'Anyone')}</option>
          {teamMembers.map((m) => (
            <option key={m.user.id} value={m.user.id}>
              {m.user.profile?.name || m.user.email}
            </option>
          ))}
        </select>
      )}
      <label className="flex items-center gap-[8px] text-[13px] text-newTableText cursor-pointer select-none">
        <input
          type="checkbox"
          className="sr-only peer"
          checked={filters.unreadOnly}
          onChange={toggleUnreadOnly}
        />
        <div className="relative w-[36px] h-[20px] shrink-0 bg-newTableBorder rounded-full peer-checked:bg-btnPrimary after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-[16px] after:w-[16px] after:transition-all peer-checked:after:translate-x-full" />
        {t('comment_inbox.filter_unread_only', 'Unread only')}
      </label>
    </div>
  );
};
