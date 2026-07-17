'use client';

import React, { useEffect, useState } from 'react';
import { useCalendar } from './context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

// dayjs locale imports and setup
import 'dayjs/locale/en';
import 'dayjs/locale/ru';
import 'dayjs/locale/zh';
import 'dayjs/locale/fr';
import 'dayjs/locale/es';
import 'dayjs/locale/pt';
import 'dayjs/locale/de';
import 'dayjs/locale/it';
import 'dayjs/locale/ja';
import 'dayjs/locale/ko';
import 'dayjs/locale/ar';
import 'dayjs/locale/tr';
import 'dayjs/locale/vi';
import localizedFormat from 'dayjs/plugin/localizedFormat';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore';
import { extend } from 'dayjs';
import dayjs from 'dayjs';
import i18next from 'i18next';

import { DayView } from './day.view';
import { WeekView } from './week.view';
import { MonthView } from './month.view';
import { ListView } from './list.view';
import { RangeView } from './range.view';
import { MobileView } from './mobile.view';

extend(isSameOrAfter);
extend(isSameOrBefore);
extend(localizedFormat);

const updateDayjsLocale = () => {
  const currentLanguage = i18next.resolvedLanguage || 'en';
  dayjs.locale(currentLanguage);
};

i18next.on('languageChanged', () => {
  updateDayjsLocale();
});

updateDayjsLocale();

// Matches the `mobile:` Tailwind utility (max-width: 1025px). The guard keeps it
// safe under SSR and jsdom (which has no `window.matchMedia`).
const MOBILE_QUERY = '(max-width: 1025px)';
const matchesMobile = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia(MOBILE_QUERY).matches;

export const Calendar = () => {
  const { display, customRange, error, reloadCalendarView } = useCalendar();
  const t = useT();

  // Below the mobile breakpoint there's only room for a single day column, so the
  // calendar reflows to MobileView — the same calendar (same `useCalendar` posts,
  // filters, settings and window), just a single vertical scroll with floating
  // date/time. Kept in the component body (not module scope) so the calendar specs
  // — which mock `useCalendar` but not `matchMedia` — never touch it.
  const [isMobile, setIsMobile] = useState(matchesMobile);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // A failed posts fetch must not render as a silent empty calendar (the user
  // could recreate/reschedule posts during an API blip). Mirror the channels
  // error block with a retry.
  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col gap-[12px] text-center p-[16px]">
          <div className="text-red-500 text-[14px] font-[500]">
            {t('could_not_load_posts', "Couldn't load posts")}
          </div>
          <div className="text-[12px] text-textColor">
            {t('retry_or_check_connection', 'Check your connection and retry')}
          </div>
          <div>
            <button
              onClick={() => reloadCalendarView()}
              className="bg-btnPrimary text-white px-[24px] py-[8px] rounded-[8px] text-[12px] cursor-pointer"
            >
              {t('retry', 'Retry')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // List is honored first on every screen size — mobile must never override the
  // user's list view (it paginates any window itself).
  if (display === 'list') {
    return <ListView />;
  }

  // On mobile the grid displays collapse to the dense, floating-header MobileView.
  if (isMobile) {
    return <MobileView />;
  }

  // Desktop: a custom date range renders as its own range grid (exact selected days).
  if (customRange) {
    return <RangeView />;
  }
  return (
    <>
      {display === 'day' ? (
        <DayView />
      ) : display === 'week' ? (
        <WeekView />
      ) : (
        <MonthView />
      )}
    </>
  );
};

export { CalendarContext, CalendarWeekProvider, useCalendar } from './context';
export type { Integrations, ListStateFilter, EngagementFilter } from './context';

export { DayView } from './day.view';
export { WeekView } from './week.view';
export { MonthView } from './month.view';
export { ListView } from './list.view';
export { CalendarColumn, SetSelectionModal } from './grid';
export { CalendarItem } from './card';
export {
  IconButton,
  EditSettings,
  CopyDebug,
  Duplicate,
  Preview,
  Statistics,
  DeletePost,
} from './helpers';
export { CalendarHeader } from './header';
export { CalendarSidebar } from './sidebar';
