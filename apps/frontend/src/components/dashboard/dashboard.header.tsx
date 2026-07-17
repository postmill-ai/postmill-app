'use client';

import { FC } from 'react';
import dayjs from 'dayjs';
import { useRouter } from 'next/navigation';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { getTimezone } from '@gitroom/frontend/components/layout/set.timezone';
import { StreakComponent } from '@gitroom/frontend/components/layout/streak.component';
import { Button } from '@gitroom/react/form/button';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { CustomizePopover, DashboardSectionMeta } from './customize.popover';
import { greetingForUser } from './dashboard.utils';

interface DashboardHeaderProps {
  sections: DashboardSectionMeta[];
  showBriefButton?: boolean;
  onBriefClick?: () => void;
}

export const DashboardHeader: FC<DashboardHeaderProps> = ({
  sections,
  showBriefButton,
  onBriefClick,
}) => {
  const router = useRouter();
  const user = useUser();
  const t = useT();

  const firstName =
    user?.profile?.name?.trim().split(/\s+/)[0] ||
    t('greeting_fallback_name', 'there');
  const hour = dayjs().tz(getTimezone()).hour();
  const greeting = greetingForUser(firstName, hour, t);

  const dateLabel = dayjs().tz(getTimezone()).format(t('dashboard_date_format', 'dddd, MMMM D'));

  return (
    <div className="flex flex-col gap-[8px] mb-[20px]">
      <div className="flex flex-col mobile:flex-row mobile:items-center mobile:justify-between gap-[8px]">
        <div>
          <h1 className="text-[20px] mobile:text-[24px] font-[600] text-textColor">
            {greeting}
          </h1>
          <p className="text-[13px] text-newTableText mt-[2px]">{dateLabel}</p>
        </div>
        <div className="flex items-center gap-[8px]">
          <StreakComponent />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-[8px]">
        {showBriefButton && (
          <Button
            secondary
            onClick={onBriefClick}
            className="px-[12px]"
            aria-label={t('daily_brief_section_label', 'Daily brief')}
          >
            <span className="mr-[6px]">✨</span>
            {t('daily_brief', 'Daily Brief')}
          </Button>
        )}
        <Button
          onClick={() => router.push('/posts/post')}
          className="px-[12px]"
          aria-label={t('new_post_aria', 'New post')}
        >
          + {t('new_post', 'New Post')}
        </Button>
        <Button
          secondary
          onClick={() => router.push('/campaigns?new=1')}
          className="px-[12px]"
          aria-label={t('new_campaign_aria', 'New campaign')}
        >
          + {t('new_campaign', 'New Campaign')}
        </Button>
        <CustomizePopover sections={sections} />
      </div>
    </div>
  );
};
