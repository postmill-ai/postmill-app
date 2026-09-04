'use client';
import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useParams, useRouter } from 'next/navigation';
import dayjs from 'dayjs';
import { ExistingDataContextProvider } from '@postmill-ai/frontend/components/launches/helpers/use.existing.data';
import { Integrations } from '@postmill-ai/frontend/components/launches/calendar.context';
import { Composer } from '@postmill-ai/frontend/components/composer/composer';
import { LoadingComponent } from '@postmill-ai/frontend/components/layout/loading';
import { EmptyState } from '@postmill-ai/frontend/components/ui/empty-state';
import { Button } from '@postmill-ai/react/form/button';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

export default function EditPostPage() {
  const fetch = useFetch();
  const params = useParams();
  const router = useRouter();
  const t = useT();
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

  // Never blank-page: a deleted post or a since-disconnected channel both
  // used to render `null` with no way out.
  if (!postData) {
    return (
      <div className="flex justify-center p-[40px]">
        <EmptyState
          className="w-full max-w-[480px]"
          title={t('post_not_found_title', 'Post not found')}
          description={t(
            'post_not_found_desc',
            'This post may have been deleted or you may not have access to it.'
          )}
          action={
            <Button onClick={() => router.push('/posts')}>
              {t('back_to_posts', 'Back to posts')}
            </Button>
          }
        />
      </div>
    );
  }

  if (!integrations.length) {
    return (
      <div className="flex justify-center p-[40px]">
        <EmptyState
          className="w-full max-w-[480px]"
          title={t('composer_no_channels_title', 'No channels connected')}
          description={t(
            'composer_no_channels_desc',
            'Connect a channel to start composing and scheduling posts.'
          )}
          action={
            <Button onClick={() => router.push('/settings/channels')}>
              {t('manage_channels', 'Manage channels')}
            </Button>
          }
        />
      </div>
    );
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
