'use client';

import { FC, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Integrations } from '@gitroom/frontend/components/launches/calendar.context';
import { ChannelFilterSelect } from '@gitroom/frontend/components/launches/channel-filter-select';
import { CampaignFilterSelect } from '@gitroom/frontend/components/launches/campaign-filter-select';
import { TeamMemberItem } from '@gitroom/frontend/components/settings/roles/hooks/use-roles';

interface RepliesFilterBarProps {
  status?: string;
  onStatusChange: (status?: string) => void;
  integrations: Integrations[];
  selectedChannels: string[];
  onChannelsChange: (ids: string[]) => void;
  campaigns: { id: string; name: string }[];
  selectedCampaigns: string[];
  onCampaignsChange: (ids: string[]) => void;
  teamMembers: TeamMemberItem[];
  assigneeId?: string;
  onAssigneeChange: (id?: string) => void;
  unreadOnly: boolean;
  onUnreadChange: (value: boolean) => void;
}

interface Chip {
  key: string;
  label: string;
  onClear: () => void;
}

const Section: FC<{ title: string; children: ReactNode }> = ({ title, children }) => (
  <div className="shrink-0 rounded-[10px] border border-studioBorder bg-newBgColorInner overflow-hidden">
    <div className="h-[40px] px-[14px] flex items-center bg-studioBg border-b border-studioBorder">
      <span className="text-[13px] font-[600] text-textColor">{title}</span>
    </div>
    <div className="p-[14px] flex flex-col gap-[14px]">{children}</div>
  </div>
);

