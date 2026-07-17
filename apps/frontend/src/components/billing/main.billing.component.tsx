'use client';

import { Slider } from '@gitroom/react/form/slider';
import React, { FC, useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@gitroom/react/form/button';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import type { Subscription } from '@prisma/client';
import { useDebouncedCallback } from 'use-debounce';
import ReactLoading from '@gitroom/frontend/components/layout/loading';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useToaster } from '@gitroom/react/toaster/toaster';
import clsx from 'clsx';
import {
  pricing,
  PlanInterface,
} from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { FAQComponent } from '@gitroom/frontend/components/billing/faq.component';
import { useSWRConfig } from 'swr';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useRouter, useSearchParams } from 'next/navigation';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { Textarea } from '@gitroom/react/form/textarea';
import { useFireEvents } from '@gitroom/helpers/utils/use.fire.events';
import { useUtmUrl } from '@gitroom/helpers/utils/utm.saver';
import { useTrack } from '@gitroom/react/helpers/use.track';
import { TrackEnum } from '@gitroom/nestjs-libraries/user/track.enum';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { FinishTrial } from '@gitroom/frontend/components/billing/finish.trial';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
import { useDubClickId } from '@gitroom/frontend/components/layout/dubAnalytics';
import { LogoutComponent } from '@gitroom/frontend/components/layout/logout.component';
import { PageHeader } from '@gitroom/frontend/components/ui/page-header';

type TierKey = PlanInterface['current'];

export const Prorate: FC<{
  period: 'MONTHLY' | 'YEARLY';
  pack: TierKey;
}> = (props) => {
  const { period, pack } = props;
  const t = useT();
  const fetch = useFetch();
  const [price, setPrice] = useState<number | false>(0);
  const [loading, setLoading] = useState(false);
  const calculatePrice = useDebouncedCallback(async () => {
    setLoading(true);
    setPrice(false);
    setPrice(
      (
        await (
          await fetch('/billing/prorate', {
            method: 'POST',
            body: JSON.stringify({
              period,
              billing: pack,
            }),
          })
        ).json()
      ).price
    );
    setLoading(false);
  }, 500);
  useEffect(() => {
    calculatePrice();
  }, [period, pack, calculatePrice]);
  if (loading) {
    return (
      <div className="pt-[12px]">
        <ReactLoading type="spin" color="#fff" width={20} height={20} />
      </div>
    );
  }
  if (price === false) {
    return null;
  }
  return (
    <div className="text-[12px] flex pt-[12px]">
      ({t('pay_today', 'Pay Today')} ${(price < 0 ? 0 : price)?.toFixed(1)})
    </div>
  );
};

type FeatureRow = {
  label: string;
  value?: string | number;
  badge?: 'yes' | 'no' | 'unlimited';
};

