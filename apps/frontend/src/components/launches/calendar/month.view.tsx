'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useCalendar } from './context';
import { CalendarColumn } from './grid';
import dayjs from 'dayjs';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
import i18next from 'i18next';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export const MonthView = () => {
  const { startDate } = useCalendar();
  const t = useT();

  // Re-render (and recompute localized day names) when the UI language changes —
  // the memo below reads `i18next.resolvedLanguage`, which is otherwise non-reactive.
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

    const days = [];
    for (let i = 1; i <= 7; i++) {
      days.push(newDayjs().day(i).format('dddd'));
    }
    return days;
  }, [resolvedLanguage]);

  const calendarDays = useMemo(() => {
    const monthStart = newDayjs(startDate);
    const currentMonth = monthStart.month();
    const currentYear = monthStart.year();

    const startOfMonth = newDayjs(new Date(currentYear, currentMonth, 1));

    const startDayOfWeek = startOfMonth.isoWeekday();
    const daysBeforeMonth = startDayOfWeek - 1;

    const calendarStartDate = startOfMonth.subtract(daysBeforeMonth, 'day');

    const calendarDays = [];
    let currentDay = calendarStartDate;
    for (let i = 0; i < 42; i++) {
      let label = 'current-month';
      if (currentDay.month() < currentMonth) label = 'previous-month';
      if (currentDay.month() > currentMonth) label = 'next-month';
      calendarDays.push({
        day: currentDay,
        label,
      });

      currentDay = currentDay.add(1, 'day');
    }
    return calendarDays;
  }, [startDate]);

  return (
    <div className="flex flex-col text-textColor flex-1">
      <div className="flex-1 flex relative">
        <div className="grid grid-cols-7 grid-rows-[62px_auto] gap-[4px] rounded-[10px] absolute start-0 top-0 overflow-auto w-full h-full scrollbar scrollbar-thumb-tableBorder scrollbar-track-secondary">
          {localizedDays.map((day) => (
            <div
              key={day}
              className="z-[20] p-2 bg-newTableHeader flex justify-center items-center flex-col h-[62px] rounded-[8px] sticky top-0"
            >
              <div>{day}</div>
            </div>
          ))}
          {calendarDays.map((date, index) => (
            <div
              key={index}
              className="text-center items-center justify-center flex"
            >
              <CalendarColumn
                getDate={newDayjs(date.day).endOf('day')}
                randomHour={true}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