export const RepliesFilterBar: FC<RepliesFilterBarProps> = ({
  status,
  onStatusChange,
  integrations,
  selectedChannels,
  onChannelsChange,
  campaigns,
  selectedCampaigns,
  onCampaignsChange,
  teamMembers,
  assigneeId,
  onAssigneeChange,
  unreadOnly,
  onUnreadChange,
}) => {
  const t = useT();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const statusOptions = useMemo(
    () => [
      { label: t('comment_inbox.filter_all', 'All'), value: undefined as string | undefined },
      { label: t('comment_inbox.filter_needs_reply', 'Needs Reply'), value: 'needs_reply' },
      { label: t('comment_inbox.filter_handled', 'Handled'), value: 'handled' },
      { label: t('comment_inbox.filter_ignored', 'Ignored'), value: 'ignored' },
    ],
    [t]
  );

  const chips = useMemo<Chip[]>(() => {
    const list: Chip[] = [];
    if (status) {
      const label = statusOptions.find((o) => o.value === status)?.label || status;
      list.push({ key: 'status', label, onClear: () => onStatusChange(undefined) });
    }
    if (selectedChannels.length) {
      const label =
        selectedChannels.length === 1
          ? integrations.find((i) => i.id === selectedChannels[0])?.name ||
            t('one_channel', '1 channel')
          : t('n_channels', '{{count}} channels', { count: selectedChannels.length });
      list.push({ key: 'channels', label, onClear: () => onChannelsChange([]) });
    }
    if (selectedCampaigns.length) {
      const label =
        selectedCampaigns.length === 1
          ? campaigns.find((c) => c.id === selectedCampaigns[0])?.name ||
            t('one_campaign', '1 campaign')
          : t('n_campaigns', '{{count}} campaigns', { count: selectedCampaigns.length });
      list.push({ key: 'campaigns', label, onClear: () => onCampaignsChange([]) });
    }
    if (assigneeId) {
      const member = teamMembers.find((m) => m.user.id === assigneeId);
      const label = member?.user.profile?.name || member?.user.email || t('assigned', 'Assigned');
      list.push({ key: 'assignee', label, onClear: () => onAssigneeChange(undefined) });
    }
    if (unreadOnly) {
      list.push({
        key: 'unread',
        label: t('comment_inbox.filter_unread_only', 'Unread only'),
        onClear: () => onUnreadChange(false),
      });
    }
    return list;
  }, [
    status,
    statusOptions,
    selectedChannels,
    selectedCampaigns,
    assigneeId,
    unreadOnly,
    integrations,
    campaigns,
    teamMembers,
    onStatusChange,
    onChannelsChange,
    onCampaignsChange,
    onAssigneeChange,
    onUnreadChange,
    t,
  ]);

  const appliedCount = chips.length;

  const clearAll = useCallback(() => {
    onStatusChange(undefined);
    onChannelsChange([]);
    onCampaignsChange([]);
    onAssigneeChange(undefined);
    onUnreadChange(false);
  }, [onStatusChange, onChannelsChange, onCampaignsChange, onAssigneeChange, onUnreadChange]);

  const drawer = (
    <div
      aria-hidden={!open}
      inert={!open}
      className={clsx('fixed inset-0 z-[300] flex justify-end', !open && 'pointer-events-none')}
    >
      <div
        className={clsx(
          'absolute inset-0 bg-black/50 transition-opacity duration-200',
          open ? 'opacity-100' : 'opacity-0'
        )}
        onClick={() => setOpen(false)}
      />
      <div
        className={clsx(
          'relative h-full w-[380px] max-w-[90vw] bg-newBgColor border-s border-studioBorder shadow-2xl flex flex-col text-textColor',
          'transition-transform duration-300 ease-out will-change-transform',
          open ? 'translate-x-0' : 'translate-x-full rtl:-translate-x-full'
        )}
      >
        <div className="h-[56px] shrink-0 flex items-center justify-between px-[16px] bg-studioBg border-b border-studioBorder">
          <div className="flex items-center gap-[8px]">
            <div className="text-[16px] font-[600]">{t('filters', 'Filters')}</div>
            {appliedCount > 0 && (
              <span className="min-w-[20px] h-[20px] px-[6px] rounded-full bg-[#2B5CD3] text-white text-[11px] font-[600] flex items-center justify-center">
                {appliedCount}
              </span>
            )}
          </div>
          <button
            type="button"
            aria-label={t('close', 'Close')}
            onClick={() => setOpen(false)}
            className="w-[32px] h-[32px] flex items-center justify-center rounded-[8px] text-newTableText hover:bg-[#2B5CD3]/15 hover:text-textColor transition-all"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-auto px-[14px] py-[14px] flex flex-col gap-[12px] scrollbar scrollbar-thumb-fifth scrollbar-track-newBgColor">
          {/* Status + unread (reply-state filters) */}
          <Section title={t('status_filter', 'Status')}>
            <div className="flex flex-wrap gap-[8px]">
              {statusOptions.map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => onStatusChange(opt.value)}
                  className={clsx(
                    'px-[12px] py-[6px] text-[13px] font-[500] rounded-[8px] border transition-colors',
                    status === opt.value
                      ? 'bg-[#2B5CD3] text-white border-[#2B5CD3]'
                      : 'bg-newBgColorInner text-newTableText border-newTableBorder hover:text-textColor'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-[10px] cursor-pointer select-none text-[14px] text-textColor">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={unreadOnly}
                onChange={(e) => onUnreadChange(e.target.checked)}
              />
              <div className="relative w-[44px] h-[24px] shrink-0 bg-newTableBorder peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-[20px] after:w-[20px] after:transition-all peer-checked:bg-btnPrimary" />
              {t('comment_inbox.filter_unread_only', 'Unread only')}
            </label>
          </Section>

          {/* Channels */}
          <Section title={t('channels', 'Channels')}>
            <ChannelFilterSelect
              integrations={integrations}
              selectedIds={selectedChannels}
              onToggle={(integration) => {
                const id = integration.id;
                onChannelsChange(
                  selectedChannels.includes(id)
                    ? selectedChannels.filter((x) => x !== id)
                    : [...selectedChannels, id]
                );
              }}
            />
          </Section>

          {/* Campaigns — only when the org has campaigns. */}
          {campaigns.length > 0 && (
            <Section title={t('campaigns', 'Campaigns')}>
              <CampaignFilterSelect
                campaigns={campaigns}
                selectedIds={selectedCampaigns}
                onToggle={(id) =>
                  onCampaignsChange(
                    selectedCampaigns.includes(id)
                      ? selectedCampaigns.filter((x) => x !== id)
                      : [...selectedCampaigns, id]
                  )
                }
              />
            </Section>
          )}

          {/* Assignee — only when the org has team members. */}
          {teamMembers.length > 0 && (
            <Section title={t('assignee', 'Assignee')}>
              <select
                value={assigneeId || ''}
                onChange={(e) => onAssigneeChange(e.target.value || undefined)}
                className="w-full bg-newBgColorInner border border-newTableBorder rounded-[8px] px-[10px] h-[38px] text-[13px] text-textColor outline-none"
              >
                <option value="">{t('comment_inbox.filter_all_assignees', 'Anyone')}</option>
                {teamMembers.map((m) => (
                  <option key={m.user.id} value={m.user.id}>
                    {m.user.profile?.name || m.user.email}
                  </option>
                ))}
              </select>
            </Section>
          )}

        </div>

        <div className="shrink-0 bg-studioBg border-t border-studioBorder p-[14px] pb-[calc(env(safe-area-inset-bottom)+14px)] flex items-center gap-[10px]">
          <button
            type="button"
            onClick={clearAll}
            disabled={appliedCount === 0}
            className="flex-1 h-[40px] rounded-[8px] border border-newTableBorder text-[14px] font-[500] text-textColor hover:bg-[#2B5CD3]/10 transition-all disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent"
          >
            {appliedCount > 0
              ? t('clear_all_count', 'Clear all ({{count}})', { count: appliedCount })
              : t('clear_all', 'Clear all')}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex-1 h-[40px] rounded-[8px] bg-[#2B5CD3] text-white text-[14px] font-[600] hover:opacity-90 transition-all"
          >
            {t('done', 'Done')}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex items-center gap-[10px]">
      {/* Applied-filter chip track — fills the left, Filter button pinned right. */}
      <div className="flex-1 min-w-0 flex flex-wrap gap-[8px] items-center">
        {chips.map((chip) => (
          <div
            key={chip.key}
            className="flex items-center gap-[6px] h-[30px] pl-[12px] pr-[6px] rounded-full border border-newTableBorder bg-newBgColorInner text-[13px] max-w-[200px]"
          >
            <span className="truncate">{chip.label}</span>
            <button
              type="button"
              aria-label={t('remove_filter', 'Remove filter')}
              onClick={chip.onClear}
              className="w-[18px] h-[18px] shrink-0 flex items-center justify-center rounded-full hover:bg-[#2B5CD3]/15 hover:text-textColor transition-all"
            >
              <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
                <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        ))}
        {appliedCount > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="h-[30px] px-[10px] text-[13px] font-[500] text-newTableText hover:text-textColor transition-all"
          >
            {t('clear_all', 'Clear all')}
          </button>
        )}
      </div>

      <button
        type="button"
        aria-label={
          appliedCount > 0
            ? t('filter_with_count', 'Filter ({{count}} applied)', { count: appliedCount })
            : t('filter', 'Filter')
        }
        onClick={() => setOpen(true)}
        className="relative shrink-0 w-[42px] h-[42px] flex items-center justify-center rounded-[8px] border border-newTableBorder bg-newBgColorInner hover:text-textColor hover:border-[#2B5CD3]/50 transition-all"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path
            d="M21 4H3l7.2 8.52v5.73l3.6 1.75v-7.48L21 4z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {appliedCount > 0 && (
          <span className="absolute -top-[6px] -end-[6px] min-w-[18px] h-[18px] px-[4px] rounded-full bg-[#2B5CD3] text-white text-[11px] font-[600] leading-[18px] text-center">
            {appliedCount}
          </span>
        )}
      </button>

      {typeof document !== 'undefined' && createPortal(drawer, document.body)}
    </div>
  );
};
