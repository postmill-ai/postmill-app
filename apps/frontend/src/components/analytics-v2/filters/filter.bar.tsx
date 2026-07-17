'use client';

import {
  FC,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { RangeCalendar } from '@mantine/dates';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
import { Integrations } from '@gitroom/frontend/components/launches/calendar.context';
import { ChannelFilterSelect } from '@gitroom/frontend/components/launches/channel-filter-select';
import { CampaignFilterSelect } from '@gitroom/frontend/components/launches/campaign-filter-select';

type WindowMode = 'day' | 'week' | 'month' | 'custom';
const FMT = 'YYYY-MM-DD';

interface AnalyticsFilterBarProps {
  from: string;
  to: string;
  compare: boolean;
  onRangeChange: (range: { from: string; to: string; compare: boolean }) => void;
  integrations: Integrations[];
  selectedChannels: string[];
  onChannelsChange: (ids: string[]) => void;
  campaigns: { id: string; name: string }[];
  selectedCampaigns: string[];
  onCampaignsChange: (ids: string[]) => void;
  /** Rendered inline next to the Filter button (e.g. the Export control). */
  exportSlot?: ReactNode;
}

// The dashboard boots on the last 30 days; used to decide whether the date
// filter counts as "applied" and what "Clear" resets to.
function defaultRange() {
  return {
    from: dayjs().subtract(30, 'day').format(FMT),
    to: dayjs().format(FMT),
  };
}

function rangeFor(mode: Exclude<WindowMode, 'custom'>, a: dayjs.Dayjs) {
  if (mode === 'day') return { from: a.format(FMT), to: a.format(FMT) };
  if (mode === 'week')
    return {
      from: a.startOf('week').format(FMT),
      to: a.endOf('week').format(FMT),
    };
  return { from: a.startOf('month').format(FMT), to: a.endOf('month').format(FMT) };
}

function inferWindow(from: string, to: string): WindowMode {
  const f = dayjs(from);
  const t = dayjs(to);
  if (from === to) return 'day';
  if (f.isSame(f.startOf('week'), 'day') && t.isSame(f.endOf('week'), 'day'))
    return 'week';
  if (f.isSame(f.startOf('month'), 'day') && t.isSame(f.endOf('month'), 'day'))
    return 'month';
  return 'custom';
}

interface Chip {
  key: string;
  label: string;
  onClear: () => void;
}

const Section: FC<{ title: string; children: ReactNode }> = ({
  title,
  children,
}) => (
  <div className="shrink-0 rounded-[10px] border border-studioBorder bg-newBgColorInner overflow-hidden">
    <div className="h-[40px] px-[14px] flex items-center bg-studioBg border-b border-studioBorder">
      <span className="text-[13px] font-[600] text-textColor">{title}</span>
    </div>
    <div className="p-[14px] flex flex-col gap-[14px]">{children}</div>
  </div>
);

const SubLabel: FC<{ children: ReactNode }> = ({ children }) => (
  <span className="text-[12px] font-[500] text-newTableText uppercase tracking-wide">
    {children}
  </span>
);

export const AnalyticsFilterBar: FC<AnalyticsFilterBarProps> = ({
  from,
  to,
  compare,
  onRangeChange,
  integrations,
  selectedChannels,
  onChannelsChange,
  campaigns,
  selectedCampaigns,
  onCampaignsChange,
  exportSlot,
}) => {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [win, setWin] = useState<WindowMode>(() => inferWindow(from, to));
  const [customOpen, setCustomOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // --- Date range + window ---------------------------------------------------
  const setWindow = useCallback(
    (mode: Exclude<WindowMode, 'custom'>) => {
      setWin(mode);
      setCustomOpen(false);
      onRangeChange({ ...rangeFor(mode, newDayjs(to)), compare });
    },
    [to, compare, onRangeChange]
  );

  const shift = useCallback(
    (dir: 'prev' | 'next') => {
      const sign = dir === 'prev' ? -1 : 1;
      if (win === 'custom') {
        const span = newDayjs(to).diff(newDayjs(from), 'day') + 1;
        const nf = newDayjs(from).add(sign * span, 'day');
        onRangeChange({
          from: nf.format(FMT),
          to: nf.add(span - 1, 'day').format(FMT),
          compare,
        });
        return;
      }
      const unit = win === 'day' ? 'day' : win === 'week' ? 'week' : 'month';
      onRangeChange({
        ...rangeFor(win, newDayjs(from).add(sign, unit)),
        compare,
      });
    },
    [win, from, to, compare, onRangeChange]
  );

  const goToday = useCallback(() => {
    const mode = win === 'custom' ? 'month' : win;
    if (win === 'custom') setWin('month');
    setCustomOpen(false);
    onRangeChange({ ...rangeFor(mode, newDayjs()), compare });
  }, [win, compare, onRangeChange]);

  const displayText = useMemo(() => {
    const f = newDayjs(from);
    const tt = newDayjs(to);
    if (win === 'day') return f.format('MMM D, YYYY');
    if (win === 'month') return f.format('MMMM YYYY');
    if (win === 'week') return `${f.format('MMM D')} – ${tt.format('MMM D')}`;
    return `${f.format('MMM D')} – ${tt.format('MMM D, YYYY')}`;
  }, [from, to, win]);

  // --- Applied filters (chips) ----------------------------------------------
  const resetDate = useCallback(() => {
    const d = defaultRange();
    setWin(inferWindow(d.from, d.to));
    setCustomOpen(false);
    onRangeChange({ from: d.from, to: d.to, compare });
  }, [compare, onRangeChange]);

  const dateApplied = useMemo(() => {
    const d = defaultRange();
    return !(from === d.from && to === d.to);
  }, [from, to]);

  const chips = useMemo<Chip[]>(() => {
    const list: Chip[] = [];
    if (dateApplied)
      list.push({ key: 'date', label: displayText, onClear: resetDate });
    if (selectedChannels.length) {
      const label =
        selectedChannels.length === 1
          ? integrations.find((i) => i.id === selectedChannels[0])?.name ||
            t('one_channel', '1 channel')
          : t('n_channels', '{{count}} channels', {
              count: selectedChannels.length,
            });
      list.push({
        key: 'channels',
        label,
        onClear: () => onChannelsChange([]),
      });
    }
    if (selectedCampaigns.length) {
      const label =
        selectedCampaigns.length === 1
          ? campaigns.find((c) => c.id === selectedCampaigns[0])?.name ||
            t('one_campaign', '1 campaign')
          : t('n_campaigns', '{{count}} campaigns', {
              count: selectedCampaigns.length,
            });
      list.push({
        key: 'campaigns',
        label,
        onClear: () => onCampaignsChange([]),
      });
    }
    return list;
  }, [
    dateApplied,
    displayText,
    resetDate,
    selectedChannels,
    selectedCampaigns,
    integrations,
    campaigns,
    onChannelsChange,
    onCampaignsChange,
    t,
  ]);

  const appliedCount = chips.length;

  const clearAll = useCallback(() => {
    resetDate();
    onChannelsChange([]);
    onCampaignsChange([]);
  }, [resetDate, onChannelsChange, onCampaignsChange]);

  const navBtn =
    'cursor-pointer text-textColor px-[10px] bg-newBgColorInner h-full flex items-center justify-center hover:text-textColor hover:bg-designerAccent/15 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-designerAccent/60';

  const drawer = (
    <div
      aria-hidden={!open}
      inert={!open}
      className={clsx(
        'fixed inset-0 z-[300] flex justify-end',
        !open && 'pointer-events-none'
      )}
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
              <span className="min-w-[20px] h-[20px] px-[6px] rounded-full bg-designerAccent text-white text-[11px] font-[600] flex items-center justify-center">
                {appliedCount}
              </span>
            )}
          </div>
          <button
            type="button"
            aria-label={t('close', 'Close')}
            onClick={() => setOpen(false)}
            className="w-[32px] h-[32px] flex items-center justify-center rounded-[8px] text-newTableText hover:bg-designerAccent/15 hover:text-textColor transition-all"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M1 1L13 13M13 1L1 13"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-auto px-[14px] py-[14px] flex flex-col gap-[12px] scrollbar scrollbar-thumb-fifth scrollbar-track-newBgColor">
          {/* Timeframe */}
          <Section title={t('timeframe', 'Timeframe')}>
            <div className="flex flex-col gap-[8px]">
              <SubLabel>{t('date_range', 'Date range')}</SubLabel>
              <div className="flex items-center gap-[10px]">
                <div className="flex-1 border h-[42px] border-newTableBorder bg-newTableBorder gap-[1px] flex items-center rounded-[8px] overflow-hidden">
                  <button
                    type="button"
                    aria-label={t('previous_period', 'Previous period')}
                    onClick={() => shift('prev')}
                    className={clsx(navBtn, 'rtl:rotate-180')}
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
                  </button>
                  <div className="flex-1 text-center bg-newBgColorInner h-full flex items-center justify-center text-[14px]">
                    {displayText}
                  </div>
                  <button
                    type="button"
                    aria-label={t('next_period', 'Next period')}
                    onClick={() => shift('next')}
                    className={clsx(navBtn, 'rtl:rotate-180')}
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
                  </button>
                </div>
                <button
                  type="button"
                  onClick={goToday}
                  className="shrink-0 h-[42px] px-[12px] flex justify-center items-center rounded-[8px] cursor-pointer text-[14px] font-[500] bg-newBgColorInner border border-newTableBorder hover:text-textColor hover:bg-designerAccent/15 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-designerAccent/60"
                >
                  {t('today', 'Today')}
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-[8px]">
              <SubLabel>{t('window', 'Window')}</SubLabel>
              <div className="flex w-full p-[4px] border border-newTableBorder rounded-[8px] text-[14px] font-[500]">
                {(['day', 'week', 'month'] as const).map((mode) => (
                  <button
                    type="button"
                    key={mode}
                    onClick={() => setWindow(mode)}
                    className={clsx(
                      'flex-1 pt-[6px] pb-[5px] cursor-pointer text-center rounded-[6px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-designerAccent/60',
                      !customOpen && win === mode
                        ? 'text-white bg-designerAccent'
                        : 'text-newTableText hover:text-textColor'
                    )}
                  >
                    {t(mode, mode.charAt(0).toUpperCase() + mode.slice(1))}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setWin('custom');
                    setCustomOpen(true);
                  }}
                  className={clsx(
                    'flex-1 pt-[6px] pb-[5px] cursor-pointer text-center rounded-[6px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-designerAccent/60',
                    (customOpen || win === 'custom')
                      ? 'text-white bg-designerAccent'
                      : 'text-newTableText hover:text-textColor'
                  )}
                >
                  {t('custom', 'Custom')}
                </button>
              </div>

              {(customOpen || win === 'custom') && (
                <div className="flex justify-center rounded-[8px] border border-newTableBorder bg-newBgColorInner p-[8px]">
                  <RangeCalendar
                    value={[newDayjs(from).toDate(), newDayjs(to).toDate()]}
                    onChange={(range) => {
                      setCustomOpen(true);
                      if (range[0] && range[1]) {
                        onRangeChange({
                          from: dayjs(range[0]).format(FMT),
                          to: dayjs(range[1]).format(FMT),
                          compare,
                        });
                      }
                    }}
                    dayClassName={(_d, modifiers) =>
                      modifiers.selected || modifiers.inRange
                        ? '!text-white'
                        : modifiers.outside
                        ? '!text-newTableText'
                        : '!text-textColor'
                    }
                    classNames={{
                      calendarHeaderControl: 'text-textColor hover:!bg-designerAccent/15',
                      calendarHeaderLevel: 'text-textColor hover:!bg-designerAccent/15',
                      weekday: '!text-newTableText',
                    }}
                  />
                </div>
              )}
            </div>

            <label className="flex items-center gap-[10px] cursor-pointer select-none text-[14px] text-textColor">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={compare}
                onChange={(e) =>
                  onRangeChange({ from, to, compare: e.target.checked })
                }
              />
              <div className="relative w-[44px] h-[24px] shrink-0 bg-newTableBorder peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-[20px] after:w-[20px] after:transition-all peer-checked:bg-btnPrimary" />
              {t('compare_previous', 'Compare to previous period')}
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
        </div>

        <div className="shrink-0 bg-studioBg border-t border-studioBorder p-[14px] pb-[calc(env(safe-area-inset-bottom)+14px)] flex items-center gap-[10px]">
          <button
            type="button"
            onClick={clearAll}
            disabled={appliedCount === 0}
            className="flex-1 h-[40px] rounded-[8px] border border-newTableBorder text-[14px] font-[500] text-textColor hover:bg-designerAccent/10 transition-all disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent"
          >
            {appliedCount > 0
              ? t('clear_all_count', 'Clear all ({{count}})', {
                  count: appliedCount,
                })
              : t('clear_all', 'Clear all')}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex-1 h-[40px] rounded-[8px] bg-designerAccent text-white text-[14px] font-[600] hover:opacity-90 transition-all"
          >
            {t('done', 'Done')}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex items-center gap-[10px]">
      {/* Applied-filter chip track — fills the left, buttons pinned right. */}
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
              className="w-[18px] h-[18px] shrink-0 flex items-center justify-center rounded-full hover:bg-designerAccent/15 hover:text-textColor transition-all"
            >
              <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
                <path
                  d="M1 1L13 13M13 1L1 13"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
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

      {exportSlot}

      <button
        type="button"
        aria-label={
          appliedCount > 0
            ? t('filter_with_count', 'Filter ({{count}} applied)', {
                count: appliedCount,
              })
            : t('filter', 'Filter')
        }
        onClick={() => setOpen(true)}
        className="relative shrink-0 w-[42px] h-[42px] flex items-center justify-center rounded-[8px] border border-newTableBorder bg-newBgColorInner hover:text-textColor hover:border-designerAccent/50 transition-all"
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
          <span className="absolute -top-[6px] -end-[6px] min-w-[18px] h-[18px] px-[4px] rounded-full bg-designerAccent text-white text-[11px] font-[600] leading-[18px] text-center">
            {appliedCount}
          </span>
        )}
      </button>

      {typeof document !== 'undefined' && createPortal(drawer, document.body)}
    </div>
  );
};
