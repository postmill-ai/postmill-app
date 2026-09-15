'use client';

import { useCallback } from 'react';
import { useSsoPopup } from '@postmill-ai/frontend/components/auth/sso-popup';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
export const AppleProvider = () => {
  const { start, waiting } = useSsoPopup();
  const t = useT();
  const gotoLogin = useCallback(() => start('/auth/oauth/APPLE'), [start]);
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
      className={`${waiting ? 'opacity-60 ' : ''}cursor-pointer bg-white h-[44px] rounded-[4px] flex justify-center items-center text-textColor gap-[4px]`}
    >
      <div>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="20"
          viewBox="0 0 384 512"
          fill="none"
        >
          <path
            d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"
            fill="#121A2D"
          />
        </svg>
      </div>
      <div>{t('sign_in_with_apple', 'Sign in with Apple')}</div>
    </div>
  );
};
