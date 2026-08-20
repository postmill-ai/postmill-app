'use client';

import '@neynar/react/dist/style.css';
import React, { FC, useMemo, useState, useCallback, useEffect } from 'react';
import { Web3ProviderInterface } from '@postmill-ai/frontend/components/launches/web3/web3.provider.interface';
import { useVariables } from '@postmill-ai/react/helpers/variable.context';
import { TopTitle } from '@postmill-ai/frontend/components/launches/helpers/top.title.component';
import { useModals } from '@postmill-ai/frontend/components/layout/new-modal';
import { LoadingComponent } from '@postmill-ai/frontend/components/layout/loading';
import {
  NeynarAuthButton,
  NeynarContextProvider,
  Theme,
  useNeynarContext,
} from '@neynar/react';
import { INeynarAuthenticatedUser } from '@neynar/react/dist/types/common';
import { ButtonCaster } from '@postmill-ai/frontend/components/auth/providers/farcaster.provider';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
export const WrapcasterProvider: FC<Web3ProviderInterface> = (props) => {
  const [_, state] = props.nonce.split('||');
  const t = useT();
  const modal = useModals();
  const [hide, setHide] = useState(false);
  const auth = useCallback(
    (code: string) => {
      setHide(true);
      return props.onComplete(code, state);
    },
    [state]
  );
  return (
    <div className="justify-center items-center flex">
      {hide ? (
        <div className="justify-center items-center flex mt-[-90px]">
          <LoadingComponent width={100} height={100} />
        </div>
      ) : (
        <div className="justify-center items-center py-[20px] flex-col w-[500px]">
          <div>
            {t(
              'click_bottom_to_start_process',
              'Click on the bottom below to start the process'
            )}
          </div>
          <ButtonCaster login={auth} />
        </div>
      )}
    </div>
  );
};
