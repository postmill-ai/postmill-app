'use client';
import { FC, useCallback, useState } from 'react';
import dayjs from 'dayjs';
import { DatePicker as MantineDatePicker, TimeInput } from '@mantine/dates';
import { useClickOutside } from '@mantine/hooks';
import { Button } from '@postmill-ai/react/form/button';
import { isUSCitizen } from './isuscitizen.utils';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import {
  newDayjs,
  getTimezoneAbbr,
} from '@postmill-ai/frontend/components/layout/set.timezone';
import { CalendarIcon } from '@postmill-ai/frontend/components/ui/icons';
export const DatePicker: FC<{
  date: dayjs.Dayjs;
  onChange: (day: dayjs.Dayjs) => void;
}> = (props) => {
  const { date, onChange } = props;
  const [open, setOpen] = useState(false);
  const t = useT();

  const changeShow = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);
  const ref = useClickOutside<HTMLDivElement>(() => {
    setOpen(false);
  });
  // Mantine 8+ date components work in 'YYYY-MM-DD' strings; TimeInput is a
  // native input[type=time] and hands back an 'HH:mm' string.
  const changeDate = useCallback(
    (type: 'date' | 'time') => (value: string) => {
      onChange(
        newDayjs(
          type === 'time'
            ? date.format('YYYY-MM-DD') + ' ' + value
            : value + ' ' + date.format('HH:mm:ss')
        )
      );
    },
    [date, onChange]
  );
  return (
    <div
      className="px-[12px] lg:px-[16px] border border-newTextColor/10 rounded-[8px] justify-center flex gap-[8px] items-center relative h-[36px] lg:h-[44px] text-[13px] lg:text-[15px] font-[600] ml-[7px] select-none flex-1"
      onClick={changeShow}
      ref={ref}
    >
      <div className="cursor-pointer">
        <CalendarIcon />
      </div>
      <div className="cursor-pointer flex items-center gap-[4px]">
        {date.format(isUSCitizen() ? 'MM/DD/YYYY hh:mm A' : 'DD/MM/YYYY HH:mm')}
        <span className="text-[11px] text-textColor/50 font-[400]">
          {getTimezoneAbbr(date)}
        </span>
      </div>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="animate-fadeIn absolute bottom-full mb-[16px] inset-s-[50%] translate-x-[-50%] bg-newBgColorInner border border-newTableBorder text-textColor rounded-[16px] z-300 p-[16px] flex flex-col"
        >
          <MantineDatePicker
            onChange={(day) => day && changeDate('date')(day)}
            value={date.format('YYYY-MM-DD')}
            minDate={newDayjs().startOf('day').format('YYYY-MM-DD')}
            classNames={{
              day: 'hover:bg-seventh text-text!Color data-[weekend]:text-text!Color data-[outside]:text-gray! data-[selected]:text-text!Color data-[selected]:bg-seventh! data-selected:outline-hidden!',
              calendarHeaderControl: 'text-textColor hover:bg-third',
              calendarHeaderLevel: 'text-textColor hover:bg-third',
            }}
          />
          <TimeInput
            onChange={(event) => changeDate('time')(event.currentTarget.value)}
            label={t('label_pick_time', 'Pick time')}
            classNames={{
              label: 'text-textColor py-[12px]',
              input:
                'bg-newBgColorInner h-[40px] border border-newTableBorder text-textColor rounded-[4px] outline-hidden',
            }}
            defaultValue={date.format('HH:mm')}
          />
          <Button className="mt-[12px]" onClick={changeShow}>
            {t('close', 'Close')}
          </Button>
        </div>
      )}
    </div>
  );
};
