'use client';

import React, { FC, useCallback, useEffect, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { TopTitle } from '@gitroom/frontend/components/launches/helpers/top.title.component';
import { IntegrationContext } from '@gitroom/frontend/components/launches/helpers/use.integration';
import dayjs from 'dayjs';
import useSWR, { useSWRConfig } from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { continueProviderList } from '@gitroom/frontend/components/composer/providers/continue-provider/list';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
export const Null: FC<{
  onSave: (data: any) => Promise<void>;
  existingId: string[];
}> = () => null;
export const ContinueProvider: FC = () => {
  const { mutate } = useSWRConfig();
  const fetch = useFetch();
  const searchParams = useSearchParams();
  const added = searchParams.get('added');
  const continueId = searchParams.get('continue');
  const router = useRouter();
  const load = useCallback(
    async (path: string) => {
      const list = (await (await fetch(path)).json()).integrations;
      return list;
    },
    [fetch]
  );
  const { data: integrations } = useSWR('/integrations/list', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    fallbackData: [],
  });
  const refreshList = useCallback(() => {
    mutate('/integrations/list');
    const url = new URL(window.location.href);
    url.searchParams.delete('added');
    url.searchParams.delete('continue');
    router.push(url.toString());
  }, [mutate, router]);
  const Provider = useMemo(() => {
    if (!added) {
      return Null;
    }
    return (
      continueProviderList[added as keyof typeof continueProviderList] || Null
    );
  }, [added]);

  // `integrations` is iterated with `.map` below; a truthy non-array (error/edge
  // response) would throw and crash the tree. Require a real array, not just
  // truthy.
  if (!added || !continueId || !Array.isArray(integrations)) {
    return null;
  }

  return (
    <ContinueModal
      refreshList={refreshList}
      added={added}
      continueId={continueId}
      integrations={integrations.map((p: any) => p.internalId)}
      provider={Provider}
    />
  );
};

const ModalContent: FC<{
  continueId: string;
  added: any;
  provider: any;
  closeModal: () => void;
  integrations: string[];
}> = ({ continueId, added, provider: Provider, closeModal, integrations }) => {
  const fetch = useFetch();

  const onSave = useCallback(
    async (data: any) => {
      await fetch(`/integrations/provider/${continueId}/connect`, {
        method: 'POST',
        body: JSON.stringify(data),
      });
      closeModal();
    },
    [continueId, closeModal, fetch]
  );

  return (
    <IntegrationContext.Provider
      value={{
        date: newDayjs(),
        value: [],
        allIntegrations: [],
        integration: {
          editor: 'normal',
          additionalSettings: '',
          display: '',
          time: [
            {
              time: 0,
            },
          ],
          id: continueId,
          type: '',
          name: '',
          picture: '',
          inBetweenSteps: true,
          changeNickName: false,
          changeProfilePicture: false,
          identifier: added,
        },
      }}
    >
      <Provider onSave={onSave} existingId={integrations} />
    </IntegrationContext.Provider>
  );
};

const ContinueModal: FC<{
  continueId: string;
  added: any;
  provider: any;
  integrations: string[];
  refreshList: () => void;
}> = (props) => {
  const { refreshList, added, continueId, integrations, provider } = props;
  const { openModal } = useModals();
  const t = useT();
  const openedRef = useRef(false);

  useEffect(() => {
    if (openedRef.current) {
      return;
    }
    openedRef.current = true;
    openModal({
      title: t('configure_channel', 'Configure Channel'),
      children: (close) => (
        <ModalContent
          added={added}
          continueId={continueId}
          integrations={integrations}
          provider={provider}
          closeModal={() => {
            refreshList();
            close();
          }}
        />
      ),
    });
  }, [openModal, refreshList, added, continueId, integrations, provider, t]);

  return null;
};
