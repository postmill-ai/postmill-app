'use client';

import { FC, useCallback } from 'react';
import { useParams } from 'next/navigation';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import dayjs from 'dayjs';

interface MemberProfileData {
  id: string;
  name: string;
  bio: string | null;
  avatarUrl: string | null;
  role: string | null;
  joinedAt: string;
  campaignsCreated: number;
}

const useMemberProfile = (id?: string) => {
  const fetch = useFetch();
  const t = useT();
  const loader = useCallback(async () => {
    const r = await fetch(`/user/profile/${id}`);
    if (!r.ok) throw new Error(t('failed_to_load_profile', 'Failed to load profile'));
    return r.json();
  }, [fetch, id, t]);
  return useSWR<MemberProfileData>(id ? `member-profile-${id}` : null, loader, {
    revalidateOnFocus: false,
  });
};

export const MemberProfile: FC = () => {
  const { id } = useParams<{ id: string }>();
  const t = useT();
  const { data, error, isLoading } = useMemberProfile(id);

  if (error) {
    return (
      <div className="p-[24px] text-center text-newTableText">
        {t('member_not_found', 'This member could not be found.')}
      </div>
    );
  }
  if (isLoading || !data) {
    return <div className="p-[24px] text-center text-newTableText">{t('loading', 'Loading')}</div>;
  }

  const initials = (data.name || '?').charAt(0).toUpperCase();

  return (
    <div className="p-[24px]">
      <div className="max-w-[640px] mx-auto flex flex-col gap-[24px]">
        <div className="flex items-center gap-[16px] p-[24px] border border-newTableBorder rounded-[12px] bg-newBgColor">
          {data.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.avatarUrl}
              alt={data.name}
              className="w-[72px] h-[72px] rounded-full object-cover border border-newTableBorder"
            />
          ) : (
            <div className="w-[72px] h-[72px] rounded-full bg-btnPrimary/15 text-btnPrimaryAccent flex items-center justify-center text-[28px] font-semibold">
              {initials}
            </div>
          )}
          <div className="flex flex-col gap-[4px] min-w-0">
            <h1 className="text-[22px] font-semibold text-textColor truncate">{data.name}</h1>
            <div className="flex flex-wrap items-center gap-[8px] mt-[4px]">
              {data.role && (
                <span className="px-[8px] py-[2px] rounded-full bg-btnPrimary/15 text-btnPrimaryAccent text-[11px] capitalize">
                  {data.role}
                </span>
              )}
              <span className="text-[12px] text-newTableText">
                {t('member_since', 'Member since')} {dayjs(data.joinedAt).format(t('member_since_date_format', 'MMM D, YYYY'))}
              </span>
            </div>
          </div>
        </div>

        {data.bio && (
          <div className="p-[16px] border border-newTableBorder rounded-[12px] bg-newBgColor">
            <h2 className="text-[13px] font-medium text-newTableText mb-[8px]">{t('bio', 'Bio')}</h2>
            <p className="text-[14px] text-textColor whitespace-pre-wrap">{data.bio}</p>
          </div>
        )}

        <div className="p-[16px] border border-newTableBorder rounded-[12px] bg-newBgColor">
          <span className="text-[12px] text-newTableText">{t('activity', 'Activity')}</span>
          <div className="mt-[8px] flex items-baseline gap-[6px]">
            <span className="text-[24px] font-semibold text-textColor">{data.campaignsCreated}</span>
            <span className="text-[13px] text-newTableText">
              {data.campaignsCreated === 1
                ? t('campaign_created', 'campaign created')
                : t('campaigns_created', 'campaigns created')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
