'use client';

import { FC } from 'react';
import dayjs from 'dayjs';
import { useRouter } from 'next/navigation';
import { useUser } from '@postmill-ai/frontend/components/layout/user.context';
import { getTimezone } from '@postmill-ai/frontend/components/layout/set.timezone';
import { StreakComponent } from '@postmill-ai/frontend/components/layout/streak.component';
import { Button } from '@postmill-ai/react/form/button';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { KebabMenu } from '@postmill-ai/frontend/components/ui/kebab-menu';
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
        {/* Two ways to make a design, so the button is a menu rather than a
            guess at which one you wanted. Same secondary-button look as its
            neighbours — KebabMenu supplies the menu behaviour. */}
        <KebabMenu
          ariaLabel={t('new_design_aria', 'New design')}
          align="left"
          width={200}
          triggerClassName="bg-btnSimple text-btnText border border-newTableBorder hover:bg-boxHover px-[12px] h-[40px] text-[14px] font-[500] !rounded-[8px] gap-[6px] focus-visible:ring-2 ring-btnPrimary/40 outline-none"
          trigger={
            <>
              + {t('new_design', 'New Design')}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </>
          }
          items={[
            {
              label: t('designer', 'Designer'),
              onClick: () => router.push('/media/designer'),
            },
            {
              label: t('ai_designer', 'AI Designer'),
              onClick: () => router.push('/media/ai-designer'),
            },
          ]}
        />
        <CustomizePopover sections={sections} />
      </div>
    </div>
  );
};
