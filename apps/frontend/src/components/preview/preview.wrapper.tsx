'use client';

import useSWR from 'swr';
import { ContextWrapper } from '@postmill-ai/frontend/components/layout/user.context';
import { ReactNode, useCallback } from 'react';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { Toaster } from '@postmill-ai/react/toaster/toaster';
import { MantineWrapper } from '@postmill-ai/react/helpers/mantine.wrapper';
import { ToolTip } from '@postmill-ai/frontend/components/layout/top.tip';
import { CopilotProvider } from '@postmill-ai/frontend/components/layout/copilot.provider';
export const PreviewWrapper = ({ children }: { children: ReactNode }) => {
  const fetch = useFetch();
  const load = useCallback(async (path: string) => {
    return await (await fetch(path)).json();
  }, []);
  const { data: user } = useSWR('/user/self', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    refreshWhenOffline: false,
    refreshWhenHidden: false,
  });
  return (
    <ContextWrapper user={user}>
      <CopilotProvider>
        <MantineWrapper>
          <Toaster />
          <ToolTip />
          {children}
        </MantineWrapper>
      </CopilotProvider>
    </ContextWrapper>
  );
};
