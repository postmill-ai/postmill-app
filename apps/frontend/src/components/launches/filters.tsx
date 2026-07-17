'use client';

import {
  useCalendar,
  ListStateFilter,
  EngagementFilter,
  MetricKey,
  DEFAULT_METRIC_FILTERS,
} from '@gitroom/frontend/components/launches/calendar.context';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { ReactNode, useCallback, useEffect, useState } from 'react';
import { SelectCustomer } from '@gitroom/frontend/components/launches/select.customer';
import { ChannelFilterSelect } from '@gitroom/frontend/components/launches/channel-filter-select';
import { CampaignFilterSelect } from '@gitroom/frontend/components/launches/campaign-filter-select';
import { TagFilterSelect } from '@gitroom/frontend/components/launches/tag-filter-select';
import { MetricFilter } from '@gitroom/frontend/components/launches/metric-filter';
import {
  SimpleMultiSelect,
  SimpleOption,
} from '@gitroom/frontend/components/launches/simple-multi-select';
import SafeImage from '@gitroom/react/helpers/safe.image';
import { RangeCalendar } from '@mantine/dates';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import i18next from 'i18next';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';

// Helper function to get start and end dates based on display type
function getDateRange(
  display: 'day' | 'week' | 'month' | 'list',
  referenceDate?: string
) {
  const date = referenceDate ? newDayjs(referenceDate) : newDayjs();

  switch (display) {
    case 'day':
      return {
        startDate: date.format('YYYY-MM-DD'),
        endDate: date.format('YYYY-MM-DD'),
      };
    case 'week':
      return {
        startDate: date.startOf('isoWeek').format('YYYY-MM-DD'),
        endDate: date.endOf('isoWeek').format('YYYY-MM-DD'),
      };
    case 'month':
      return {
        startDate: date.startOf('month').format('YYYY-MM-DD'),
        endDate: date.endOf('month').format('YYYY-MM-DD'),
      };
    case 'list':
      return {
        startDate: date.format('YYYY-MM-DD'),
        endDate: date.format('YYYY-MM-DD'),
      };
  }
}

