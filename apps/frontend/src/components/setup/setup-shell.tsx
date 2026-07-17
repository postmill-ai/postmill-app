'use client';

import React, { ReactNode, useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Logo } from '@gitroom/frontend/components/new-layout/logo';
import { Wordmark } from '@gitroom/frontend/components/new-layout/wordmark';
import { UserAvatarMenu } from '@gitroom/frontend/components/new-layout/user-avatar-menu';
import { ContextWrapper } from '@gitroom/frontend/components/layout/user.context';
import { ToolTip } from '@gitroom/frontend/components/layout/top.tip';
import { Toaster } from '@gitroom/react/toaster/toaster';
import { MantineWrapper } from '@gitroom/react/helpers/mantine.wrapper';
import dynamic from 'next/dynamic';

const ModeComponent = dynamic(
  () => import('@gitroom/frontend/components/layout/mode.component'),
  { ssr: false }
);

export function SetupShell({ children }: { children: ReactNode }) {
  const fetch = useFetch();

  const load = useCallback(
    async (path: string) => {
      const res = await fetch(path);
      return res.json();
    },
    [fetch]
  );

  const { data: user } = useSWR('/user/self', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    refreshWhenOffline: false,
    refreshWhenHidden: false,
  });

  // Render nothing until /user/self resolves. An unauthenticated visitor will
  // be bounced to /auth/login by the fetch interceptor in LayoutContext.
  if (!user) return null;

  return (
    <ContextWrapper user={user}>
      <MantineWrapper>
        <ToolTip />
        <Toaster />
        <div className="flex flex-col h-screen min-w-full text-newTextColor bg-primary overflow-hidden">
          <header className="flex items-center justify-between h-[60px] px-[20px] border-b border-newBorder shrink-0">
            <div className="flex items-center gap-[10px]">
              <Logo size={28} className="" />
              <Wordmark height={26} className="text-newTextColor" />
            </div>
            <div className="flex items-center gap-[16px]">
              <ModeComponent />
              <UserAvatarMenu />
            </div>
          </header>
          <main className="flex-1 min-h-0 overflow-hidden">{children}</main>
        </div>
      </MantineWrapper>
    </ContextWrapper>
  );
}
