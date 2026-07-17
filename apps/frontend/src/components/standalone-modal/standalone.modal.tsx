'use client';

import 'reflect-metadata';
import { FC, useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import dayjs from 'dayjs';
import { useParams } from 'next/navigation';
import { Composer } from '@gitroom/frontend/components/composer/composer';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
export const StandaloneModal: FC = () => {
  const fetch = useFetch();
  const params = useParams<{ platform: string }>();

  const load = useCallback(async (path: string) => {
    return (await (await fetch(path)).json()).integrations;
  }, [fetch]);

  const loadDate = useCallback(async () => {
    if (params.platform === 'all') {
      return newDayjs().utc().format('YYYY-MM-DDTHH:mm:ss');
    }
    return (await (await fetch('/posts/find-slot')).json()).date;
  }, [fetch, params.platform]);

  const {
    isLoading,
    data: integrations,
    mutate,
  } = useSWR('/integrations/list', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    fallbackData: [],
  });
  const { isLoading: isLoading2, data } = useSWR('/posts/find-slot', loadDate, {
    fallbackData: [],
  });
  if (isLoading || isLoading2) {
    return null;
  }
  return (
    <Composer
      dummy={params.platform === 'all'}
      customClose={() => {
        window.parent.postMessage(
          {
            action: 'closeIframe',
          },
          window.location.origin
        );
      }}
      mutate={() => {}}
      integrations={integrations}
      reopenModal={() => {}}
      allIntegrations={integrations}
      date={dayjs.utc(data).local()}
    />
  );
};