export const Filters = () => {
  const calendar = useCalendar();
  const t = useT();

  // Set dayjs locale based on current language
  const currentLanguage = i18next.resolvedLanguage || 'en';
  dayjs.locale(currentLanguage);

  const isListView = calendar.display === 'list';
  // The list view shares the calendar's date navigator: while in list, the
  // day/week/month window granularity lives in `listRangeMode` (calendar views
  // encode it in `display`), so both surfaces read the same range controls.
  const rangeMode = (isListView ? calendar.listRangeMode : calendar.display) as
    | 'day'
    | 'week'
    | 'month';

  // Everything except the calendar/list view toggle lives in a right-side drawer,
  // opened by the Filter button in the header.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    timeframe: true,
  });
  // Custom date-range picker (inline calendar) open state + draft selection.
  const [customOpen, setCustomOpen] = useState(false);
  const [rangeDraft, setRangeDraft] = useState<[Date | null, Date | null]>([
    null,
    null,
  ]);
  const showCustomPicker = customOpen || calendar.customRange;
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  // Calculate display date range text (dates are shown in the user's timezone via newDayjs)
  const getDisplayText = () => {
    const startDate = newDayjs(calendar.startDate);
    const endDate = newDayjs(calendar.endDate);

    if (calendar.customRange) {
      return `${startDate.format('L')} - ${endDate.format('L')}`;
    }

    switch (rangeMode) {
      case 'day':
        return startDate.format('dddd (L)');
      case 'week':
        return `${startDate.format('L')} - ${endDate.format('L')}`;
      case 'month':
        return startDate.format('MMMM YYYY');
      default:
        return '';
    }
  };

  const setToday = useCallback(() => {
    const currentRange = getDateRange(rangeMode);

    // Check if we're already showing today's range
    if (
      calendar.startDate === currentRange.startDate &&
      calendar.endDate === currentRange.endDate
    ) {
      return; // No need to set the same range
    }

    calendar.setFilters({
      startDate: currentRange.startDate,
      endDate: currentRange.endDate,
      display: calendar.display as 'day' | 'week' | 'month' | 'list',
      customer: calendar.customer,
    });
  }, [calendar, rangeMode]);

  // Apply a day/week/month window. In list view this changes the shared window
  // granularity but stays in list; in calendar views it also switches the display.
  const applyRange = useCallback(
    (mode: 'day' | 'week' | 'month') => {
      if (isListView) {
        calendar.setListRangeMode(mode);
      }
      const range = getDateRange(mode);
      calendar.setFilters({
        startDate: range.startDate,
        endDate: range.endDate,
        display: isListView ? 'list' : mode,
        customer: calendar.customer,
      });
    },
    [calendar, isListView]
  );

  const setDay = useCallback(() => applyRange('day'), [applyRange]);
  const setWeek = useCallback(() => applyRange('week'), [applyRange]);
  const setMonth = useCallback(() => applyRange('month'), [applyRange]);

  const setList = useCallback(() => {
    if (calendar.display === 'list') {
      return;
    }

    // Keep the current window granularity when entering the list view.
    calendar.setListRangeMode(rangeMode);
    const range = getDateRange(rangeMode);
    calendar.setFilters({
      startDate: range.startDate,
      endDate: range.endDate,
      display: 'list',
      customer: calendar.customer,
    });
  }, [calendar, rangeMode]);

  const setCalendarView = useCallback(() => {
    if (calendar.display !== 'list') {
      return;
    }

    // Restore the calendar using the same window granularity the list was showing.
    const range = getDateRange(rangeMode);
    calendar.setFilters({
      startDate: range.startDate,
      endDate: range.endDate,
      display: rangeMode,
      customer: calendar.customer,
    });
  }, [calendar, rangeMode]);

  const setCustomer = useCallback(
    (customer: string) => {
      if (calendar.customer === customer) {
        return; // No need to set the same customer
      }
      calendar.setFilters({
        startDate: calendar.startDate,
        endDate: calendar.endDate,
        display: calendar.display as 'day' | 'week' | 'month',
        customer: customer,
      });
    },
    [calendar]
  );

  const next = useCallback(() => {
    const currentStart = newDayjs(calendar.startDate);
    const unit = rangeMode === 'day' ? 'day' : rangeMode === 'month' ? 'month' : 'week';
    const nextStart = currentStart.add(1, unit);

    const range = getDateRange(rangeMode, nextStart.format('YYYY-MM-DD'));
    calendar.setFilters({
      startDate: range.startDate,
      endDate: range.endDate,
      display: calendar.display as 'day' | 'week' | 'month' | 'list',
      customer: calendar.customer,
    });
  }, [calendar, rangeMode]);

  const previous = useCallback(() => {
    const currentStart = newDayjs(calendar.startDate);
    const unit = rangeMode === 'day' ? 'day' : rangeMode === 'month' ? 'month' : 'week';
    const prevStart = currentStart.subtract(1, unit);

    const range = getDateRange(rangeMode, prevStart.format('YYYY-MM-DD'));
    calendar.setFilters({
      startDate: range.startDate,
      endDate: range.endDate,
      display: calendar.display as 'day' | 'week' | 'month' | 'list',
      customer: calendar.customer,
    });
  }, [calendar, rangeMode]);

  const setCurrent = useCallback(
    (type: 'day' | 'week' | 'month') => () => {
      if (type === 'day') {
        setDay();
      } else if (type === 'week') {
        setWeek();
      } else if (type === 'month') {
        setMonth();
      }
    },
    [setDay, setWeek, setMonth]
  );

  const setEngagementFilter = useCallback(
    (next: EngagementFilter) => () => {
      if (calendar.engagementFilter === next) return;
      calendar.setEngagementFilter(next);
    },
    [calendar]
  );

  const setListStateFilter = useCallback(
    (next: ListStateFilter) => () => {
      if (calendar.listState === next) return;
      calendar.setListState(next);
    },
    [calendar]
  );

  const engagementFilterOptions: { value: EngagementFilter; label: string }[] = [
    { value: 'all', label: 'All posts' },
    { value: 'has_comments', label: 'Has replies' },
    { value: 'errors', label: 'Errors' },
    { value: 'top_performers', label: 'Top performers' },
  ];

  const listStateOptions: { value: ListStateFilter; label: string }[] = [
    { value: 'all', label: t('all', 'All') },
    { value: 'scheduled', label: t('scheduled', 'Scheduled') },
    { value: 'draft', label: t('draft', 'Draft') },
    { value: 'published', label: t('published', 'Published') },
  ];

  const viewToggle = (
    <div className="flex flex-row p-[4px] border border-newTableBorder rounded-[8px] text-[14px] font-[500]">
      <button type="button"
        onClick={setCalendarView}
        aria-label={t('calendar_view', 'Calendar view')}
        aria-pressed={!isListView}
        className={clsx(
          'pt-[6px] pb-[5px] cursor-pointer flex justify-center items-center w-[34px] text-center rounded-[6px]',
          !isListView && 'text-textItemFocused bg-boxFocused'
        )}
      >
        {/*calendar*/}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="17"
          height="19"
          viewBox="0 0 17 19"
          fill="none"
        >
          <path
            d="M15.75 7.41667H0.75M11.5833 0.75V4.08333M4.91667 0.75V4.08333M4.75 17.4167H11.75C13.1501 17.4167 13.8502 17.4167 14.385 17.1442C14.8554 16.9045 15.2378 16.522 15.4775 16.0516C15.75 15.5169 15.75 14.8168 15.75 13.4167V6.41667C15.75 5.01654 15.75 4.31647 15.4775 3.78169C15.2378 3.31129 14.8554 2.92883 14.385 2.68915C13.8502 2.41667 13.1501 2.41667 11.75 2.41667H4.75C3.34987 2.41667 2.6498 2.41667 2.11502 2.68915C1.64462 2.92883 1.26217 3.31129 1.02248 3.78169C0.75 4.31647 0.75 5.01654 0.75 6.41667V13.4167C0.75 14.8168 0.75 15.5169 1.02248 16.0516C1.26217 16.522 1.64462 16.9045 2.11502 17.1442C2.6498 17.4167 3.34987 17.4167 4.75 17.4167Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button type="button"
        onClick={setList}
        aria-label={t('list_view', 'List view')}
        aria-pressed={isListView}
        className={clsx(
          'pt-[6px] pb-[5px] flex justify-center items-center cursor-pointer w-[34px] text-center rounded-[6px]',
          isListView && 'text-textItemFocused bg-boxFocused'
        )}
      >
        {/*cards*/}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 20 20"
          fill="none"
        >
          <rect
            x="2.5"
            y="2.5"
            width="6"
            height="6"
            rx="1.5"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <rect
            x="11.5"
            y="2.5"
            width="6"
            height="6"
            rx="1.5"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <rect
            x="2.5"
            y="11.5"
            width="6"
            height="6"
            rx="1.5"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <rect
            x="11.5"
            y="11.5"
            width="6"
            height="6"
            rx="1.5"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
      </button>
    </div>
  );

  const sectionLabel = 'text-[12px] font-[600] uppercase tracking-wide text-newTableText';

  // SelectCustomer renders null with ≤1 customer; mirror that so the section
  // (and its label) only shows when there are multiple customers to pick from.
  const hasCustomers =
    new Set(calendar.integrations.map((i) => i?.customer?.id)).size > 1;

  // Toggle a value in a string[] filter.
  const toggleIn = (list: string[], value: string) =>
    list.includes(value)
      ? list.filter((x) => x !== value)
      : [...list, value];

  // Platform options — unique provider identifiers across the org's channels.
  const platformOptions: SimpleOption[] = Array.from(
    new Set(calendar.integrations.map((i) => i.identifier).filter(Boolean))
  )
    .sort()
    .map((identifier) => ({
      value: identifier,
      label: identifier.charAt(0).toUpperCase() + identifier.slice(1),
      icon: (
        <SafeImage
          src={`/icons/platforms/${identifier}.png`}
          className="rounded-[4px] w-[18px] h-[18px] object-cover"
          alt={identifier}
          width={18}
          height={18}
        />
      ),
    }));

  const creationMethodOptions: SimpleOption[] = [
    { value: 'WEB', label: t('web', 'Web') },
    { value: 'API', label: t('api', 'API') },
    { value: 'AUTOPOST', label: t('autopost', 'Autopost') },
    { value: 'MCP', label: t('mcp', 'MCP') },
    { value: 'CLI', label: t('cli', 'CLI') },
    { value: 'UNKNOWN', label: t('unknown', 'Unknown') },
  ];

  const approvalOptions: SimpleOption[] = [
    { value: 'pending', label: t('pending', 'Pending') },
    { value: 'approved', label: t('approved', 'Approved') },
    { value: 'rejected', label: t('rejected', 'Rejected') },
  ];

  const mediaTypeOptions: {
    value: 'all' | 'none' | 'image' | 'video';
    label: string;
  }[] = [
    { value: 'all', label: t('all', 'All') },
    { value: 'image', label: t('images', 'Images') },
    { value: 'video', label: t('videos', 'Videos') },
    { value: 'none', label: t('text_only', 'Text only') },
  ];

  // Applied-filter chips — one per non-default filter (matches the badge count),
  // each removable to reset that filter to its default.
  const opSymbol: Record<string, string> = {
    gte: '≥',
    gt: '>',
    lte: '≤',
    lt: '<',
    eq: '=',
  };
  const activeMetrics = (['views', 'likes', 'comments'] as MetricKey[]).filter(
    (k) => typeof calendar.metricFilter[k].value === 'number'
  );
  const metricSummary = activeMetrics
    .map(
      (k) =>
        `${k.charAt(0).toUpperCase() + k.slice(1)} ${
          opSymbol[calendar.metricFilter[k].op]
        } ${calendar.metricFilter[k].value}`
    )
    .join(', ');

  const multiLabel = (
    label: string,
    ids: string[],
    resolve: (id: string) => string | undefined
  ) =>
    ids.length === 1
      ? t('filter_applied_label', '{{label}}: {{value}}', {
          label,
          value: resolve(ids[0]) || ids[0],
        })
      : t('filter_applied_label', '{{label}}: {{value}}', {
          label,
          value: ids.length,
        });

  const appliedChips: { key: string; label: string; onClear: () => void }[] = [];
  if (calendar.listState !== 'all') {
    appliedChips.push({
      key: 'status',
      label: t('filter_applied_label', '{{label}}: {{value}}', {
        label: t('status', 'Status:'),
        value: listStateOptions.find((o) => o.value === calendar.listState)?.label || '',
      }),
      onClear: () => calendar.setListState('all'),
    });
  }
  if (calendar.engagementFilter !== 'all') {
    appliedChips.push({
      key: 'engagement',
      label: t('filter_applied_label', '{{label}}: {{value}}', {
        label: t('engagement', 'Engagement'),
        value:
          engagementFilterOptions.find((o) => o.value === calendar.engagementFilter)
            ?.label || '',
      }),
      onClear: () => calendar.setEngagementFilter('all'),
    });
  }
  if (calendar.channelFilter.length) {
    appliedChips.push({
      key: 'channels',
      label: multiLabel(
        t('channels', 'Channels'),
        calendar.channelFilter,
        (id) => calendar.integrations.find((i) => i.id === id)?.name
      ),
      onClear: () => calendar.setChannelFilter([]),
    });
  }
  if (calendar.campaignFilter.length) {
    appliedChips.push({
      key: 'campaigns',
      label: multiLabel(
        t('campaigns', 'Campaigns'),
        calendar.campaignFilter,
        (id) => calendar.campaigns.find((c) => c.id === id)?.name
      ),
      onClear: () => calendar.setCampaignFilter([]),
    });
  }
  if (calendar.tagFilter.length) {
    appliedChips.push({
      key: 'tags',
      label: multiLabel(
        t('post_tags', 'Post tags'),
        calendar.tagFilter,
        (id) => calendar.tags.find((tg) => tg.id === id)?.name
      ),
      onClear: () => calendar.setTagFilter([]),
    });
  }
  if (metricSummary) {
    appliedChips.push({
      key: 'metrics',
      label: metricSummary,
      onClear: () => calendar.setMetricFilter(DEFAULT_METRIC_FILTERS),
    });
  }
  if (calendar.platformFilter.length) {
    appliedChips.push({
      key: 'platform',
      label: multiLabel(
        t('platform', 'Platform'),
        calendar.platformFilter,
        (id) => platformOptions.find((o) => o.value === id)?.label
      ),
      onClear: () => calendar.setPlatformFilter([]),
    });
  }
  if (calendar.mediaTypeFilter !== 'all') {
    appliedChips.push({
      key: 'media',
      label: t('filter_applied_label', '{{label}}: {{value}}', {
        label: t('media', 'Media'),
        value:
          mediaTypeOptions.find((o) => o.value === calendar.mediaTypeFilter)?.label || '',
      }),
      onClear: () => calendar.setMediaTypeFilter('all'),
    });
  }
  if (calendar.creationMethodFilter.length) {
    appliedChips.push({
      key: 'creation',
      label: multiLabel(
        t('creation_method', 'Creation method'),
        calendar.creationMethodFilter,
        (id) => creationMethodOptions.find((o) => o.value === id)?.label
      ),
      onClear: () => calendar.setCreationMethodFilter([]),
    });
  }
  if (calendar.approvalFilter.length) {
    appliedChips.push({
      key: 'approval',
      label: multiLabel(
        t('approval', 'Approval'),
        calendar.approvalFilter,
        (id) => approvalOptions.find((o) => o.value === id)?.label
      ),
      onClear: () => calendar.setApprovalFilter([]),
    });
  }
  if (calendar.recurringOnly) {
    appliedChips.push({
      key: 'recurring',
      label: t('recurring_only', 'Recurring posts only'),
      onClear: () => calendar.setRecurringOnly(false),
    });
  }
  if (calendar.unreadOnly) {
    appliedChips.push({
      key: 'unread',
      label: t('unread_comments_only', 'Unread replies only'),
      onClear: () => calendar.setUnreadOnly(false),
    });
  }
  if (calendar.contentSearch.trim()) {
    appliedChips.push({
      key: 'search',
      label: t('filter_search_label', '{{label}}: "{{value}}"', {
        label: t('search', 'Search'),
        value: calendar.contentSearch.trim(),
      }),
      onClear: () => calendar.setContentSearch(''),
    });
  }
  if (calendar.customer) {
    appliedChips.push({
      key: 'customer',
      label: t('filter_applied_label', '{{label}}: {{value}}', {
        label: t('customer', 'Customer:'),
        value:
          calendar.integrations.find((i) => i?.customer?.id === calendar.customer)
            ?.customer?.name || '',
      }),
      onClear: () => setCustomer(''),
    });
  }

  const clearAll = () => appliedChips.forEach((chip) => chip.onClear());

  // Collapsible groups — Timeframe open by default (it holds the date nav), the
  // rest collapsed to keep the drawer short.
  const toggleGroup = (id: string) =>
    setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }));

  const group = (
    id: string,
    title: string,
    chipKeys: string[],
    children: ReactNode
  ) => {
    const open = !!openGroups[id];
    const activeCount = chipKeys.filter((k) =>
      appliedChips.some((c) => c.key === k)
    ).length;
    return (
      <div
        className={clsx(
          'border rounded-[10px] overflow-hidden bg-newBgColorInner transition-colors',
          activeCount > 0 ? 'border-btnPrimary/50' : 'border-studioBorder'
        )}
      >
        <button
          type="button"
          onClick={() => toggleGroup(id)}
          aria-expanded={open}
          className="w-full h-[46px] px-[14px] flex items-center gap-[8px] bg-studioBg hover:bg-btnPrimary/10 transition-colors"
        >
          <span className="text-[13px] font-[600] text-textColor">{title}</span>
          {activeCount > 0 && (
            <span className="min-w-[18px] h-[18px] px-[5px] rounded-full bg-btnPrimary text-white text-[10px] font-[600] flex items-center justify-center">
              {activeCount}
            </span>
          )}
          <div className="flex-1" />
          <svg
            className={clsx(
              'w-[14px] h-[14px] transition-transform duration-200',
              open && 'rotate-180',
              activeCount > 0 ? 'text-btnPrimary' : 'text-newTableText'
            )}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>
        <div
          className={clsx(
            'grid transition-[grid-template-rows] duration-300 ease-out',
            open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          )}
        >
          <div className="overflow-hidden">
            <div className="px-[14px] pb-[14px] pt-[14px] flex flex-col gap-[16px] border-t border-studioBorder">
              {children}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Section header: uppercase label, an accent dot + inline "Clear" when the
  // section currently has a non-default value.
  const sectionHeader = (title: string, chipKey?: string) => {
    const chip = chipKey
      ? appliedChips.find((c) => c.key === chipKey)
      : undefined;
    return (
      <div className="flex items-center justify-between min-h-[16px]">
        <div className="flex items-center gap-[6px]">
          {chip && (
            <span className="w-[6px] h-[6px] rounded-full bg-btnPrimary" />
          )}
          <div className={sectionLabel}>{title}</div>
        </div>
        {chip && (
          <button
            type="button"
            onClick={chip.onClear}
            className="text-[11px] font-[600] text-btnPrimaryAccent hover:underline"
          >
            {t('clear', 'Clear')}
          </button>
        )}
      </div>
    );
  };

  return (
    <>
      {/* Header — the in-view window/date range (text), then the view toggle and Filter button. */}
      <div className="text-textColor flex flex-row gap-[8px] items-center select-none">
        <div className="flex-1 min-w-0 flex items-baseline gap-[8px]">
          <span className="text-[14px] font-[600] text-textColor shrink-0">
            {calendar.customRange
              ? t('custom', 'Custom')
              : t(rangeMode, rangeMode.charAt(0).toUpperCase() + rangeMode.slice(1))}
          </span>
          <span className="text-[13px] text-newTableText truncate">
            {getDisplayText()}
          </span>
        </div>
        {viewToggle}
        <button
          type="button"
          aria-label={
            calendar.appliedFilterCount > 0
              ? t('filter_with_count', 'Filter ({{count}} applied)', {
                  count: calendar.appliedFilterCount,
                })
              : t('filter', 'Filter')
          }
          onClick={() => setDrawerOpen(true)}
          className="relative w-[42px] h-[42px] flex items-center justify-center rounded-[8px] border border-newTableBorder bg-newBgColorInner hover:text-textItemFocused hover:bg-boxFocused transition-all"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
          >
            <path
              d="M21 4H3l7.2 8.52v5.73l3.6 1.75v-7.48L21 4z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {calendar.appliedFilterCount > 0 && (
            <span className="absolute -top-[6px] -end-[6px] min-w-[18px] h-[18px] px-[4px] rounded-full bg-btnPrimary text-white text-[11px] font-[600] leading-[18px] text-center">
              {calendar.appliedFilterCount}
            </span>
          )}
        </button>
      </div>

      {/* Applied-filter track — a chip per non-default filter, each removable. */}
      {appliedChips.length > 0 && (
        <div className="flex flex-row flex-wrap gap-[8px] items-center select-none text-textColor">
          {appliedChips.map((chip) => (
            <div
              key={chip.key}
              className="flex items-center gap-[6px] h-[30px] pl-[12px] pr-[6px] rounded-full border border-newTableBorder bg-newBgColorInner text-[13px] max-w-[240px]"
            >
              <span className="truncate">{chip.label}</span>
              <button
                type="button"
                aria-label={t('remove_filter', 'Remove filter')}
                onClick={chip.onClear}
                className="w-[18px] h-[18px] shrink-0 flex items-center justify-center rounded-full hover:bg-boxFocused hover:text-textItemFocused transition-all"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="10"
                  height="10"
                  viewBox="0 0 14 14"
                  fill="none"
                >
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
          <button
            type="button"
            onClick={clearAll}
            className="h-[30px] px-[10px] text-[13px] font-[500] text-newTableText hover:text-textColor transition-all"
          >
            {t('clear_all', 'Clear all')}
          </button>
        </div>
      )}

      {/* Right-side filter drawer. z-[210] sits above the mobile bottom tab bar.
          Always mounted so it can slide in/out; pointer-events off when closed. */}
      <div
        aria-hidden={!drawerOpen}
        inert={!drawerOpen}
        className={clsx(
          'fixed inset-0 z-[210] flex justify-end',
          !drawerOpen && 'pointer-events-none'
        )}
      >
        <button type="button"
          className={clsx(
            'absolute inset-0 bg-black/50 transition-opacity duration-200',
            drawerOpen ? 'opacity-100' : 'opacity-0'
          )}
          onClick={() => setDrawerOpen(false)}
        />
        <div
          className={clsx(
            'relative h-full w-[380px] max-w-[90vw] bg-newBgColor border-s border-studioBorder shadow-2xl flex flex-col text-textColor',
            'transition-transform duration-300 ease-out will-change-transform',
            drawerOpen ? 'translate-x-0' : 'translate-x-full rtl:-translate-x-full'
          )}
        >
          <div className="h-[56px] shrink-0 flex items-center justify-between px-[16px] bg-studioBg border-b border-studioBorder">
            <div className="flex items-center gap-[8px]">
              <div className="text-[16px] font-[600]">{t('filters', 'Filters')}</div>
              {calendar.appliedFilterCount > 0 && (
                <span className="min-w-[20px] h-[20px] px-[6px] rounded-full bg-btnPrimary text-white text-[11px] font-[600] flex items-center justify-center">
                  {calendar.appliedFilterCount}
                </span>
              )}
            </div>
            <button
              type="button"
              aria-label={t('close', 'Close')}
              onClick={() => setDrawerOpen(false)}
              className="w-[32px] h-[32px] flex items-center justify-center rounded-[8px] text-newTableText hover:bg-btnPrimary/15 hover:text-textColor transition-all"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
              >
                <path
                  d="M1 1L13 13M13 1L1 13"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-auto px-[14px] py-[14px] flex flex-col gap-[10px] scrollbar scrollbar-thumb-fifth scrollbar-track-newBgColor">
            {group(
              'timeframe',
              t('timeframe', 'Timeframe'),
              [],
              <>
                {/* Date range */}
                <div className="flex flex-col gap-[8px]">
                  {sectionHeader(t('date_range', 'Date range'))}
                  <div className="flex items-center gap-[10px]">
                    <div className="flex-1 border h-[42px] border-newTableBorder bg-newTableBorder gap-[1px] flex items-center rounded-[8px] overflow-hidden">
                      <button type="button"
                        onClick={previous}
                        className="cursor-pointer text-textColor rtl:rotate-180 px-[9px] bg-newBgColorInner h-full flex items-center justify-center hover:text-textItemFocused hover:bg-boxFocused"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="8"
                          height="12"
                          viewBox="0 0 8 12"
                          fill="none"
                        >
                          <path
                            d="M6.5 11L1.5 6L6.5 1"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                      <div className="flex-1 text-center bg-newBgColorInner h-full flex items-center justify-center">
                        <div className="py-[3px] px-[9px] rounded-[5px] transition-all text-[14px]">
                          {getDisplayText()}
                        </div>
                      </div>
                      <button type="button"
                        onClick={next}
                        className="cursor-pointer text-textColor rtl:rotate-180 px-[9px] bg-newBgColorInner h-full flex items-center justify-center hover:text-textItemFocused hover:bg-boxFocused"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="8"
                          height="12"
                          viewBox="0 0 8 12"
                          fill="none"
                        >
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
                    <button type="button"
                      onClick={setToday}
                      className="shrink-0 hover:text-textItemFocused hover:bg-boxFocused h-[42px] px-[12px] flex justify-center items-center rounded-[8px] transition-all cursor-pointer text-[14px] font-[500] bg-newBgColorInner border border-newTableBorder"
                    >
                      {t('today', 'Today')}
                    </button>
                  </div>
                </div>

                {/* Window granularity + custom range */}
                <div className="flex flex-col gap-[8px]">
                  {sectionHeader(t('window', 'Window'))}
                  <div className="flex w-full p-[4px] border border-newTableBorder rounded-[8px] text-[14px] font-[500]">
                    {(['day', 'week', 'month'] as const).map((mode) => (
                      <button type="button"
                        key={mode}
                        className={clsx(
                          'flex-1 pt-[6px] pb-[5px] cursor-pointer text-center rounded-[6px]',
                          !showCustomPicker &&
                            rangeMode === mode &&
                            'text-textItemFocused bg-boxFocused'
                        )}
                        onClick={() => {
                          setCustomOpen(false);
                          if (mode === 'day') setDay();
                          else if (mode === 'week') setWeek();
                          else setMonth();
                        }}
                      >
                        {t(mode, mode.charAt(0).toUpperCase() + mode.slice(1))}
                      </button>
                    ))}
                    <button type="button"
                      className={clsx(
                        'flex-1 pt-[6px] pb-[5px] cursor-pointer text-center rounded-[6px]',
                        showCustomPicker && 'text-textItemFocused bg-boxFocused'
                      )}
                      onClick={() => {
                        setRangeDraft([
                          newDayjs(calendar.startDate).toDate(),
                          newDayjs(calendar.endDate).toDate(),
                        ]);
                        setCustomOpen(true);
                      }}
                    >
                      {t('custom', 'Custom')}
                    </button>
                  </div>

                  {showCustomPicker && (
                    <div className="flex justify-center rounded-[8px] border border-newTableBorder bg-newBgColorInner p-[8px]">
                      <RangeCalendar
                        value={rangeDraft}
                        onChange={(range) => {
                          setRangeDraft(range);
                          if (range[0] && range[1]) {
                            calendar.applyCustomRange(
                              dayjs(range[0]).format('YYYY-MM-DD'),
                              dayjs(range[1]).format('YYYY-MM-DD')
                            );
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
                          calendarHeaderControl:
                            'text-textColor hover:!bg-boxFocused',
                          calendarHeaderLevel:
                            'text-textColor hover:!bg-boxFocused',
                          weekday: '!text-newTableText',
                        }}
                      />
                    </div>
                  )}
                </div>
              </>
            )}

            {group(
              'content',
              t('content', 'Content'),
              ['search', 'media', 'tags'],
              <>
                {/* Content search */}
                <div className="flex flex-col gap-[8px]">
                  {sectionHeader(t('search', 'Search'), 'search')}
                  <div className="relative">
                    <svg
                      className="absolute left-[12px] top-1/2 -translate-y-1/2 w-[16px] h-[16px] text-newTableText"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z"
                      />
                    </svg>
                    <input
                      type="text"
                      value={calendar.contentSearch}
                      onChange={(e) => calendar.setContentSearch(e.target.value)}
                      placeholder={t('search_post_content', 'Search post content...')}
                      className="w-full h-[38px] pl-[38px] pr-[10px] rounded-[8px] bg-newBgColorInner border border-newColColor text-[14px] text-textColor outline-none focus:border-btnPrimary"
                    />
                  </div>
                </div>

                {/* Media type */}
                <div className="flex flex-col gap-[8px]">
                  {sectionHeader(t('media', 'Media'), 'media')}
                  <div className="flex w-full p-[4px] border border-newTableBorder rounded-[8px] text-[14px] font-[500]">
                    {mediaTypeOptions.map((option) => (
                      <button type="button"
                        key={option.value}
                        onClick={() => calendar.setMediaTypeFilter(option.value)}
                        className={clsx(
                          'flex-1 pt-[6px] pb-[5px] cursor-pointer px-[6px] text-center rounded-[6px]',
                          calendar.mediaTypeFilter === option.value &&
                            'text-textItemFocused bg-boxFocused'
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Post tags — multi-select, only when the org has tags. */}
                {calendar.tags.length > 0 && (
                  <div className="flex flex-col gap-[8px]">
                    {sectionHeader(t('post_tags', 'Post tags'), 'tags')}
                    <TagFilterSelect
                      tags={calendar.tags}
                      selectedIds={calendar.tagFilter}
                      onToggle={(id) => {
                        calendar.setTagFilter(
                          calendar.tagFilter.includes(id)
                            ? calendar.tagFilter.filter((x) => x !== id)
                            : [...calendar.tagFilter, id]
                        );
                      }}
                    />
                  </div>
                )}
              </>
            )}

            {group(
              'status',
              t('status_type', 'Status & type'),
              ['status', 'approval', 'creation', 'recurring'],
              <>
                {/* Status filter — applies to both the calendar and the list view. */}
                <div className="flex flex-col gap-[8px]">
                  {sectionHeader(t('status', 'Status:'), 'status')}
                  <div className="flex w-full p-[4px] border border-newTableBorder rounded-[8px] text-[14px] font-[500]">
                    {listStateOptions.map((option) => (
                      <button type="button"
                        key={option.value}
                        onClick={setListStateFilter(option.value)}
                        className={clsx(
                          'flex-1 pt-[6px] pb-[5px] cursor-pointer px-[6px] text-center rounded-[6px]',
                          calendar.listState === option.value &&
                            'text-textItemFocused bg-boxFocused'
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Draft approval status */}
                <div className="flex flex-col gap-[8px]">
                  {sectionHeader(t('approval', 'Approval'), 'approval')}
                  <SimpleMultiSelect
                    options={approvalOptions}
                    selectedIds={calendar.approvalFilter}
                    onToggle={(v) =>
                      calendar.setApprovalFilter(
                        toggleIn(calendar.approvalFilter, v)
                      )
                    }
                    emptyLabel={t('any_approval', 'Any status')}
                  />
                </div>

                {/* Creation method */}
                <div className="flex flex-col gap-[8px]">
                  {sectionHeader(t('creation_method', 'Creation method'), 'creation')}
                  <SimpleMultiSelect
                    options={creationMethodOptions}
                    selectedIds={calendar.creationMethodFilter}
                    onToggle={(v) =>
                      calendar.setCreationMethodFilter(
                        toggleIn(calendar.creationMethodFilter, v)
                      )
                    }
                    emptyLabel={t('any_method', 'Any method')}
                  />
                </div>

                {/* Recurring toggle */}
                <label className="flex items-center gap-[10px] cursor-pointer text-[14px] text-textColor">
                  <input
                    type="checkbox"
                    checked={calendar.recurringOnly}
                    onChange={(e) => calendar.setRecurringOnly(e.target.checked)}
                    className="w-[16px] h-[16px] accent-btnPrimary"
                  />
                  {t('recurring_only', 'Recurring posts only')}
                </label>
              </>
            )}

            {group(
              'engagement',
              t('engagement', 'Engagement'),
              ['engagement', 'metrics', 'unread'],
              <>
                {/* Engagement filter */}
                <div className="flex flex-col gap-[8px]">
                  {sectionHeader(t('engagement', 'Engagement'), 'engagement')}
                  <div className="flex flex-row flex-wrap gap-[8px] text-[14px] font-[500]">
                    {engagementFilterOptions.map((option) => (
                      <button type="button"
                        key={option.value}
                        onClick={setEngagementFilter(option.value)}
                        className={clsx(
                          'cursor-pointer px-[10px] py-[4px] rounded-full border transition-all',
                          calendar.engagementFilter === option.value
                            ? 'bg-btnPrimary text-white border-btnPrimary'
                            : 'border-newTableBorder text-newTableText hover:text-textColor'
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Engagement metrics — views / likes / comments (operator + value). */}
                <div className="flex flex-col gap-[8px]">
                  {sectionHeader(t('metrics', 'Metrics'), 'metrics')}
                  <MetricFilter
                    value={calendar.metricFilter}
                    onChange={calendar.setMetricFilter}
                  />
                </div>

                {/* Unread toggle */}
                <label className="flex items-center gap-[10px] cursor-pointer text-[14px] text-textColor">
                  <input
                    type="checkbox"
                    checked={calendar.unreadOnly}
                    onChange={(e) => calendar.setUnreadOnly(e.target.checked)}
                    className="w-[16px] h-[16px] accent-btnPrimary"
                  />
                  {t('unread_comments_only', 'Unread replies only')}
                </label>
              </>
            )}

            {group(
              'channels',
              t('channels_campaigns', 'Channels & campaigns'),
              ['channels', 'platform', 'campaigns', 'customer'],
              <>
                {/* Channels — multi-select, same display as the composer picker. */}
                <div className="flex flex-col gap-[8px]">
                  {sectionHeader(t('channels', 'Channels'), 'channels')}
                  <ChannelFilterSelect
                    integrations={calendar.integrations}
                    selectedIds={calendar.channelFilter}
                    onToggle={(integration) => {
                      const id = integration.id;
                      calendar.setChannelFilter(
                        calendar.channelFilter.includes(id)
                          ? calendar.channelFilter.filter((x) => x !== id)
                          : [...calendar.channelFilter, id]
                      );
                    }}
                  />
                </div>

                {/* Platform / network — all accounts of a provider type. */}
                {platformOptions.length > 1 && (
                  <div className="flex flex-col gap-[8px]">
                    {sectionHeader(t('platform', 'Platform'), 'platform')}
                    <SimpleMultiSelect
                      options={platformOptions}
                      selectedIds={calendar.platformFilter}
                      onToggle={(v) =>
                        calendar.setPlatformFilter(
                          toggleIn(calendar.platformFilter, v)
                        )
                      }
                      emptyLabel={t('all_platforms', 'All platforms')}
                      searchable
                    />
                  </div>
                )}

                {/* Campaigns — multi-select, only when the org has campaigns. */}
                {calendar.campaigns.length > 0 && (
                  <div className="flex flex-col gap-[8px]">
                    {sectionHeader(t('campaigns', 'Campaigns'), 'campaigns')}
                    <CampaignFilterSelect
                      campaigns={calendar.campaigns}
                      selectedIds={calendar.campaignFilter}
                      onToggle={(id) => {
                        calendar.setCampaignFilter(
                          calendar.campaignFilter.includes(id)
                            ? calendar.campaignFilter.filter((x) => x !== id)
                            : [...calendar.campaignFilter, id]
                        );
                      }}
                    />
                  </div>
                )}

                {/* Customer / client */}
                {hasCustomers && (
                  <div className="flex flex-col gap-[8px]">
                    {sectionHeader(t('customer', 'Customer:'), 'customer')}
                    <SelectCustomer
                      customer={calendar.customer as string}
                      onChange={(customer: string) => setCustomer(customer)}
                      integrations={calendar.integrations}
                    />
                  </div>
                )}
              </>
            )}
          </div>

          {/* Sticky footer — reset everything / dismiss. */}
          <div className="shrink-0 bg-studioBg border-t border-studioBorder p-[14px] pb-[calc(env(safe-area-inset-bottom)+14px)] flex items-center gap-[10px]">
            <button
              type="button"
              onClick={clearAll}
              disabled={calendar.appliedFilterCount === 0}
              className="flex-1 h-[40px] rounded-[8px] border border-newTableBorder text-[14px] font-[500] text-textColor hover:bg-btnPrimary/10 transition-all disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent"
            >
              {calendar.appliedFilterCount > 0
                ? t('clear_all_count', 'Clear all ({{count}})', {
                    count: calendar.appliedFilterCount,
                  })
                : t('clear_all', 'Clear all')}
            </button>
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="flex-1 h-[40px] rounded-[8px] bg-btnPrimary text-white text-[14px] font-[600] hover:opacity-90 transition-all"
            >
              {t('done', 'Done')}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
