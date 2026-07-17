'use client';

import { FC, Fragment, useCallback } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { Button } from '@gitroom/react/form/button';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import dayjs from 'dayjs';

const useApprovedApps = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await fetch('/user/approved-apps')).json();
  }, [fetch]);
  return useSWR('approved-apps', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
  });
};

export const ApprovedAppsComponent: FC = () => {
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();
  const { data: apps, mutate } = useApprovedApps();

  const revokeApp = useCallback(
    (app: any) => async () => {
      if (
        await deleteDialog(
          t(
            'are_you_sure_revoke_access',
            'Are you sure you want to revoke access for {{name}}?',
            { name: app.oauthApp?.name }
          )
        )
      ) {
        try {
          await fetch(`/user/approved-apps/${app.id}`, {
            method: 'DELETE',
          });
          toaster.show(
            t('access_revoked', 'Access revoked successfully'),
            'success'
          );
          mutate();
        } catch {
          toaster.show(t('failed_to_revoke', 'Failed to revoke access'), 'warning');
        }
      }
    },
    [fetch, mutate, t, toaster]
  );

  if (apps === undefined) {
    return null;
  }

  return (
    <div className="flex flex-col gap-[20px]">
      <div className="bg-newBgColorInner border-newTableBorder border rounded-[12px] p-[24px]">
        {!apps?.length ? (
          <div className="text-newTableText">
            {t('no_approved_apps', 'No approved apps yet.')}
          </div>
        ) : (
          <div className="flex flex-col gap-[16px]">
            {apps.map((app: any) => (
              <div
                key={app.id}
                className="flex items-center justify-between p-[12px] border border-newTableBorder rounded-[4px]"
              >
                <div className="flex items-center gap-[12px]">
                  {app.oauthApp?.picture?.path ? (
                    // eslint-disable-next-line @next/next/no-img-element -- external OAuth app logo
                    <img
                      src={app.oauthApp.picture.path}
                      alt={app.oauthApp.name}
                      className="w-[40px] h-[40px] rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-[40px] h-[40px] rounded-full bg-newTableHeader flex items-center justify-center text-newTableText">
                      {app.oauthApp?.name?.[0]?.toUpperCase() || '?'}
                    </div>
                  )}
                  <div>
                    <div className="text-[14px] font-bold">
                      {app.oauthApp?.name}
                    </div>
                    {app.oauthApp?.description && (
                      <div className="text-newTableText text-[12px]">
                        {app.oauthApp.description}
                      </div>
                    )}
                    <div className="text-newTableText text-[12px]">
                      {t('authorized_on', 'Authorized on')}{' '}
                      {dayjs(app.createdAt).format(t('approved_app_date_format', 'MMM D, YYYY'))}
                    </div>
                  </div>
                </div>
                <Button onClick={revokeApp(app)}>
                  {t('revoke', 'Revoke')}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
