'use client';

import { FC } from 'react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
dayjs.extend(utc);

export const RenderPreviewDate: FC<{ date: string }> = ({ date }) => {
  const t = useT();
  return <>{dayjs.utc(date).local().format(t('preview_date_format', 'MMMM D, YYYY h:mm A'))}</>;
};
