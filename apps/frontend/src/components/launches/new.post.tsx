'use client';
import React, { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import dayjs from 'dayjs';

export const NewPost = () => {
  const fetch = useFetch();
  const router = useRouter();
  const t = useT();

  const createAPost = useCallback(async () => {
    const { date } = await (await fetch('/posts/find-slot')).json();
    const params = new URLSearchParams();
    params.set('date', dayjs.utc(date).local().format('YYYY-MM-DDTHH:mm:ss'));
    router.push(`/posts/post?${params.toString()}`);
  }, [router, fetch]);

  return (
    <button
      onClick={createAPost}
      className="text-white flex-1 pt-[12px] pb-[14px] ps-[16px] pe-[20px] group-[.sidebar]:p-0 min-h-[44px] max-h-[44px] rounded-md bg-btnPrimary flex justify-center items-center gap-[5px] outline-none"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="21"
        height="20"
        viewBox="0 0 21 20"
        fill="none"
        className="min-w-[21px] min-h-[20px]"
      >
        <path
          d="M10.5001 4.16699V15.8337M4.66675 10.0003H16.3334"
          stroke="white"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className="flex-1 text-start text-[14px] group-[.sidebar]:hidden">
        {t('create_new_post', 'Create Post')}
      </div>
    </button>
  );
};
