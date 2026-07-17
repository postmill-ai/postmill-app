'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useCallback, useMemo, useState } from 'react';
import {
  pricing,
  PlanInterface,
} from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { Input } from '@gitroom/react/form/input';
import { Button } from '@gitroom/react/form/button';
import { useSWRConfig } from 'swr';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useRouter } from 'next/navigation';
import { useFireEvents } from '@gitroom/helpers/utils/use.fire.events';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const LIFETIME_PLAN: PlanInterface['current'] = 'AGENCY';

export const LifetimeDeal = () => {
  const t = useT();
  const fetch = useFetch();
  const user = useUser();
  const [code, setCode] = useState('');
  const toast = useToaster();
  const { mutate } = useSWRConfig();
  const router = useRouter();
  const fireEvents = useFireEvents();

  const claim = useCallback(async () => {
    const { success } = await (
      await fetch('/billing/lifetime', {
        body: JSON.stringify({
          code,
        }),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      })
    ).json();
    if (success) {
      mutate('/user/self');
      toast.show(
        t('billing_successfully_claimed_the_code', 'Successfully claimed the code')
      );
      fireEvents('lifetime_claimed');
    } else {
      toast.show(
        t(
          'billing_code_already_claimed_or_invalid',
          'Code already claimed or invalid code'
        ),
        'warning'
      );
    }
    setCode('');
  }, [code, fetch, fireEvents, mutate, toast, t]);

  const agencyPricing = pricing[LIFETIME_PLAN];

  const currentFeatures = useMemo(() => {
    if (!user?.tier) {
      return [];
    }
    const currentPricing = user.tier;
    const list: string[] = [];

    list.push(
      t('billing_unlimited_ai_creation', 'Unlimited AI creation')
    );

    list.push(
      t('billing_n_channels', '{{count}} channel', {
        count: user.totalChannels || currentPricing.channel,
      })
    );

    list.push(
      currentPricing.posts_per_month >= 10000
        ? t('billing_unlimited_feature', 'Unlimited {{feature}}', {
            feature: t('billing_posts_per_month', 'posts per month'),
          })
        : t('billing_n_posts_per_month', '{{count}} posts per month', {
            count: currentPricing.posts_per_month,
          })
    );

    list.push(
      t('billing_n_team_members', '{{count}} team members', {
        count: currentPricing.team_members,
      })
    );

    list.push(
      t('billing_n_brand_kits', '{{count}} brand kits', {
        count: currentPricing.brand_kits,
      })
    );

    list.push(
      `${t('billing_campaigns', 'Campaigns')}: ${
        currentPricing.campaigns
          ? t('billing_yes_badge', 'Yes')
          : t('billing_no_badge', 'No')
      }`
    );

    list.push(
      `${t('billing_api_and_mcp', 'API & MCP')}: ${
        currentPricing.api && currentPricing.mcp
          ? t('billing_yes_badge', 'Yes')
          : t('billing_no_badge', 'No')
      }`
    );

    list.push(
      t('billing_n_webhooks', '{{count}} webhooks', {
        count: currentPricing.webhooks,
      })
    );

    list.push(
      t('billing_n_competitors', '{{count}} competitors', {
        count: currentPricing.competitors,
      })
    );

    list.push(
      t(
        'billing_n_days_analytics_retention',
        '{{count}} days analytics retention',
        { count: currentPricing.analytics_retention_days }
      )
    );

    list.push(
      t('billing_n_video_exports_per_month', '{{count}} video exports/mo', {
        count: currentPricing.video_exports,
      })
    );

    list.push(
      t('billing_n_gb_hosted_storage', '{{count}} GB hosted storage', {
        count: currentPricing.storage_gb,
      })
    );

    list.push(
      `${t('billing_byo_storage', 'BYO storage')}: ${
        currentPricing.byo_storage
          ? t('billing_yes_badge', 'Yes')
          : t('billing_no_badge', 'No')
      }`
    );

    list.push(
      `${t('billing_priority_support', 'Priority support')}: ${
        currentPricing.priority
          ? t('billing_yes_badge', 'Yes')
          : t('billing_no_badge', 'No')
      }`
    );

    return list;
  }, [user, t]);

  const agencyFeatures = useMemo(() => {
    const currentPricing = agencyPricing;
    const list: string[] = [];

    list.push(
      t('billing_unlimited_ai_creation', 'Unlimited AI creation')
    );

    list.push(
      t('billing_n_channels', '{{count}} channel', {
        count: currentPricing.channel,
      })
    );

    list.push(
      currentPricing.posts_per_month >= 10000
        ? t('billing_unlimited_feature', 'Unlimited {{feature}}', {
            feature: t('billing_posts_per_month', 'posts per month'),
          })
        : t('billing_n_posts_per_month', '{{count}} posts per month', {
            count: currentPricing.posts_per_month,
          })
    );

    list.push(
      t('billing_n_team_members', '{{count}} team members', {
        count: currentPricing.team_members,
      })
    );

    list.push(
      t('billing_n_brand_kits', '{{count}} brand kits', {
        count: currentPricing.brand_kits,
      })
    );

    list.push(
      `${t('billing_campaigns', 'Campaigns')}: ${
        currentPricing.campaigns
          ? t('billing_yes_badge', 'Yes')
          : t('billing_no_badge', 'No')
      }`
    );

    list.push(
      `${t('billing_api_and_mcp', 'API & MCP')}: ${
        currentPricing.api && currentPricing.mcp
          ? t('billing_yes_badge', 'Yes')
          : t('billing_no_badge', 'No')
      }`
    );

    list.push(
      t('billing_n_webhooks', '{{count}} webhooks', {
        count: currentPricing.webhooks,
      })
    );

    list.push(
      t('billing_n_competitors', '{{count}} competitors', {
        count: currentPricing.competitors,
      })
    );

    list.push(
      t(
        'billing_n_days_analytics_retention',
        '{{count}} days analytics retention',
        { count: currentPricing.analytics_retention_days }
      )
    );

    list.push(
      t('billing_n_video_exports_per_month', '{{count}} video exports/mo', {
        count: currentPricing.video_exports,
      })
    );

    list.push(
      t('billing_n_gb_hosted_storage', '{{count}} GB hosted storage', {
        count: currentPricing.storage_gb,
      })
    );

    list.push(
      `${t('billing_byo_storage', 'BYO storage')}: ${
        currentPricing.byo_storage
          ? t('billing_yes_badge', 'Yes')
          : t('billing_no_badge', 'No')
      }`
    );

    list.push(
      `${t('billing_priority_support', 'Priority support')}: ${
        currentPricing.priority
          ? t('billing_yes_badge', 'Yes')
          : t('billing_no_badge', 'No')
      }`
    );

    return list;
  }, [agencyPricing, t]);

  if (!user?.tier) {
    return null;
  }

  const isPaidTier =
    user.tier.current === 'PRO' ||
    user.tier.current === 'TEAM' ||
    user.tier.current === 'AGENCY';

  if (user?.id && isPaidTier && !user?.isLifetime) {
    router.replace('/billing');
    return null;
  }

  return (
    <div className="flex gap-[30px]">
      <div className="border border-newTableBorder bg-newBgColorInner p-[24px] flex flex-col gap-[20px] flex-1 rounded-[4px]">
        <div className="text-[30px]">
          {t('current_package', 'Current Package:')}{' '}
          {user?.tier?.current || t('billing_none', 'None')}
        </div>

        <div className="flex flex-col gap-[10px] justify-center text-[16px] text-newTableText">
          {currentFeatures.map((feature) => (
            <div key={feature} className="flex gap-[20px]">
              <div>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <path
                    d="M16.2806 9.21937C16.3504 9.28903 16.4057 9.37175 16.4434 9.46279C16.4812 9.55384 16.5006 9.65144 16.5006 9.75C16.5006 9.84856 16.4812 9.94616 16.4434 10.0372C16.4057 10.1283 16.3504 10.211 16.2806 10.2806L11.0306 15.5306C10.961 15.6004 10.8783 15.6557 10.7872 15.6934C10.6962 15.7312 10.5986 15.7506 10.5 15.7506C10.4014 15.7506 10.3038 15.7312 10.2128 15.6934C10.1218 15.6557 10.039 15.6004 9.96938 15.5306L7.71938 13.2806C7.57865 13.1399 7.49959 12.949 7.49959 12.75C7.49959 12.551 7.57865 12.3601 7.71938 12.2194C7.86011 12.0786 8.05098 11.9996 8.25 11.9996C8.44903 11.9996 8.6399 12.0786 8.78063 12.2194L10.5 13.9397L15.2194 9.21937C15.289 9.14964 15.3718 9.09432 15.4628 9.05658C15.5538 9.01884 15.6514 8.99941 15.75 8.99941C15.8486 8.99941 15.9462 9.01884 16.0372 9.05658C16.1283 9.09432 16.211 9.14964 16.2806 9.21937ZM21.75 12C21.75 13.9284 21.1782 15.8134 20.1068 17.4168C19.0355 19.0202 17.5127 20.2699 15.7312 21.0078C13.9496 21.7458 11.9892 21.9389 10.0979 21.5627C8.20656 21.1865 6.46928 20.2579 5.10571 18.8943C3.74215 17.5307 2.81355 15.7934 2.43735 13.9021C2.06114 12.0108 2.25422 10.0504 2.99218 8.26884C3.73013 6.48726 4.97982 4.96451 6.58319 3.89317C8.18657 2.82183 10.0716 2.25 12 2.25C14.585 2.25273 17.0634 3.28084 18.8913 5.10872C20.7192 6.93661 21.7473 9.41498 21.75 12ZM20.25 12C20.25 10.3683 19.7661 8.77325 18.8596 7.41655C17.9531 6.05984 16.6646 5.00242 15.1571 4.37799C13.6497 3.75357 11.9909 3.59019 10.3905 3.90852C8.79017 4.22685 7.32016 5.01259 6.16637 6.16637C5.01259 7.32015 4.22685 8.79016 3.90853 10.3905C3.5902 11.9908 3.75358 13.6496 4.378 15.1571C5.00242 16.6646 6.05984 17.9531 7.41655 18.8596C8.77326 19.7661 10.3683 20.25 12 20.25C14.1873 20.2475 16.2843 19.3775 17.8309 17.8309C19.3775 16.2843 20.2475 14.1873 20.25 12Z"
                    fill="#06ff00"
                  />
                </svg>
              </div>
              <div>{feature}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="border border-newTableBorder bg-newBgColorInner p-[24px] flex flex-col gap-[20px] flex-1 rounded-[4px]">
        <div className="text-[30px]">
          {t('lifetime_deal', 'Lifetime Deal:')} {LIFETIME_PLAN}
        </div>

        <div className="flex flex-col gap-[10px] justify-center text-[16px] text-newTableText">
          {agencyFeatures.map((feature) => (
            <div key={feature} className="flex gap-[20px]">
              <div>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <path
                    d="M16.2806 9.21937C16.3504 9.28903 16.4057 9.37175 16.4434 9.46279C16.4812 9.55384 16.5006 9.65144 16.5006 9.75C16.5006 9.84856 16.4812 9.94616 16.4434 10.0372C16.4057 10.1283 16.3504 10.211 16.2806 10.2806L11.0306 15.5306C10.961 15.6004 10.8783 15.6557 10.7872 15.6934C10.6962 15.7312 10.5986 15.7506 10.5 15.7506C10.4014 15.7506 10.3038 15.7312 10.2128 15.6934C10.1218 15.6557 10.039 15.6004 9.96938 15.5306L7.71938 13.2806C7.57865 13.1399 7.49959 12.949 7.49959 12.75C7.49959 12.551 7.57865 12.3601 7.71938 12.2194C7.86011 12.0786 8.05098 11.9996 8.25 11.9996C8.44903 11.9996 8.6399 12.0786 8.78063 12.2194L10.5 13.9397L15.2194 9.21937C15.289 9.14964 15.3718 9.09432 15.4628 9.05658C15.5538 9.01884 15.6514 8.99941 15.75 8.99941C15.8486 8.99941 15.9462 9.01884 16.0372 9.05658C16.1283 9.09432 16.211 9.14964 16.2806 9.21937ZM21.75 12C21.75 13.9284 21.1782 15.8134 20.1068 17.4168C19.0355 19.0202 17.5127 20.2699 15.7312 21.0078C13.9496 21.7458 11.9892 21.9389 10.0979 21.5627C8.20656 21.1865 6.46928 20.2579 5.10571 18.8943C3.74215 17.5307 2.81355 15.7934 2.43735 13.9021C2.06114 12.0108 2.25422 10.0504 2.99218 8.26884C3.73013 6.48726 4.97982 4.96451 6.58319 3.89317C8.18657 2.82183 10.0716 2.25 12 2.25C14.585 2.25273 17.0634 3.28084 18.8913 5.10872C20.7192 6.93661 21.7473 9.41498 21.75 12ZM20.25 12C20.25 10.3683 19.7661 8.77325 18.8596 7.41655C17.9531 6.05984 16.6646 5.00242 15.1571 4.37799C13.6497 3.75357 11.9909 3.59019 10.3905 3.90852C8.79017 4.22685 7.32016 5.01259 6.16637 6.16637C5.01259 7.32015 4.22685 8.79016 3.90853 10.3905C3.5902 11.9908 3.75358 13.6496 4.378 15.1571C5.00242 16.6646 6.05984 17.9531 7.41655 18.8596C8.77326 19.7661 10.3683 20.25 12 20.25C14.1873 20.2475 16.2843 19.3775 17.8309 17.8309C19.3775 16.2843 20.2475 14.1873 20.25 12Z"
                    fill="#06ff00"
                  />
                </svg>
              </div>
              <div>{feature}</div>
            </div>
          ))}

          <div className="mt-[20px] flex items-center gap-[10px]">
            <div className="flex-1">
              <Input
                label={t('label_code', 'Code')}
                translationKey="label_code"
                placeholder={t('billing_enter_your_code', 'Enter your code')}
                disableForm={true}
                name="code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            <div>
              <Button disabled={code.length < 4} onClick={claim}>
                {t('claim', 'Claim')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
