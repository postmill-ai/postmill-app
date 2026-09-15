'use client';

import { useCallback } from 'react';
import SafeImage from '@postmill-ai/react/helpers/safe.image';
import { useSsoPopup } from '@postmill-ai/frontend/components/auth/sso-popup';
import { useVariables } from '@postmill-ai/react/helpers/variable.context';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
export const OauthProvider = () => {
  const { start, waiting } = useSsoPopup();
  const { oauthLogoUrl, oauthDisplayName } = useVariables();
  const t = useT();
  const gotoLogin = useCallback(() => start('/auth/oauth/GENERIC'), [start]);
  return (
    <div
      onClick={gotoLogin}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          gotoLogin();
        }
      }}
      role="button"
      tabIndex={0}
      aria-busy={waiting}
      className={`${waiting ? 'opacity-60 ' : ''}cursor-pointer flex-1 bg-white h-[44px] rounded-[4px] flex justify-center items-center text-textColor gap-[4px]`}
    >
      <div>
        <SafeImage
          src={oauthLogoUrl || '/icons/generic-oauth.svg'}
          alt="genericOauth"
          width={40}
          height={40}
          className="mt-[-7px]"
        />
      </div>
      <div>
        {t('sign_in_with', 'Sign in with')}&nbsp;
        {oauthDisplayName || t('oauth', 'OAuth')}
      </div>
    </div>
  );
};
