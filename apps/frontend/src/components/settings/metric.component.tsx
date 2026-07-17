'use client';

import { Select } from '@gitroom/react/form/select';
import React, { useState } from 'react';
import { isUSCitizen } from '@gitroom/frontend/components/launches/helpers/isuscitizen.utils';
import rawTimezonesList from 'timezones-list';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const timezonesList =
  (rawTimezonesList as any).default || (rawTimezonesList as any);

const getTimezones = (): { name: string; tzCode: string; label: string }[] => {
  if (Array.isArray(timezonesList)) {
    return timezonesList;
  }
  const tzs = (Intl as any).supportedValuesOf?.('timeZone') || [];
  return tzs.map((tz: string) => ({
    name: tz,
    tzCode: tz,
    label: tz.replace(/_/g, ' '),
  }));
};
const dateMetrics = [
  { label: 'AM:PM', value: 'US' },
  { label: '24 hours', value: 'GLOBAL' },
];

import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
dayjs.extend(timezone);

const MetricComponent = () => {
  const t = useT();
  const [currentMetric, setCurrentMetric] = useState(isUSCitizen());
  const [timezone, setTimezone] = useState(
    localStorage.getItem('timezone') || dayjs.tz.guess()
  );
  const changeMetric = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    setCurrentMetric(value === 'US');
    localStorage.setItem('isUS', value);
  };

  const changeTimezone = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    setTimezone(value);
    localStorage.setItem('timezone', value);
    dayjs.tz.setDefault(value);
  };
  return (
    <div className="my-[16px] mt-[16px] bg-newBgColorInner border-newTableBorder border rounded-[12px] p-[24px] flex flex-col gap-[24px]">
      <div className="mt-[4px]">{t('date_metrics', 'Date Metrics')}</div>
      <Select name="metric" aria-label={t('date_metrics_aria', 'Date metrics')} disableForm={true} label="" onChange={changeMetric} value={currentMetric ? 'US' : 'GLOBAL'}>
        {dateMetrics.map((metric) => (
          <option
            key={metric.value}
            value={metric.value}
          >
            {t('date_metric_' + metric.value, metric.label)}
          </option>
        ))}
      </Select>

      <div className="mt-[4px]">{t('current_timezone', 'Current Timezone')}</div>
      <Select
        name="timezone"
        aria-label={t('current_timezone_aria', 'Current timezone')}
        disableForm={true}
        label=""
        onChange={changeTimezone}
        value={timezone}
      >
        {getTimezones().map((metric) => (
          <option
            key={metric.name}
            value={metric.tzCode}
          >
            {metric.label}
          </option>
        ))}
      </Select>
    </div>
  );
};

export default MetricComponent;
