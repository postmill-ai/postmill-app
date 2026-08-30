'use client';

import { useCallback } from 'react';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
export const XProvider = () => {
  const fetch = useFetch();
  const t = useT();
  const gotoLogin = useCallback(async () => {
    const link = await (await fetch('/auth/oauth/X')).text();
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
          viewBox="0 0 24 24"
          width="21px"
          height="21px"
        >
          <path
            fill="#000000"
            d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
          />
        </svg>
      </div>
      <div className="block xs:hidden">{t('x', 'X')}</div>
    </div>
  );
};
