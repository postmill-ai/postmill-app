'use client';

import React, { FC, useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { loadStripe, Stripe } from '@stripe/stripe-js';
import { OrganizationSelector } from '@gitroom/frontend/components/layout/organization.selector';
import { LanguageComponent } from '@gitroom/frontend/components/layout/language.component';
import { AttachToFeedbackIcon } from '@gitroom/frontend/components/new-layout/sentry.feedback.component';
import NotificationComponent from '@gitroom/frontend/components/notifications/notification.component';
import dynamic from 'next/dynamic';
import { LogoTextComponent } from '@gitroom/frontend/components/ui/logo-text.component';
import {
  pricing,
  PlanInterface,
} from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { capitalize } from 'lodash';
import clsx from 'clsx';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { CheckIconComponent } from '@gitroom/frontend/components/ui/check.icon.component';
import { FAQComponent } from '@gitroom/frontend/components/billing/faq.component';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useDubClickId } from '@gitroom/frontend/components/layout/dubAnalytics';
import SafeImage from '@gitroom/react/helpers/safe.image';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import useCookie from 'react-use-cookie';
import { LogoutComponent } from '@gitroom/frontend/components/layout/logout.component';
import { DeveloperIconComponent } from '@gitroom/frontend/components/developer/developer.icon.component';

const ModeComponent = dynamic(
  () => import('@gitroom/frontend/components/layout/mode.component'),
  {
    ssr: false,
  }
);

const EmbeddedBilling = dynamic(
  () =>
    import('@gitroom/frontend/components/billing/embedded.billing').then(
      (mod) => mod.EmbeddedBilling
    ),
  {
    ssr: false,
  }
);

