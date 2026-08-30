'use client';

import { useCallback } from 'react';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
export const FacebookProvider = () => {
  const fetch = useFetch();
  const t = useT();
  const gotoLogin = useCallback(async () => {
    const link = await (await fetch('/auth/oauth/FACEBOOK')).text();
    window.location.href = link;
  }, [fetch]);
  return (
    <div
      onClick={gotoLogin}
      className={`cursor-pointer flex-1 bg-white h-[52px] rounded-[10px] flex justify-center items-center text-[#0E0E0E] gap-[10px]`}
    >
      <div>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 48 48"
          width="21px"
          height="21px"
        >
          <path
            fill="#1877F2"
            d="M24 4C12.955 4 4 12.955 4 24c0 9.977 7.313 18.247 16.875 19.757V30.844h-5.078V24h5.078v-4.422c0-5.014 2.985-7.781 7.551-7.781 2.188 0 4.476.39 4.476.39v4.922h-2.522c-2.483 0-3.257 1.541-3.257 3.121V24h5.543l-.885 6.844h-4.658v12.913C41.687 42.247 44 33.977 44 24c0-11.045-8.955-20-20-20z"
          />
        </svg>
      </div>
      <div className="block xs:hidden">{t('facebook', 'Facebook')}</div>
    </div>
  );
};
