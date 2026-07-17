'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import useCookie from 'react-use-cookie';
import useSWR from 'swr';

export const AfterActivate = () => {
  const fetch = useFetch();
  const params = useParams();
  const t = useT();
  const [datafast_visitor_id] = useCookie('datafast_visitor_id');

  const { data, isLoading } = useSWR(
    params.code ? ['activate', params.code, datafast_visitor_id] : null,
    async (key: [string, string, string]) => {
      const [, code, visitor] = key;
      const { can } = await (
        await fetch(`/auth/activate`, {
          method: 'POST',
          body: JSON.stringify({
            code,
            datafast_visitor_id: visitor,
          }),
          headers: {
            'Content-Type': 'application/json',
          },
        })
      ).json();
      return { can };
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );

  if (isLoading || !data || data.can !== false) {
    return <LoadingComponent />;
  }

  return (
    <>
      {t('user_already_activated', 'This user is already activated,')}
      <br />
      <Link href="/auth/login" className="underline">
        {t(
          'click_here_to_go_back_to_login',
          'Click here to go back to login'
        )}
      </Link>
    </>
  );
};
