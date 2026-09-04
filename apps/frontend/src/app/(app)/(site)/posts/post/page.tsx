'use client';
import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useSearchParams, useRouter } from 'next/navigation';
import { Composer } from '@postmill-ai/frontend/components/composer/composer';
import { LoadingComponent } from '@postmill-ai/frontend/components/layout/loading';
import { newDayjs } from '@postmill-ai/frontend/components/layout/set.timezone';
import { EmptyState } from '@postmill-ai/frontend/components/ui/empty-state';
import { Button } from '@postmill-ai/react/form/button';
import { useAddProvider } from '@postmill-ai/frontend/components/launches/add.provider.component';
import { usePermissions } from '@postmill-ai/frontend/components/layout/use-permissions';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

export default function CreatePostPage() {
  const fetch = useFetch();
  const router = useRouter();
  const searchParams = useSearchParams();

  const loadIntegrations = useCallback(async (path: string) => {
    return (await (await fetch(path)).json()).integrations;
  }, [fetch]);

  const { data: integrations, isLoading, mutate } = useSWR(
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

  const t = useT();
  const permissions = usePermissions();
  const addChannel = useAddProvider(() => mutate());

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
    // Zero-channel accounts used to render a blank page here. Offer the
    // add-channel flow instead; members without channels:create just get
    // the explanation (optimistic-render: hide the action only once resolved).
    const canCreateChannels =
      !permissions.isResolved || permissions.hasPermission('channels', 'create');
    return (
      <div className="flex justify-center p-[40px]">
        <EmptyState
          className="w-full max-w-[480px]"
          title={t('composer_no_channels_title', 'No channels connected')}
          description={
            canCreateChannels
              ? t(
                  'composer_no_channels_desc',
                  'Connect a channel to start composing and scheduling posts.'
                )
              : t(
                  'composer_no_channels_desc_no_permission',
                  'Ask an admin to connect a channel before composing posts.'
                )
          }
          action={
            canCreateChannels ? (
              <Button onClick={addChannel}>{t('add_channel', 'Add Channel')}</Button>
            ) : undefined
          }
        />
      </div>
    );
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
