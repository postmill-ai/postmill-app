'use client';
import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useParams } from 'next/navigation';
import dayjs from 'dayjs';
import { ExistingDataContextProvider } from '@gitroom/frontend/components/launches/helpers/use.existing.data';
import { Integrations } from '@gitroom/frontend/components/launches/calendar.context';
import { Composer } from '@gitroom/frontend/components/composer/composer';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';

export default function EditPostPage() {
  const fetch = useFetch();
  const params = useParams();
  const groupId = params.id as string;

  const loadIntegrations = useCallback(async (path: string) => {
    return (await (await fetch(path)).json()).integrations;
  }, [fetch]);

  const loadPost = useCallback(async (path: string) => {
    return await (await fetch(path)).json();
  }, [fetch]);

  const { data: integrations, isLoading: integrationsLoading } = useSWR<
    Integrations[]
  >('/integrations/list', loadIntegrations,
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

  const { data: postData, isLoading: postLoading } = useSWR(
    groupId ? `/posts/group/${groupId}` : null,
    loadPost,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
      revalidateOnMount: true,
      refreshWhenHidden: false,
      refreshWhenOffline: false,
    }
  );

  if (integrationsLoading || postLoading) {
    return <LoadingComponent />;
  }

  if (!postData || !integrations.length) {
    return null;
  }

  const publishDate = dayjs
    .utc(postData.posts[0].publishDate)
    .local();

  return (
    <ExistingDataContextProvider value={postData}>
      <Composer
        integrations={integrations.filter(
          (f) => f.id === postData.integration
        )}
        allIntegrations={integrations}
        date={publishDate}
      />
    </ExistingDataContextProvider>
  );
}
