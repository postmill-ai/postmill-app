'use client';

import { useCallback } from 'react';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
export const LinkedinProvider = () => {
  const fetch = useFetch();
  const t = useT();
  const gotoLogin = useCallback(async () => {
    const link = await (await fetch('/auth/oauth/LINKEDIN')).text();
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
            fill="#0A66C2"
            d="M42 4H6c-1.105 0-2 .895-2 2v36c0 1.105.895 2 2 2h36c1.105 0 2-.895 2-2V6c0-1.105-.895-2-2-2zM15.731 39h-6V18.936h6V39zM12.731 16.386c-1.933 0-3.5-1.567-3.5-3.5s1.567-3.5 3.5-3.5 3.5 1.567 3.5 3.5-1.567 3.5-3.5 3.5zM39 39h-6v-9.769c0-2.655-.948-4.466-3.321-4.466-1.813 0-2.892 1.22-3.367 2.4-.173.423-.217 1.012-.217 1.603V39h-6s.08-18.083 0-19.964h6v2.829c.798-1.23 2.224-2.983 5.41-2.983 3.95 0 6.495 2.582 6.495 8.133V39z"
          />
        </svg>
      </div>
      <div className="block xs:hidden">{t('linkedin', 'LinkedIn')}</div>
    </div>
  );
};
