'use client';

import 'reflect-metadata';
import {
  createContext,
  FC,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import dayjs from 'dayjs';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import type { Post, Integration, Tags } from '@prisma/client';
import { useSearchParams } from 'next/navigation';
import isoWeek from 'dayjs/plugin/isoWeek';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import { extend } from 'dayjs';
import useCookie from 'react-use-cookie';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
import { timer } from '@gitroom/helpers/utils/timer';
import { expandPosts } from '@gitroom/helpers/utils/posts.list.minify';
extend(isoWeek);
extend(weekOfYear);

export type ListStateFilter = 'all' | 'scheduled' | 'draft' | 'published';

export type EngagementFilter = 'all' | 'has_comments' | 'errors' | 'top_performers';

export type MetricOp = 'gt' | 'lt' | 'gte' | 'lte' | 'eq';
export type MetricKey = 'views' | 'likes' | 'comments';
export interface MetricConstraint {
  op: MetricOp;
  value: number | null;
}
export type MetricFilters = Record<MetricKey, MetricConstraint>;

export const DEFAULT_METRIC_FILTERS: MetricFilters = {
  views: { op: 'gte', value: null },
  likes: { op: 'gte', value: null },
  comments: { op: 'gte', value: null },
};

export const CalendarContext = createContext({
  startDate: newDayjs().startOf('isoWeek').format('YYYY-MM-DD'),
  endDate: newDayjs().endOf('isoWeek').format('YYYY-MM-DD'),
  customer: null as string | null,
  loading: true,
  error: null as any,
  sets: [] as { name: string; id: string; content: string[] }[],
  signature: undefined as any,
  comments: [] as Array<{
    date: string;
    total: number;
  }>,
  integrations: [] as (Integrations & {
    refreshNeeded?: boolean;
  })[],
  trendings: [] as string[],
  posts: [] as Array<
    Post & {
      integration: Integration;
      tags: {
        tag: Tags;
      }[];
      lastViews?: number | null;
      lastLikes?: number | null;
      lastComments?: number | null;
      commentCount?: number;
      unreadComments?: number;
    }
  >,
  reloadCalendarView: () => {
    /** empty **/
  },
  display: 'week',
  setFilters: (filters: {
    startDate: string;
    endDate: string;
    display: 'week' | 'month' | 'day' | 'list';
    customer: string | null;
  }) => {
    /** empty **/
  },
  changeDate: (id: string, date: dayjs.Dayjs) => {
    /** empty **/
  },
  // List view specific — the list renders the same date-range `posts` the
  // calendar loads, so it shares the date navigator instead of paginating.
  listState: 'all' as ListStateFilter,
  setListState: (state: ListStateFilter) => {
    /** empty **/
  },
  // The day/week/month window granularity used while in list view (the calendar
  // views encode this in `display`; list keeps it here so the same nav drives both).
  listRangeMode: 'week' as 'day' | 'week' | 'month',
  setListRangeMode: (mode: 'day' | 'week' | 'month') => {
    /** empty **/
  },
  engagementFilter: 'all' as EngagementFilter,
  setEngagementFilter: (filter: EngagementFilter) => {
    /** empty **/
  },
  // Multi-select channel filter (integration ids) — client-side over the loaded
  // date-range posts, applies to both the calendar and the list view.
  channelFilter: [] as string[],
  setChannelFilter: (ids: string[]) => {
    /** empty **/
  },
  // Multi-select campaign filter (campaign ids), same client-side approach.
  campaigns: [] as { id: string; name: string }[],
  campaignFilter: [] as string[],
  setCampaignFilter: (ids: string[]) => {
    /** empty **/
  },
  // Multi-select post-tag filter (tag ids) — post matches if it has any selected tag.
  tags: [] as { id: string; name: string; color: string }[],
  tagFilter: [] as string[],
  setTagFilter: (ids: string[]) => {
    /** empty **/
  },
  // Per-metric operator+value filter for views/likes/comments.
  metricFilter: DEFAULT_METRIC_FILTERS as MetricFilters,
  setMetricFilter: (next: MetricFilters) => {
    /** empty **/
  },
  // Free-text content search (HTML-stripped match on post content).
  contentSearch: '' as string,
  setContentSearch: (v: string) => {
    /** empty **/
  },
  // Platform/network filter (provider identifiers), distinct from per-account channels.
  platformFilter: [] as string[],
  setPlatformFilter: (ids: string[]) => {
    /** empty **/
  },
  // Creation-method filter (WEB/API/AUTOPOST/MCP/CLI/UNKNOWN).
  creationMethodFilter: [] as string[],
  setCreationMethodFilter: (ids: string[]) => {
    /** empty **/
  },
  // Draft approval-status filter (pending/approved/rejected).
  approvalFilter: [] as string[],
  setApprovalFilter: (ids: string[]) => {
    /** empty **/
  },
  // Media-type filter (all / none / image / video).
  mediaTypeFilter: 'all' as 'all' | 'none' | 'image' | 'video',
  setMediaTypeFilter: (v: 'all' | 'none' | 'image' | 'video') => {
    /** empty **/
  },
  // Boolean toggles.
  recurringOnly: false,
  setRecurringOnly: (v: boolean) => {
    /** empty **/
  },
  unreadOnly: false,
  setUnreadOnly: (v: boolean) => {
    /** empty **/
  },
  // Number of non-default filters currently applied (for the filter-button badge).
  appliedFilterCount: 0,
  // Whether the current window is a user-picked custom date range.
  customRange: false,
  applyCustomRange: (startDate: string, endDate: string) => {
    /** empty **/
  },
});

export interface Integrations {
  name: string;
  id: string;
  disabled?: boolean;
  inBetweenSteps: boolean;
  editor: 'none' | 'normal' | 'markdown' | 'html';
  stripLinks?: boolean;
  display: string;
  identifier: string;
  type: string;
  picture: string;
  changeProfilePicture: boolean;
  additionalSettings: string;
  changeNickName: boolean;
  time: {
    time: number;
  }[];
  customer?: {
    name?: string;
    id?: string;
  };
}

// Helper function to get start and end dates based on display type
function getDateRange(display: string, referenceDate?: string) {
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
    default:
      return {
        startDate: date.startOf('isoWeek').format('YYYY-MM-DD'),
        endDate: date.endOf('isoWeek').format('YYYY-MM-DD'),
      };
  }
}