export const Features: FC<{
  pack: TierKey;
}> = (props) => {
  const { pack } = props;
  const t = useT();
  const currentPricing = pricing[pack];

  const features: FeatureRow[] = useMemo(() => {
    const unlimited = (n: number) => n >= 10000;

    return [
      {
        label: t('billing_unlimited_ai_creation', 'Unlimited AI creation'),
      },
      {
        label: t(
          currentPricing.channel === 1
            ? 'billing_social_channel'
            : 'billing_social_channels',
          currentPricing.channel === 1 ? 'social channel' : 'social channels'
        ),
        value: unlimited(currentPricing.channel)
          ? undefined
          : currentPricing.channel,
      },
      {
        label: t('billing_posts_per_month', 'posts per month'),
        value: unlimited(currentPricing.posts_per_month)
          ? undefined
          : currentPricing.posts_per_month,
      },
      {
        label: t(
          currentPricing.team_members === 1
            ? 'billing_team_member'
            : 'billing_team_members',
          currentPricing.team_members === 1 ? 'team member' : 'team members'
        ),
        value: currentPricing.team_members,
      },
      {
        label: t(
          currentPricing.brand_kits === 1
            ? 'billing_brand_kit'
            : 'billing_brand_kits',
          currentPricing.brand_kits === 1 ? 'brand kit' : 'brand kits'
        ),
        value: unlimited(currentPricing.brand_kits)
          ? undefined
          : currentPricing.brand_kits,
      },
      {
        label: t('billing_campaigns', 'Campaigns'),
        badge: currentPricing.campaigns ? 'yes' : 'no',
      },
      {
        label: t('billing_api_and_mcp', 'API & MCP'),
        badge: currentPricing.api && currentPricing.mcp ? 'yes' : 'no',
      },
      {
        label: t(
          currentPricing.webhooks === 1
            ? 'billing_webhook'
            : 'billing_webhooks',
          currentPricing.webhooks === 1 ? 'webhook' : 'webhooks'
        ),
        value: currentPricing.webhooks,
      },
      {
        label: t(
          currentPricing.competitors === 1
            ? 'billing_competitor'
            : 'billing_competitors',
          currentPricing.competitors === 1 ? 'competitor' : 'competitors'
        ),
        value: currentPricing.competitors,
      },
      {
        label: t('billing_analytics_retention', 'analytics retention'),
        value: `${currentPricing.analytics_retention_days} days`,
      },
      {
        label: t('billing_video_exports_per_month', 'video exports/mo'),
        value: currentPricing.video_exports,
      },
      {
        label: t('billing_hosted_storage', 'hosted storage'),
        value: `${currentPricing.storage_gb} GB`,
      },
      {
        label: t('billing_byo_storage', 'BYO storage'),
        badge: currentPricing.byo_storage ? 'yes' : 'no',
      },
      {
        label: t('billing_priority_support', 'Priority support'),
        badge: currentPricing.priority ? 'yes' : 'no',
      },
    ];
  }, [currentPricing, t]);

  const badgeLabel = (badge: FeatureRow['badge']) => {
    if (badge === 'unlimited') {
      return t('billing_unlimited_badge', 'Unlimited');
    }
    if (badge === 'yes') {
      return t('billing_yes_badge', 'Yes');
    }
    return t('billing_no_badge', 'No');
  };

  return (
    <div className="flex flex-col gap-[10px] justify-center text-[16px] text-newTableText">
      {features.map((feature) => (
        <div key={feature.label} className="flex gap-[20px] items-start">
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
          <div className="flex-1 flex flex-col gap-[4px]">
            <div className="flex items-center gap-[10px]">
              {feature.value !== undefined && (
                <span className="font-[600]">{feature.value}</span>
              )}
              <span>{feature.label}</span>
            </div>
            {feature.badge && (
              <span
                className={clsx(
                  'inline-flex items-center px-[8px] py-[2px] rounded-[4px] text-[12px] font-[500] w-fit',
                  feature.badge === 'no'
                    ? 'bg-red-500/20 text-red-500'
                    : 'bg-green-500/20 text-green-500'
                )}
              >
                {badgeLabel(feature.badge)}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

const Accept: FC<{ resolve: (res: boolean) => void }> = ({ resolve }) => {
  const [loading, setLoading] = useState(false);
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();

  const apply = useCallback(async () => {
    setLoading(true);
    await fetch('/billing/apply-discount', {
      method: 'POST',
    });

    resolve(true);
    toaster.show(
      t('billing_50_discount_applied_successfully', '50% discount applied successfully')
    );
  }, [fetch, resolve, toaster, t]);

  return (
    <div>
      <div className="mb-[20px]">
        {t(
          'billing_would_you_accept_50_discount',
          'Would you accept 50% discount for 3 months instead? 🙏🏻'
        )}
      </div>
      <div className="flex gap-[10px]">
        <Button loading={loading} onClick={apply}>
          {t('billing_apply_50_discount_3_months', 'Apply 50% discount for 3 months')}
        </Button>
        <Button onClick={() => resolve(false)} className="!bg-red-800">
          {t('billing_cancel_my_subscription', 'Cancel my subscription')}
        </Button>
      </div>
    </div>
  );
};
const Info: FC<{
  proceed: (feedback: string) => void;
}> = ({ proceed }) => {
  const [feedback, setFeedback] = useState('');
  const modal = useModals();
  const events = useFireEvents();
  const cancel = useCallback(() => {
    proceed(feedback);
    events('cancel_subscription');
    modal.closeAll();
  }, [proceed, feedback, events, modal]);

  const t = useT();

  return (
    <div className="relative flex gap-[20px] flex-col flex-1 rounded-[4px]">
      <div>
        {t(
          'would_you_mind_shortly_tell_us_what_we_could_have_done_better',
          'Would you mind shortly tell us what we could have done better?'
        )}
      </div>
      <div>
        <Textarea
          className="bg-newBgColorInner"
          label={'Feedback'}
          name="feedback"
          disableForm={true}
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
        />
      </div>
      <div>
        <Button disabled={feedback.length < 20} onClick={cancel}>
          {feedback.length < 20
            ? t('please_add_at_least', 'Please add at least 20 characters')
            : t('cancel_subscription', 'Cancel Subscription')}
        </Button>
      </div>
    </div>
  );
};
const normalizePeriod = (p?: string): 'MONTHLY' | 'YEARLY' =>
  p === 'YEARLY' ? 'YEARLY' : 'MONTHLY';

export const MainBillingComponent: FC<{
  sub?: Subscription;
}> = (props) => {
  const { sub } = props;
  const { mutate } = useSWRConfig();
  const fetch = useFetch();
  const toast = useToaster();
  const user = useUser();
  const dub = useDubClickId();
  const modal = useModals();
  const router = useRouter();
  const utm = useUtmUrl();
  const track = useTrack(user);
  const t = useT();
  const queryParams = useSearchParams();
  const [finishTrial, setFinishTrial] = useState(
    !!queryParams.get('finishTrial')
  );

  const [subscription, setSubscription] = useState<Subscription | undefined>(
    sub
  );
  const [loading, setLoading] = useState<boolean>(false);

  const [period, setPeriod] = useState<'MONTHLY' | 'YEARLY'>(
    normalizePeriod(subscription?.period)
  );
  const [monthlyOrYearly, setMonthlyOrYearly] = useState<'on' | 'off'>(
    period === 'MONTHLY' ? 'off' : 'on'
  );

  useEffect(() => {
    // Sync local UI state when the subscription prop changes (e.g. after a
    // reactivation). Calling setState here is intentional and bounded by the
    // id check below, so it cannot loop.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (sub?.id !== subscription?.id) {
      setSubscription(sub);
      const subPeriod = normalizePeriod(sub?.period);
      setPeriod(subPeriod);
      setMonthlyOrYearly(subPeriod === 'MONTHLY' ? 'off' : 'on');
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [sub, subscription?.id]);

  const updatePayment = useCallback(async () => {
    const { portal } = await (await fetch('/billing/portal')).json();
    window.location.href = portal;
  }, [fetch]);

  const currentPackage = useMemo(() => {
    if (!subscription) {
      return '';
    }
    if (period === 'YEARLY' && monthlyOrYearly === 'off') {
      return '';
    }
    if (period === 'MONTHLY' && monthlyOrYearly === 'on') {
      return '';
    }
    return subscription?.subscriptionTier;
  }, [subscription, monthlyOrYearly, period]);

  const handleCancelOrReactivate = useCallback(
    (reactivate = false) => async () => {
      if (reactivate) {
        setLoading(true);
        const { cancel_at } = await (
          await fetch('/billing/cancel', {
            method: 'POST',
            body: JSON.stringify({
              feedback: '',
            }),
            headers: {
              'Content-Type': 'application/json',
            },
          })
        ).json();
        setSubscription((subs) => ({
          ...subs!,
          cancelAt: cancel_at,
        }));

        toast.show(
          t(
            'billing_subscription_reactivated_successfully',
            'Subscription reactivated successfully'
          )
        );
        setLoading(false);
        return;
      }

      if (
        subscription?.cancelAt ||
        (await deleteDialog(
          t(
            'billing_cancel_subscription_confirmation',
            'Are you sure you want to cancel your subscription?'
          ),
          t('billing_yes_cancel', 'Yes, cancel'),
          t('cancel_subscription', 'Cancel Subscription')
        ))
      ) {
        const checkDiscount = await (
          await fetch('/billing/check-discount')
        ).json();
        if (checkDiscount.offerCoupon) {
          const info = await new Promise((res) => {
            modal.openModal({
              title: t('billing_before_you_cancel', 'Before you cancel'),
              withCloseButton: true,
              classNames: {
                modal: 'bg-transparent text-textColor',
              },
              children: <Accept resolve={res} />,
            });
          });

          modal.closeAll();

          if (info) {
            return;
          }
        }

        const info = await new Promise((res) => {
          modal.openModal({
            title: t(
              'we_are_sorry_to_see_you_go',
              'We are sorry to see you go :('
            ),
            withCloseButton: true,
            classNames: {
              modal: 'bg-transparent text-textColor',
            },
            children: <Info proceed={(e) => res(e)} />,
          });
        });

        setLoading(true);
        const { cancel_at } = await (
          await fetch('/billing/cancel', {
            method: 'POST',
            body: JSON.stringify({
              feedback: info,
            }),
            headers: {
              'Content-Type': 'application/json',
            },
          })
        ).json();
        setSubscription((subs) => ({
          ...subs!,
          cancelAt: cancel_at,
        }));
        if (cancel_at)
          toast.show(
            t(
              'billing_subscription_set_to_canceled_successfully',
              'Subscription set to canceled successfully'
            )
          );
        setLoading(false);
      }
    },
    [fetch, modal, subscription, t, toast]
  );

  const moveToCheckout = useCallback(
    (billing: TierKey) => async () => {
      const messages = [];
      const currentTier = subscription?.subscriptionTier as TierKey | undefined;
      if (
        currentTier &&
        pricing[billing].team_members < pricing[currentTier].team_members
      ) {
        messages.push(
          t(
            'billing_team_members_may_be_removed',
            'Your team members may be removed from your organization'
          )
        );
      }

      if (
        messages.length &&
        !(await deleteDialog(
          messages.join(', '),
          t('billing_yes_continue', 'Yes, continue')
        ))
      ) {
        return;
      }
      setLoading(true);
      const { url, portal } = await (
        await fetch('/billing/subscribe', {
          method: 'POST',
          body: JSON.stringify({
            period: monthlyOrYearly === 'on' ? 'YEARLY' : 'MONTHLY',
            utm,
            billing,
            ...(dub ? { dub } : {}),
          }),
        })
      ).json();
      if (url) {
        await track(TrackEnum.InitiateCheckout, {
          value:
            pricing[billing][
              monthlyOrYearly === 'on' ? 'year_price' : 'month_price'
            ],
        });
        window.location.href = url;
        return;
      }
      if (portal) {
        if (
          await deleteDialog(
            t(
              'billing_could_not_charge_credit_card',
              'We could not charge your credit card, please update your payment method'
            ),
            t('update', 'Update'),
            t('billing_payment_method_required', 'Payment Method Required')
          )
        ) {
          window.open(portal);
        }
      } else {
        setPeriod(monthlyOrYearly === 'on' ? 'YEARLY' : 'MONTHLY');
        setSubscription((subs) => ({
          ...subs!,
          subscriptionTier: billing,
          cancelAt: null,
        }));
        mutate(
          '/user/self',
          {
            ...user,
            tier: pricing[billing],
          },
          {
            revalidate: false,
          }
        );
        toast.show(
          t(
            'billing_subscription_updated_successfully',
            'Subscription updated successfully'
          )
        );
      }
      setLoading(false);
    },
    [dub, fetch, monthlyOrYearly, mutate, subscription, t, toast, track, user, utm]
  );

  if (user?.isLifetime) {
    router.replace('/');
    return null;
  }

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        title={t('billing', 'Billing')}
        description={t(
          'billing_manage_subscription_and_plan',
          'Manage your subscription and plan'
        )}
        action={
          <div className="flex items-center gap-[16px]">
            <div>{t('monthly', 'MONTHLY')}</div>
            <div>
              <Slider value={monthlyOrYearly} onChange={setMonthlyOrYearly} />
            </div>
            <div>{t('yearly', 'YEARLY')}</div>
          </div>
        }
      />

      {finishTrial && <FinishTrial close={() => setFinishTrial(false)} />}
      <div className="flex gap-[16px] [@media(max-width:1024px)]:flex-col [@media(max-width:1024px)]:text-center">
        {Object.entries(pricing).map(([name, values]) => (
          <div
            key={name}
            className="flex-1 bg-newBgColorInner border border-newTableBorder rounded-[4px] p-[24px] gap-[16px] flex flex-col [@media(max-width:1024px)]:items-center"
          >
            <div className="text-[18px]">{name}</div>
            <div className="text-[38px] flex gap-[2px] items-center">
              <div>
                ${monthlyOrYearly === 'on' ? values.year_price : values.month_price}
              </div>
              <div className={`text-[14px] text-newTableText`}>
                {monthlyOrYearly === 'on'
                  ? t('billing_slash_year', '/year')
                  : t('billing_slash_month', '/month')}
              </div>
            </div>
            <div className="text-[14px] flex gap-[10px]">
              {currentPackage === name.toUpperCase() &&
              subscription?.cancelAt ? (
                <div className="gap-[3px] flex flex-col">
                  <div>
                    <Button
                      onClick={handleCancelOrReactivate(true)}
                      loading={loading}
                    >
                      {t(
                        'reactivate_subscription',
                        'Reactivate subscription'
                      )}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  loading={loading}
                  disabled={currentPackage === name.toUpperCase()}
                  onClick={moveToCheckout(name.toUpperCase() as TierKey)}
                >
                  {currentPackage === name.toUpperCase()
                    ? t('billing_current_plan', 'Current Plan')
                    : user?.allowTrial
                    ? t(
                        'start_30_days_free_trial',
                        'Start 30 days free trial'
                      )
                    : t('billing_purchase', 'Purchase')}
                </Button>
              )}
              {subscription &&
                currentPackage !== name.toUpperCase() &&
                !!name && (
                  <Prorate
                    period={monthlyOrYearly === 'on' ? 'YEARLY' : 'MONTHLY'}
                    pack={name.toUpperCase() as TierKey}
                  />
                )}
            </div>
            <Features pack={name.toUpperCase() as TierKey} />
          </div>
        ))}
      </div>
      {!!subscription?.id && (
        <div className="flex justify-center mt-[20px] gap-[10px]">
          <Button onClick={updatePayment}>
            {t(
              'update_payment_method_invoices_history',
              'Update Payment Method / Invoices History'
            )}
          </Button>
          {!subscription?.cancelAt && (
            <Button
              className="bg-red-500"
              loading={loading}
              onClick={handleCancelOrReactivate(false)}
            >
              {t('cancel_subscription_1', 'Cancel subscription')}
            </Button>
          )}
        </div>
      )}
      {subscription?.cancelAt && (
        <div className="text-center">
          {t(
            'your_subscription_will_be_canceled_at',
            'Your subscription will be canceled at'
          )}{' '}
          {newDayjs(subscription.cancelAt)
            .local()
            .format(t('billing_date_format', 'D MMM, YYYY'))}
          <br />
          {t(
            'you_will_never_be_charged_again',
            'You will never be charged again'
          )}
        </div>
      )}
      <FAQComponent />
      <div className="flex justify-center mt-[20px]">
        <LogoutComponent />
      </div>
    </div>
  );
};
