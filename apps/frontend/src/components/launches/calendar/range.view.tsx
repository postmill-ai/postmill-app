'use client';

import React, { Fragment, useEffect, useMemo, useState } from 'react';
import { useCalendar } from './context';
import { CalendarColumn } from './grid';
import dayjs from 'dayjs';
import clsx from 'clsx';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
import { convertTimeFormatBasedOnLocality, hours } from './helpers';
import i18next from 'i18next';

// Renders an arbitrary custom date range (start..end inclusive) as a week-style
// hourly grid — one column per day in the range. Unlike WeekView (fixed 7 days),
// the number of day columns follows the selected range exactly.
export const RangeView = () => {
  const { startDate, endDate } = useCalendar();

  // Recompute day names when the UI language changes (i18next is non-reactive).
  const [resolvedLanguage, setResolvedLanguage] = useState(
    i18next.resolvedLanguage
  );
  useEffect(() => {
    const handler = (lng: string) => setResolvedLanguage(lng);
    i18next.on('languageChanged', handler);
    return () => i18next.off('languageChanged', handler);
  }, []);

  const localizedDays = useMemo(() => {
    const currentLanguage = resolvedLanguage || 'en';
    dayjs.locale(currentLanguage);

    const start = newDayjs(startDate).startOf('day');
    const end = newDayjs(endDate).startOf('day');
    const count = Math.max(1, Math.min(92, end.diff(start, 'day') + 1));

    const days = [];
    for (let i = 0; i < count; i++) {
      const day = start.add(i, 'day');
      days.push({
        name: day.format('dddd'),
        day: day.format('L'),
        date: day,
      });
    }
    return days;
  }, [resolvedLanguage, startDate, endDate]);

  return (
    <div className="flex flex-col text-textColor flex-1">
      <div className="flex-1 relative">
        <div
          className="grid gap-[4px] rounded-[10px] absolute h-full start-0 top-0 w-full overflow-auto scrollbar scrollbar-thumb-fifth scrollbar-track-newBgColor"
          style={{
            gridTemplateColumns: `136px repeat(${localizedDays.length}, minmax(120px, 1fr))`,
          }}
        >
          <div className="z-10 bg-newTableHeader flex justify-center items-center flex-col h-[62px] rounded-[8px] sticky top-0"></div>
          {localizedDays.map((day) => (
            <div
              key={day.day}
              className="p-2 text-center bg-newTableHeader flex justify-center items-center flex-col h-[62px] rounded-[8px] sticky top-0 z-[20]"
            >
              <div className="text-[14px] font-[500] text-newTableText">
                {day.name}
              </div>
              <div
                className={clsx(
                  'text-[14px] font-[600] flex items-center justify-center gap-[6px]',
                  day.day === newDayjs().format('L') && 'text-newTableTextFocused'
                )}
              >
                {day.day === newDayjs().format('L') && (
                  <div className="w-[6px] h-[6px] bg-newTableTextFocused rounded-full" />
                )}
                {day.day}
              </div>
            </div>
          ))}
          {hours.map((hour) => (
            <Fragment key={hour}>
              <div className="p-2 pe-4 text-center items-center justify-center flex text-[14px] text-newTableText">
                {convertTimeFormatBasedOnLocality(hour)}
              </div>
              {localizedDays.map((day) => (
                <div
                  key={`${day.date.format('YYYY-MM-DD')}-${hour}`}
                  className="relative"
                >
                  <CalendarColumn getDate={day.date.startOf('day').add(hour, 'hour')} />
                </div>
              ))}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
};