export const CalendarWeekProvider: FC<{
  children: ReactNode;
  integrations: Integrations[];
}> = ({ children, integrations }) => {
  const fetch = useFetch();
  const [dateOverrides, setDateOverrides] = useState<Record<string, string>>({});
  const [trendings] = useState<string[]>([]);
  const searchParams = useSearchParams();
  const [displaySaved, setDisplaySaved] = useCookie('calendar-display', 'week');
  const display = searchParams.get('display') || displaySaved;

  // List view state — the list now renders the same date-range posts as the
  // calendar, so `listState` is a client-side filter over that window (no paging).
  const [listState, setListState] = useState<ListStateFilter>('all');
  const [listRangeSaved, setListRangeSaved] = useCookie(
    'calendar-list-range',
    'week'
  );
  const listRangeMode = (['day', 'week', 'month'].includes(listRangeSaved)
    ? listRangeSaved
    : 'week') as 'day' | 'week' | 'month';
  const setListRangeMode = useCallback(
    (mode: 'day' | 'week' | 'month') => setListRangeSaved(mode),
    [setListRangeSaved]
  );

  const [engagementFilter, setEngagementFilter] = useState<EngagementFilter>('all');
  const [channelFilter, setChannelFilter] = useState<string[]>([]);
  const [campaignFilter, setCampaignFilter] = useState<string[]>([]);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [metricFilter, setMetricFilter] = useState<MetricFilters>(
    DEFAULT_METRIC_FILTERS
  );
  const [contentSearch, setContentSearch] = useState('');
  const [platformFilter, setPlatformFilter] = useState<string[]>([]);
  const [creationMethodFilter, setCreationMethodFilter] = useState<string[]>([]);
  const [approvalFilter, setApprovalFilter] = useState<string[]>([]);
  const [mediaTypeFilter, setMediaTypeFilter] = useState<
    'all' | 'none' | 'image' | 'video'
  >('all');
  const [recurringOnly, setRecurringOnly] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [customRange, setCustomRange] = useState(false);

  // Initialize with current date range based on URL params or defaults
  const initStartDate = searchParams.get('startDate');
  const initEndDate = searchParams.get('endDate');
  const initCustomer = searchParams.get('customer');

  const initialRange =
    initStartDate && initEndDate
      ? { startDate: initStartDate, endDate: initEndDate }
      : getDateRange(display === 'list' ? listRangeMode : display);

  const [filters, setFilters] = useState({
    startDate: initialRange.startDate,
    endDate: initialRange.endDate,
    customer: initCustomer || null,
    display,
  });

  const params = useMemo(() => {
    return new URLSearchParams({
      display: filters.display,
      startDate: filters.startDate,
      endDate: filters.endDate,
      customer: filters?.customer?.toString() || '',
    }).toString();
  }, [filters]);

  // Calendar view data fetcher
  const loadData = useCallback(async () => {
    const modifiedParams = new URLSearchParams({
      display: filters.display,
      customer: filters?.customer?.toString() || '',
      startDate: newDayjs(filters.startDate).startOf('day').utc().format(),
      endDate: newDayjs(filters.endDate).endOf('day').utc().format(),
    }).toString();

    const res = await fetch(`/posts?${modifiedParams}`);
    if (!res.ok) {
      // Without this, error JSON flows through `expandPosts` and renders as an
      // empty calendar — a user seeing "no posts" during an API blip may
      // recreate/reschedule. Throw so SWR surfaces `error` for a retry banner.
      throw new Error('could_not_load_posts');
    }
    const data = await res.json();
    return expandPosts(data);
  }, [fetch, filters]);

  // Single date-range fetch drives both the calendar and the list view (the list
  // renders the same window as a chronological list).
  const {
    data: calendarData,
    isLoading: calendarIsLoading,
    error: calendarError,
    mutate: mutateCalendar,
  } = useSWR(`/posts-${params}`, loadData, {
    refreshInterval: 3600000,
    refreshWhenOffline: false,
    refreshWhenHidden: false,
    revalidateOnFocus: false,
  });

  const defaultSign = useCallback(async () => {
    return await (await fetch('/signatures/default')).json();
  }, [fetch]);

  const setList = useCallback(async () => {
    return (await fetch('/sets')).json();
  }, [fetch]);

  const loadCampaigns = useCallback(async () => {
    const r = await fetch('/campaigns');
    if (!r.ok) return [];
    return r.json();
  }, [fetch]);

  const loadTags = useCallback(async () => {
    const r = await fetch('/posts/tags');
    if (!r.ok) return { tags: [] };
    return r.json();
  }, [fetch]);

  const { data: sets, mutate } = useSWR('sets', setList, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });
  const { data: sign } = useSWR('default-sign', defaultSign, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });
  const { data: campaignList } = useSWR('/campaigns', loadCampaigns, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });
  const campaigns = useMemo(
    () =>
      (campaignList || []).map((c: any) => ({ id: c.id, name: c.name })),
    [campaignList]
  );
  const { data: tagsData } = useSWR('/posts/tags', loadTags, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });
  const tags = useMemo(
    () =>
      (tagsData?.tags || []).map((tg: any) => ({
        id: tg.id,
        name: tg.name,
        color: tg.color,
      })),
    [tagsData?.tags]
  );

  const setFiltersWrapper = useCallback(
    (newFilters: {
      startDate: string;
      endDate: string;
      display: 'week' | 'month' | 'day' | 'list';
      customer: string | null;
    }) => {
      setDisplaySaved(newFilters.display);
      setFilters(newFilters);
      // Any standard window change clears a custom range.
      setCustomRange(false);

      const path = [
        `startDate=${newFilters.startDate}`,
        `endDate=${newFilters.endDate}`,
        `display=${newFilters.display}`,
        newFilters.customer ? `customer=${newFilters.customer}` : ``,
      ].filter((f) => f);
      window.history.replaceState(null, '', `/posts?${path.join('&')}`);
    },
    [setDisplaySaved]
  );

  // Arbitrary start/end date range chosen from the calendar picker. It renders in
  // the list view (which paginates any range) and is flagged so the header/window
  // controls show "Custom" instead of a day/week/month window.
  const applyCustomRange = useCallback(
    (startDate: string, endDate: string) => {
      // Keep the list view if already there (it paginates any range); otherwise
      // use a week-style grid (hourly columns) rendered by the RangeView.
      const display = filters.display === 'list' ? 'list' : 'week';
      setFiltersWrapper({
        startDate,
        endDate,
        display,
        customer: filters.customer,
      });
      setCustomRange(true);
    },
    [setFiltersWrapper, filters.display, filters.customer]
  );

  const posts = useMemo(() => calendarData?.posts || [], [calendarData?.posts]);
  const comments = useMemo(() => calendarData?.comments || [], [calendarData?.comments]);

  // Local optimistic date edits are layered over the fetched post set so we
  // don't need an effect to keep a mirrored state in sync with `posts`.
  const internalData = useMemo(() => {
    if (!Object.keys(dateOverrides).length) {
      return posts;
    }
    return posts.map((post: any) =>
      dateOverrides[post.id]
        ? { ...post, publishDate: dateOverrides[post.id] }
        : post
    );
  }, [posts, dateOverrides]);

  const filteredPosts = useMemo(() => {
    // State filter (All/Scheduled/Draft/Published) applies to BOTH the calendar
    // and the list, so it lives here on the shared post set.
    let base = internalData;
    if (listState !== 'all') {
      const wanted =
        listState === 'scheduled'
          ? 'QUEUE'
          : listState === 'draft'
          ? 'DRAFT'
          : 'PUBLISHED';
      base = base.filter((post: any) => post.state === wanted);
    }

    // Multi-select channel filter (integration ids).
    if (channelFilter.length) {
      const set = new Set(channelFilter);
      base = base.filter((post: any) => set.has(post.integration?.id));
    }

    // Multi-select campaign filter (campaign ids).
    if (campaignFilter.length) {
      const set = new Set(campaignFilter);
      base = base.filter((post: any) => set.has(post.campaignId));
    }

    // Multi-select post-tag filter — post matches if it has any selected tag.
    if (tagFilter.length) {
      const set = new Set(tagFilter);
      base = base.filter((post: any) =>
        (post.tags || []).some((tw: any) => set.has(tw?.tag?.id))
      );
    }

    // Per-metric operator+value filter (views/likes/comments).
    const metricKeys: MetricKey[] = ['views', 'likes', 'comments'];
    if (metricKeys.some((k) => typeof metricFilter[k].value === 'number')) {
      base = base.filter((post: any) => {
        const values: Record<MetricKey, number> = {
          views: post.lastViews || 0,
          likes: post.lastLikes || 0,
          comments: post.commentCount || post.lastComments || 0,
        };
        return metricKeys.every((k) => {
          const { op, value } = metricFilter[k];
          if (typeof value !== 'number') return true;
          const v = values[k];
          return op === 'gt'
            ? v > value
            : op === 'lt'
            ? v < value
            : op === 'lte'
            ? v <= value
            : op === 'eq'
            ? v === value
            : v >= value;
        });
      });
    }

    // Free-text content search (HTML-stripped).
    if (contentSearch.trim()) {
      const q = contentSearch.trim().toLowerCase();
      base = base.filter((post: any) =>
        (post.content || '')
          .replace(/<[^>]*>/g, ' ')
          .toLowerCase()
          .includes(q)
      );
    }

    // Platform / network (provider identifier).
    if (platformFilter.length) {
      const set = new Set(platformFilter);
      base = base.filter((post: any) =>
        set.has(post.integration?.providerIdentifier)
      );
    }

    // Creation method.
    if (creationMethodFilter.length) {
      const set = new Set(creationMethodFilter);
      base = base.filter((post: any) => set.has(post.creationMethod));
    }

    // Draft approval status.
    if (approvalFilter.length) {
      const set = new Set(approvalFilter);
      base = base.filter((post: any) => set.has(post.approvalStatus));
    }

    // Media type.
    if (mediaTypeFilter !== 'all') {
      base = base.filter(
        (post: any) => (post.mediaType || 'none') === mediaTypeFilter
      );
    }

    // Recurring only.
    if (recurringOnly) {
      base = base.filter((post: any) => post.intervalInDays != null);
    }

    // Unread comments only.
    if (unreadOnly) {
      base = base.filter((post: any) => (post.unreadComments || 0) > 0);
    }

    if (engagementFilter === 'all') return base;

    let filtered = base.filter((post: any) => {
      switch (engagementFilter) {
        case 'has_comments':
          return (post.commentCount || post.lastComments || 0) > 0;
        case 'errors':
          return post.state === 'ERROR';
        case 'top_performers':
          return true;
        default:
          return true;
      }
    });

    if (engagementFilter === 'top_performers') {
      filtered = [...filtered].sort((a: any, b: any) => {
        const aEng = (a.lastViews || 0) + (a.lastLikes || 0) + (a.lastComments || 0);
        const bEng = (b.lastViews || 0) + (b.lastLikes || 0) + (b.lastComments || 0);
        return bEng - aEng;
      });
    }

    return filtered;
  }, [
    internalData,
    engagementFilter,
    listState,
    channelFilter,
    campaignFilter,
    tagFilter,
    metricFilter,
    contentSearch,
    platformFilter,
    creationMethodFilter,
    approvalFilter,
    mediaTypeFilter,
    recurringOnly,
    unreadOnly,
  ]);

  const changeDate = useCallback((id: string, date: dayjs.Dayjs) => {
    setDateOverrides((prev) => ({
      ...prev,
      // Store the server shape (zoned ISO with `Z`); a zone-less
      // 'YYYY-MM-DDTHH:mm:ss' is misread as local by `newDayjs()`.
      [id]: date.utc().toISOString(),
    }));
  }, []);


  // Count of non-default filters (date range / window are navigation, not counted;
  // Metrics counts once if any of views/likes/comments has a value).
  const appliedFilterCount = useMemo(() => {
    let n = 0;
    if (listState !== 'all') n++;
    if (engagementFilter !== 'all') n++;
    if (channelFilter.length) n++;
    if (campaignFilter.length) n++;
    if (tagFilter.length) n++;
    if (contentSearch.trim()) n++;
    if (platformFilter.length) n++;
    if (creationMethodFilter.length) n++;
    if (approvalFilter.length) n++;
    if (mediaTypeFilter !== 'all') n++;
    if (recurringOnly) n++;
    if (unreadOnly) n++;
    if (filters.customer) n++;
    if (
      (['views', 'likes', 'comments'] as MetricKey[]).some(
        (k) => typeof metricFilter[k].value === 'number'
      )
    ) {
      n++;
    }
    return n;
  }, [
    listState,
    engagementFilter,
    channelFilter,
    campaignFilter,
    tagFilter,
    contentSearch,
    platformFilter,
    creationMethodFilter,
    approvalFilter,
    mediaTypeFilter,
    recurringOnly,
    unreadOnly,
    filters.customer,
    metricFilter,
  ]);

  const reloadCalendarView = useCallback(() => {
    mutateCalendar();
  }, [mutateCalendar]);

  const loading = calendarIsLoading;

  return (
    <CalendarContext.Provider
      value={{
        trendings,
        reloadCalendarView,
        ...filters,
        posts: calendarIsLoading ? [] : filteredPosts,
        loading,
        error: calendarError,
        integrations,
        setFilters: setFiltersWrapper,
        changeDate,
        comments,
        sets: sets || [],
        signature: sign,
        // List view specific
        listState,
        setListState,
        listRangeMode,
        setListRangeMode,
        engagementFilter,
        setEngagementFilter,
        channelFilter,
        setChannelFilter,
        campaigns,
        campaignFilter,
        setCampaignFilter,
        tags,
        tagFilter,
        setTagFilter,
        metricFilter,
        setMetricFilter,
        contentSearch,
        setContentSearch,
        platformFilter,
        setPlatformFilter,
        creationMethodFilter,
        setCreationMethodFilter,
        approvalFilter,
        setApprovalFilter,
        mediaTypeFilter,
        setMediaTypeFilter,
        recurringOnly,
        setRecurringOnly,
        unreadOnly,
        setUnreadOnly,
        appliedFilterCount,
        customRange,
        applyCustomRange,
      }}
    >
      {children}
    </CalendarContext.Provider>
  );
};

export const useCalendar = () => useContext(CalendarContext);
