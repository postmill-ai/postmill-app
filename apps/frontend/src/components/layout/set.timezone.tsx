'use client';
import dayjs, { ConfigType } from 'dayjs';
import { FC, useEffect } from 'react';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import relativeTime from 'dayjs/plugin/relativeTime';
dayjs.extend(timezone);
dayjs.extend(utc);
dayjs.extend(relativeTime);

const { utc: originalUtc } = dayjs;

export const getTimezone = () => {
  if (typeof window === 'undefined') {
    return dayjs.tz.guess();
  }
  return localStorage.getItem('timezone') || dayjs.tz.guess();
};

export const newDayjs = (config?: ConfigType) => {
  // A bare date-only string (YYYY-MM-DD) denotes a calendar date, so parse it as
  // midnight in the user's timezone — not the runtime's local time, which would
  // shift the day (and every hour column) when the two timezones differ.
  const d =
    typeof config === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(config)
      ? dayjs.tz(config, getTimezone())
      : dayjs(config).tz(getTimezone());
  (d as any).local = () => d;
  return d;
};

// Short, common timezone abbreviation (PST/PDT/EST/…) for the active timezone.
// Uses native Intl so it stays DST-aware without the dayjs advancedFormat plugin;
// non-US zones fall back to a short GMT±N form.
export const getTimezoneAbbr = (d?: dayjs.Dayjs) => {
  const tz = getTimezone();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'short',
  }).formatToParts((d ?? newDayjs()).toDate());
  return parts.find((p) => p.type === 'timeZoneName')?.value || tz;
};

const SetTimezone: FC = () => {
  useEffect(() => {
    dayjs.utc = (config?: ConfigType, format?: string, strict?: boolean) => {
      const result = originalUtc(config, format, strict);

      // Attach `.local()` method to the returned Dayjs object
      result.local = function () {
        return result.tz(getTimezone());
      };

      return result;
    };
    if (localStorage.getItem('timezone')) {
      dayjs.tz.setDefault(getTimezone());
    }
  }, []);
  return null;
};

export default SetTimezone;
