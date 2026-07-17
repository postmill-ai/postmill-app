'use client';

import React, { Fragment, useEffect, useMemo, useState } from 'react';
import { useCalendar } from './context';
import { CalendarColumn } from './grid';
import dayjs from 'dayjs';
import clsx from 'clsx';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
import { convertTimeFormatBasedOnLocality, hours } from './helpers';
import i18next from 'i18next';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export const WeekView = () => {
  const { startDate, endDate } = useCalendar();
  const t = useT();

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

    const days = [];
    const weekStart = newDayjs(startDate);
    for (let i = 0; i < 7; i++) {
      const day = weekStart.add(i, 'day');
      days.push({
        name: day.format('dddd'),
        day: day.format('L'),
        date: day,
      });
    }
    return days;
  }, [resolvedLanguage, startDate]);

  return (
    <div className="flex flex-col text-textColor flex-1">
      <div className="flex-1 relative">
        <div className="grid [grid-template-columns:136px_repeat(7,_minmax(0,_1fr))] gap-[4px] rounded-[10px] absolute h-full start-0 top-0 w-full overflow-auto scrollbar scrollbar-thumb-fifth scrollbar-track-newBgColor">
          <div className="z-10 bg-newTableHeader flex justify-center items-center flex-col h-[62px] rounded-[8px] sticky top-0"></div>
          {localizedDays.map((day, index) => (
            <div
              key={day.name}
              className="p-2 text-center bg-newTableHeader flex justify-center items-center flex-col h-[62px] rounded-[8px] sticky top-0 z-[20]"
            >
              <div className="text-[14px] font-[500] text-newTableText">
                {day.name}
              </div>
              <div
                className={clsx(
                  'text-[14px] font-[600] flex items-center justify-center gap-[6px]',
                  day.day === newDayjs().format('L') &&
                    'text-newTableTextFocused'
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
              {localizedDays.map((day, indexDay) => (
                <Fragment
                  key={`${startDate}-${day.date.format('YYYY-MM-DD')}-${hour}`}
                >
                  <div className="relative">
                    <CalendarColumn
                      getDate={day.date.startOf('day').add(hour, 'hour')}
                    />
                  </div>
                </Fragment>
              ))}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
};