const JoinOver: FC<{ onShowYouTube: () => void }> = ({ onShowYouTube }) => {
  const t = useT();
  const user = useUser();
  return (
    <>
      <div className="text-[46px] font-[600] leading-[110%] tablet:text-[36px] mobile:!text-[30px] whitespace-pre-line text-balance">
        {t('billing_join_over', 'Join Over')}{' '}
        <span className="text-[#1d9bf0]">
          {t('billing_entrepreneurs_count', '20,000+ Entrepreneurs')}
        </span>{' '}
        {t('billing_who_use', 'who use')}{' '}
        {t(
          'billing_postiz_grow_social',
          'Postmill To Grow Their Social Presence'
        )}
      </div>

      <div className="flex">
        <button
          type="button"
          onClick={onShowYouTube}
          className="tablet:mb-[32px] mt-[32px] flex gap-[10px] items-center underline hover:font-[700] m-0 p-0 border-0 bg-transparent text-left"
        >
          <div>
            <SafeImage
              className="text-[12px]"
              src="/icons/platforms/youtube.svg"
              width={22.5}
              height={16}
              alt={t('youtube', 'YouTube')}
            />
          </div>
          <div>
            {t(
              'billing_see_the_power_of_postiz',
              'See the power of Postmill (click here)'
            )}
          </div>
        </button>
      </div>

      {!!user?.allowTrial && (
        <div className="flex mt-[32px] mb-[10px] gap-[15px] tablet:mt-[32px] tablet:mb-[32px] text-[16px] font-[500] mobile:flex-col">
          <div className="flex gap-[8px]">
            <div>
              <CheckIconComponent />
            </div>
            <div>{t('billing_no_risk_trial', '100% No-Risk Free Trial')}</div>
          </div>
          <div className="flex-1 flex gap-[8px] justify-center mobile:justify-start">
            <div>
              <CheckIconComponent />
            </div>
            <div>
              {t(
                'billing_pay_nothing_30_days',
                'Pay NOTHING for the first 30 days'
              )}
            </div>
          </div>
          <div className="flex gap-[8px]">
            <div>
              <CheckIconComponent />
            </div>
            <div>
              {t('billing_cancel_anytime', 'Cancel anytime, from settings')}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export const FirstBillingComponent = () => {
  const { stripeClient } = useVariables();
  const user = useUser();
  const dub = useDubClickId();
  const [stripe] = useState<Promise<Stripe | null> | null>(() =>
    stripeClient ? loadStripe(stripeClient) : null
  );
  const [tier, setTier] = useState<PlanInterface['current']>('STARTER');
  const [period, setPeriod] = useState('MONTHLY');
  const fetch = useFetch();
  const modals = useModals();
  const t = useT();
  const [datafast_visitor_id] = useCookie('datafast_visitor_id', '');
  const [datafast_session_id] = useCookie('datafast_session_id', '');

  const loadCheckout = useCallback(async () => {
    return (
      await fetch('/billing/embedded', {
        method: 'POST',
        body: JSON.stringify({
          billing: tier,
          period: period,
          ...(datafast_visitor_id && datafast_session_id
            ? { datafast_visitor_id, datafast_session_id }
            : {}),
          ...(dub ? { dub } : {}),
        }),
      })
    ).json();
  }, [fetch, tier, period, datafast_visitor_id, datafast_session_id, dub]);

  const showYouTube = () => {
    modals.openModal({
      title: t(
        'billing_grow_fast_with_postiz_play_video',
        'Grow Fast With Postmill (Play the video)'
      ),
      children: (
        <iframe
          className="h-full aspect-video min-w-[800px]"
          src="https://www.youtube.com/embed/BdsCVvEYgHU?si=vvhaZJ8I5oXXvVJS?autoplay=1"
          title={t('billing_postiz_tutorial', 'Postmill Tutorial')}
          allow="autoplay"
          allowFullScreen
        />
      ),
    });
  };

  const { data, isLoading } = useSWR(
    `/billing-${tier}-${period}`,
    loadCheckout,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
      refreshWhenOffline: false,
      refreshWhenHidden: false,
    }
  );

  const price = useMemo(() => Object.entries(pricing), []);

  return (
    <div className="blurMe flex flex-1 flex-col bg-newBgColorInner pb-[60px] mobile:pb-[100px]">
      <div className="h-[92px] px-[80px] tablet:px-[32px] mobile:!px-[16px] py-[20px] flex border-b border-newColColor">
        <div className="flex-1 flex items-center text-textColor">
          <LogoTextComponent />
        </div>
        <div className="flex items-center">
          <div className="flex gap-[20px] text-textItemBlur">
            <OrganizationSelector />
            <div className="hover:text-newTextColor">
              <ModeComponent />
            </div>
            <div className="w-[1px] h-[20px] bg-blockSeparator" />
            <LanguageComponent />
            <div className="w-[1px] h-[20px] bg-blockSeparator" />
            <AttachToFeedbackIcon />
            <DeveloperIconComponent />
            <NotificationComponent />
            <div className="hover:text-newTextColor">
              <LogoutComponent isIcon={true} />
            </div>
          </div>
        </div>
      </div>
      <div className="flex px-[80px] tablet:px-[32px] mobile:!px-[16px] flex-1 flex-row tablet:flex-none tablet:flex-col-reverse">
        <div className="flex-1 py-[40px] tablet:pt-[80px] flex flex-col pe-[40px] tablet:pe-0">
          <div className="block tablet:hidden">
            <JoinOver onShowYouTube={showYouTube} />
          </div>
          {!isLoading && data && stripe ? (
            <EmbeddedBilling
              stripe={stripe}
              secret={data.client_secret}
              showCoupon={period === 'MONTHLY'}
              autoApplyCoupon={data.auto_apply_coupon}
            />
          ) : (
            <LoadingComponent />
          )}
        </div>
        <div className="flex flex-col ps-[40px] tablet:!ps-[0] border-l border-newColColor py-[40px] mobile:!pt-[24px] tablet:border-none tablet:pb-0">
          <div className="top-[20px] sticky">
            <div className="hidden tablet:block">
              <JoinOver onShowYouTube={showYouTube} />
            </div>
            <div className="flex mb-[24px] mobile:flex-col">
              <div className="flex-1 text-[24px] font-[700]">
                {t('billing_choose_plan', 'Choose a Plan')}
              </div>
              <div className="h-[44px] px-[6px] mobile:px-0 flex items-center justify-center mobile:justify-start gap-[12px] border border-newColColor rounded-[12px] select-none">
                <button
                  type="button"
                  className={clsx(
                    'm-0 p-0 border-0 bg-transparent h-[32px] mobile:flex-1 rounded-[6px] text-[16px] px-[12px] flex justify-center items-center',
                    period === 'MONTHLY'
                      ? 'bg-boxFocused text-textItemFocused'
                      : 'cursor-pointer'
                  )}
                  onClick={() => setPeriod('MONTHLY')}
                >
                  {t('billing_monthly', 'Monthly')}
                </button>
                <button
                  type="button"
                  className={clsx(
                    'm-0 p-0 border-0 bg-transparent gap-[10px] h-[32px] mobile:flex-1 rounded-[6px] text-[16px] px-[12px] flex justify-center items-center',
                    period === 'YEARLY'
                      ? 'bg-boxFocused text-textItemFocused'
                      : 'cursor-pointer'
                  )}
                  onClick={() => setPeriod('YEARLY')}
                >
                  <div>{t('billing_yearly', 'Yearly')}</div>
                  <div className="bg-[#AA0FA4] text-[white] px-[8px] rounded-[4px] mobile:hidden">
                    {t('billing_20_percent_off', '20% Off')}
                  </div>
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-[8px] mobile:!grid-cols-2 tablet:grid-cols-4">
              {price.map(
                ([key, value]) => (
                  <button
                    type="button"
                    onClick={() => setTier(key as PlanInterface['current'])}
                    key={key}
                    className={clsx(
                      'm-0 p-0 border-0 bg-transparent text-left cursor-pointer select-none w-[266px] h-[138px] tablet:w-full tablet:h-[124px] p-[24px] tablet:p-[15px] rounded-[20px] flex flex-col',
                      key === tier
                        ? 'border-[1.5px] border-[#618DFF]'
                        : 'border-[1.5px] border-newColColor'
                    )}
                  >
                    <div className="text-[20px] mobile:text-[18px] font-[500]">
                      {capitalize(key)}
                    </div>
                    <div className="text-[24px] mobile:text-[18px] font-[400]">
                      <span className="text-[44px] mobile:text-[30px] font-[600]">
                        $
                        {
                          value[
                            period === 'MONTHLY' ? 'month_price' : 'year_price'
                          ]
                        }
                      </span>{' '}
                      {period === 'MONTHLY'
                        ? t('billing_per_month', '/ month')
                        : t('billing_per_year', '/ year')}
                    </div>
                  </button>
                ),
                []
              )}
            </div>
            <div className="flex flex-col mt-[54px] gap-[24px] tablet:mt-[40px]">
              <div className="text-[24px] font-[700]">
                {t('billing_features', 'Features')}
              </div>
              <BillingFeatures tier={tier} />
            </div>
            <div className="flex flex-col mobile:hidden tablet:hidden">
              {/*<div>asd</div>*/}
              <FAQComponent />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

type FeatureItem = {
  key: string;
  defaultValue: string;
  prefix?: string | number;
  badge?: 'yes' | 'no' | 'unlimited';
};

export const BillingFeatures: FC<{ tier: PlanInterface['current'] }> = ({
  tier,
}) => {
  const t = useT();
  const currentPricing = pricing[tier];

  const features = useMemo((): FeatureItem[] => {
    const list: FeatureItem[] = [];

    list.push({
      key: 'billing_unlimited_ai_creation',
      defaultValue: 'Unlimited AI creation',
    });

    list.push({
      key:
        currentPricing.channel === 1
          ? 'billing_social_channel'
          : 'billing_social_channels',
      defaultValue:
        currentPricing.channel === 1 ? 'social channel' : 'social channels',
      prefix:
        currentPricing.channel >= 10000
          ? 'unlimited'
          : currentPricing.channel,
    });

    list.push({
      key: 'billing_posts_per_month',
      defaultValue: 'posts per month',
      prefix:
        currentPricing.posts_per_month >= 10000
          ? 'unlimited'
          : currentPricing.posts_per_month,
    });

    list.push({
      key:
        currentPricing.team_members === 1
          ? 'billing_team_member'
          : 'billing_team_members',
      defaultValue:
        currentPricing.team_members === 1 ? 'team member' : 'team members',
      prefix: currentPricing.team_members,
    });

    list.push({
      key:
        currentPricing.brand_kits === 1
          ? 'billing_brand_kit'
          : 'billing_brand_kits',
      defaultValue:
        currentPricing.brand_kits === 1 ? 'brand kit' : 'brand kits',
      prefix: currentPricing.brand_kits,
    });

    list.push({
      key: 'billing_campaigns',
      defaultValue: 'Campaigns',
      badge: currentPricing.campaigns ? 'yes' : 'no',
    });

    list.push({
      key: 'billing_api_and_mcp',
      defaultValue: 'API & MCP',
      badge: currentPricing.api && currentPricing.mcp ? 'yes' : 'no',
    });

    list.push({
      key:
        currentPricing.webhooks === 1
          ? 'billing_webhook'
          : 'billing_webhooks',
      defaultValue: currentPricing.webhooks === 1 ? 'webhook' : 'webhooks',
      prefix: currentPricing.webhooks,
    });

    list.push({
      key:
        currentPricing.competitors === 1
          ? 'billing_competitor'
          : 'billing_competitors',
      defaultValue:
        currentPricing.competitors === 1 ? 'competitor' : 'competitors',
      prefix: currentPricing.competitors,
    });

    list.push({
      key: 'billing_analytics_retention',
      defaultValue: 'analytics retention',
      prefix: `${currentPricing.analytics_retention_days} days`,
    });

    list.push({
      key: 'billing_video_exports_per_month',
      defaultValue: 'video exports/mo',
      prefix: currentPricing.video_exports,
    });

    list.push({
      key: 'billing_hosted_storage',
      defaultValue: 'hosted storage',
      prefix: `${currentPricing.storage_gb} GB`,
    });

    list.push({
      key: 'billing_byo_storage',
      defaultValue: 'BYO storage',
      badge: currentPricing.byo_storage ? 'yes' : 'no',
    });

    list.push({
      key: 'billing_priority_support',
      defaultValue: 'Priority support',
      badge: currentPricing.priority ? 'yes' : 'no',
    });

    return list;
  }, [currentPricing, t]);

  const renderFeature = (feature: FeatureItem) => {
    const translatedText = t(feature.key, feature.defaultValue);
    if (feature.badge === 'unlimited' || feature.prefix === 'unlimited') {
      return t('billing_unlimited_feature', 'Unlimited {{feature}}', {
        feature: translatedText,
      });
    }
    if (feature.prefix !== undefined) {
      return t('billing_feature_with_prefix', '{{prefix}} {{feature}}', {
        prefix: feature.prefix,
        feature: translatedText,
      });
    }
    return translatedText;
  };

  return (
    <div className="grid grid-cols-2 mobile:grid-cols-1 gap-y-[8px] gap-x-[32px]">
      {features.map((feature) => (
        <div key={feature.key} className="flex items-center gap-[8px]">
          <div>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="17"
              height="17"
              viewBox="0 0 17 17"
              fill="none"
            >
              <path
                d="M11.825 0H4.84167C1.80833 0 0 1.80833 0 4.84167V11.8167C0 14.8583 1.80833 16.6667 4.84167 16.6667H11.8167C14.85 16.6667 16.6583 14.8583 16.6583 11.825V4.84167C16.6667 1.80833 14.8583 0 11.825 0ZM12.3167 6.41667L7.59167 11.1417C7.475 11.2583 7.31667 11.325 7.15 11.325C6.98333 11.325 6.825 11.2583 6.70833 11.1417L4.35 8.78333C4.10833 8.54167 4.10833 8.14167 4.35 7.9C4.59167 7.65833 4.99167 7.65833 5.23333 7.9L7.15 9.81667L11.4333 5.53333C11.675 5.29167 12.075 5.29167 12.3167 5.53333C12.5583 5.775 12.5583 6.16667 12.3167 6.41667Z"
                fill="currentColor"
              />
            </svg>
          </div>
          <div className="flex items-center gap-[8px]">
            {feature.badge && feature.badge !== 'unlimited' && (
              <span
                className={clsx(
                  'inline-flex items-center px-[6px] py-[1px] rounded-[4px] text-[11px] font-[500]',
                  feature.badge === 'no'
                    ? 'bg-red-500/20 text-red-500'
                    : 'bg-green-500/20 text-green-500'
                )}
              >
                {feature.badge === 'yes'
                  ? t('billing_yes_badge', 'Yes')
                  : t('billing_no_badge', 'No')}
              </span>
            )}
            <span>{renderFeature(feature)}</span>
          </div>
        </div>
      ))}
    </div>
  );
};
