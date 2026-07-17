'use client';
import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useSearchParams, useRouter } from 'next/navigation';
import { Composer } from '@gitroom/frontend/components/composer/composer';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';

export default function CreatePostPage() {
  const fetch = useFetch();
  const router = useRouter();
  const searchParams = useSearchParams();

  const loadIntegrations = useCallback(async (path: string) => {
    return (await (await fetch(path)).json()).integrations;
  }, [fetch]);

  const { data: integrations, isLoading } = useSWR(
    '/integrations/list',
    loadIntegrations,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
      revalidateOnMount: true,
      refreshWhenHidden: false,
      refreshWhenOffline: false,
      fallbackData: [],
    }
  );

  const dateParam = searchParams.get('date');
  const channelParam = searchParams.get('channel');
  const contentParam = searchParams.get('content');

  const date = dateParam ? newDayjs(dateParam) : newDayjs();
  const selectedChannels = channelParam ? [channelParam] : undefined;
  const onlyValues = contentParam
    ? [{ content: decodeURIComponent(contentParam), id: 'new' }]
    : undefined;

  const handleLoadDraft = useCallback(
    (group: string) => {
      router.push(`/posts/post/${group}`);
    },
    [router]
  );

  if (isLoading) {
    return <LoadingComponent />;
  }

  if (!integrations.length) {
    return null;
  }

  return (
    <Composer
      integrations={integrations}
      allIntegrations={integrations}
      date={date}
      selectedChannels={selectedChannels}
      onlyValues={onlyValues}
      onLoadDraft={handleLoadDraft}
    />
  );
}
