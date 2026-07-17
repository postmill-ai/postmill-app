'use client';

import React, { useCallback, useState } from 'react';
import clsx from 'clsx';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Button } from '@gitroom/react/form/button';
import {
  pricing,
  type PlanInterface,
} from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
import Link from 'next/link';
import {
  refreshSubscriptionData,
  useSubscription,
  useSubscriptionUsage,
  type SubscriptionTier,
  type UsageData,
  type UsageLimits,
} from '@gitroom/frontend/components/settings/subscription/use-subscription';

const ADDON_STORAGE_GB_PER_PACK = Number(
  process.env.NEXT_PUBLIC_ADDON_STORAGE_GB_PER_PACK || 25
);
const ADDON_VIDEO_EXPORTS_PER_PACK = Number(
  process.env.NEXT_PUBLIC_ADDON_VIDEO_EXPORTS_PER_PACK || 50
);

const TIER_ORDER: SubscriptionTier[] = ['STARTER', 'PRO', 'TEAM', 'AGENCY'];

const tierRank = (tier?: string | null) =>
  TIER_ORDER.indexOf((tier as SubscriptionTier) ?? 'STARTER');

const formatDate = (value: string | Date | null | undefined) => {
  if (!value) return '';
  return newDayjs(value).format('D MMM, YYYY');
};

const bytesToGb = (bytes: number) => bytes / 1024 / 1024 / 1024;

interface UsageBarProps {
  label: string;
  used: number;
  limit: number;
  unit?: string;
  unlimited?: boolean;
}

const UsageBar: React.FC<UsageBarProps> = ({
  label,
  used,
  limit,
  unit = '',
  unlimited,
}) => {
  const pct = limit > 0 && !unlimited ? Math.min(100, (used / limit) * 100) : 0;
  const color =
    pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-btnPrimary';

  return (
    <div className="flex flex-col gap-[4px]">
      <div className="flex justify-between text-[13px]">
        <span className="text-textColor">{label}</span>
        <span className="text-newTableText">
          {unlimited ? (
            'Unlimited'
          ) : (
            <>
              {used.toLocaleString(undefined, { maximumFractionDigits: 1 })}
              {unit} / {limit.toLocaleString(undefined, { maximumFractionDigits: 1 })}
              {unit}
            </>
          )}
        </span>
      </div>
      {!unlimited && limit > 0 && (
        <div className="h-[6px] w-full rounded-full bg-newTableBorder overflow-hidden">
          <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
};

const PlanCard: React.FC<{
  tier: SubscriptionTier;
  plan: PlanInterface;
  period: 'MONTHLY' | 'YEARLY';
  isCurrent: boolean;
  isSelected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}> = ({ tier, plan, period, isCurrent, isSelected, disabled, onSelect }) => {
  const t = useT();
  const price = period === 'YEARLY' ? plan.year_price : plan.month_price;
  const periodLabel =
    period === 'YEARLY'
      ? t('billing_slash_year', '/year')
      : t('billing_slash_month', '/month');

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled || isCurrent}
      className={clsx(
        'flex-1 text-start bg-newBgColorInner border rounded-[4px] p-[16px] flex flex-col gap-[8px] transition-all',
        isSelected
          ? 'border-btnPrimary ring-1 ring-btnPrimary'
          : 'border-newTableBorder hover:border-newTableText',
        (disabled || isCurrent) && 'opacity-60 cursor-not-allowed'
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[14px] font-semibold text-textColor">{tier}</span>
        {isCurrent && (
          <span className="text-[11px] font-medium px-[6px] py-[2px] rounded-full bg-btnPrimary/10 text-btnPrimary">
            {t('billing_current_plan', 'Current')}
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-[4px]">
        <span className="text-[28px] font-semibold text-textColor">${price}</span>
        <span className="text-[13px] text-newTableText">{periodLabel}</span>
      </div>
      <div className="text-[12px] text-newTableText">
        {plan.channel} {t('channels', 'channels')} · {plan.video_exports}{' '}
        {t('video_exports_label', 'exports')} · {plan.storage_gb}{' '}
        {t('storage_gb_label', 'GB storage')}
      </div>
    </button>
  );
};

const Stepper: React.FC<{
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}> = ({ value, min = 1, max = 99, onChange, disabled }) => {
  return (
    <div className="flex items-center gap-[8px]">
      <button
        type="button"
        disabled={disabled || value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
        className="w-[32px] h-[32px] flex items-center justify-center rounded-[6px] bg-newBgColor border border-newTableBorder text-textColor disabled:opacity-40"
      >
        −
      </button>
      <span className="w-[40px] text-center text-[14px] text-textColor">{value}</span>
      <button
        type="button"
        disabled={disabled || value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
        className="w-[32px] h-[32px] flex items-center justify-center rounded-[6px] bg-newBgColor border border-newTableBorder text-textColor disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
};

export const SubscriptionPanel: React.FC = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const user = useUser();

  const { data: subscription, isLoading: subLoading, error: subError } = useSubscription();
  const { data: usage, isLoading: usageLoading, error: usageError } = useSubscriptionUsage();

  const [selectedTier, setSelectedTier] = useState<SubscriptionTier | null>(null);
  const [changeLoading, setChangeLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [addonLoading, setAddonLoading] = useState<Record<string, boolean>>({});

  const currentTier = (subscription?.subscriptionTier as SubscriptionTier) ?? 'STARTER';
  const period: 'MONTHLY' | 'YEARLY' =
    subscription?.period === 'YEARLY' ? 'YEARLY' : 'MONTHLY';
  const renewalDate = subscription?.cancelAt
    ? formatDate(subscription.cancelAt)
    : '';

  const usageData: UsageData | null = usage?.usage ?? null;
  const limits: UsageLimits | null = usage?.limits ?? null;

  const handleChangePlan = useCallback(async () => {
    if (!selectedTier || selectedTier === currentTier) return;
    setChangeLoading(true);
    try {
      const res = await fetch('/billing/change-plan', {
        method: 'POST',
        body: JSON.stringify({ tier: selectedTier }),
      });
      const body = await res.json();
      if (!res.ok) {
        toaster.show(
          body?.message || t('change_plan_failed', 'Failed to change plan'),
          'warning'
        );
        return;
      }
      if (body.url) {
        window.location.href = body.url;
        return;
      }
      if (body.portal) {
        window.location.href = body.portal;
        return;
      }
      toaster.show(t('plan_updated', 'Plan updated'), 'success');
      setSelectedTier(null);
      refreshSubscriptionData();
    } catch (err) {
      toaster.show(t('change_plan_failed', 'Failed to change plan'), 'warning');
    } finally {
      setChangeLoading(false);
    }
  }, [fetch, selectedTier, currentTier, toaster, t]);

  const handleCancel = useCallback(async () => {
    setCancelLoading(true);
    try {
      const res = await fetch('/billing/cancel', {
        method: 'POST',
        body: JSON.stringify({ feedback: '' }),
      });
      const body = await res.json();
      if (!res.ok) {
        toaster.show(
          body?.message || t('cancel_failed', 'Failed to update cancellation'),
          'warning'
        );
        return;
      }
      toaster.show(
        body.cancel_at
          ? t('subscription_canceled', 'Subscription canceled at period end')
          : t('subscription_resumed', 'Subscription resumed'),
        'success'
      );
      refreshSubscriptionData();
    } catch (err) {
      toaster.show(t('cancel_failed', 'Failed to update cancellation'), 'warning');
    } finally {
      setCancelLoading(false);
    }
  }, [fetch, toaster, t]);

  const handleUndoPending = useCallback(async () => {
    setChangeLoading(true);
    try {
      const res = await fetch('/billing/change-plan', {
        method: 'POST',
        body: JSON.stringify({ tier: currentTier }),
      });
      const body = await res.json();
      if (!res.ok) {
        toaster.show(
          body?.message || t('undo_pending_failed', 'Failed to undo pending change'),
          'warning'
        );
        return;
      }
      toaster.show(t('pending_change_cleared', 'Pending change cleared'), 'success');
      refreshSubscriptionData();
    } catch (err) {
      toaster.show(t('undo_pending_failed', 'Failed to undo pending change'), 'warning');
    } finally {
      setChangeLoading(false);
    }
  }, [fetch, currentTier, toaster, t]);

  const updateAddon = useCallback(
    async (type: 'storage' | 'video_exports', packs: number) => {
      setAddonLoading((prev) => ({ ...prev, [type]: true }));
      try {
        const res = await fetch('/billing/addons', {
          method: 'POST',
          body: JSON.stringify({ type, packs }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          toaster.show(
            body?.message || t('addon_update_failed', 'Failed to update add-on'),
            'warning'
          );
          return;
        }
        toaster.show(t('addon_updated', 'Add-on updated'), 'success');
        refreshSubscriptionData();
      } catch (err) {
        toaster.show(t('addon_update_failed', 'Failed to update add-on'), 'warning');
      } finally {
        setAddonLoading((prev) => ({ ...prev, [type]: false }));
      }
    },
    [fetch, toaster, t]
  );

  const removeAddon = useCallback(
    async (type: 'storage' | 'video_exports') => {
      setAddonLoading((prev) => ({ ...prev, [type]: true }));
      try {
        const res = await fetch(`/billing/addons/${type}`, {
          method: 'DELETE',
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          toaster.show(
            body?.message || t('addon_remove_failed', 'Failed to remove add-on'),
            'warning'
          );
          return;
        }
        toaster.show(t('addon_removed', 'Add-on removed'), 'success');
        refreshSubscriptionData();
      } catch (err) {
        toaster.show(t('addon_remove_failed', 'Failed to remove add-on'), 'warning');
      } finally {
        setAddonLoading((prev) => ({ ...prev, [type]: false }));
      }
    },
    [fetch, toaster, t]
  );

  const isLoading = subLoading || usageLoading;
  const error = subError || usageError;

  if (isLoading) {
    return (
      <div className="bg-newBgColorInner border border-newTableBorder rounded-[4px] p-[24px] animate-pulse h-[200px]" />
    );
  }

  if (error || !subscription || usage?.billingEnabled === false) {
    return (
      <div className="bg-newBgColorInner border border-newTableBorder rounded-[4px] p-[24px] flex flex-col items-center gap-[12px]">
        <span className="text-[14px] text-red-500">
          {usage?.billingEnabled === false
            ? t('billing_not_enabled', 'Billing is not enabled for this workspace.')
            : t('subscription_load_failed', 'Failed to load subscription')}
        </span>
        <Button onClick={() => refreshSubscriptionData()}>
          {t('try_again', 'Try again')}
        </Button>
      </div>
    );
  }

  const plan = pricing[currentTier];
  const price = period === 'YEARLY' ? plan.year_price : plan.month_price;

  const selectedRank = selectedTier ? tierRank(selectedTier) : -1;
  const currentRank = tierRank(currentTier);

  const changeActionLabel =
    selectedTier == null || selectedTier === currentTier
      ? t('select_a_plan', 'Select a plan')
      : selectedRank > currentRank
        ? t('upgrade_now', 'Upgrade now')
        : t('downgrade_plan', 'Downgrade plan');

  const changeHint =
    selectedTier == null || selectedTier === currentTier
      ? ''
      : selectedRank > currentRank
        ? t(
            'upgrade_charge_hint',
            "You'll be charged the prorated difference today."
          )
        : t(
            'downgrade_date_hint',
            'Downgrade takes effect {{date}}.',
            { date: renewalDate || t('at_renewal', 'at renewal') }
          );

  return (
    <div className="flex flex-col gap-[24px]">
      {/* Current plan */}
      <div className="bg-newBgColorInner border border-newTableBorder rounded-[4px] p-[20px] flex flex-col gap-[16px]">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-[12px]">
          <div className="flex flex-col gap-[4px]">
            <div className="flex items-center gap-[8px]">
              <h3 className="text-[16px] font-semibold text-textColor">
                {t('current_plan', 'Current plan')}
              </h3>
              {user?.isTrailing && (
                <span className="text-[11px] font-medium px-[6px] py-[2px] rounded-full bg-btnPrimary/10 text-btnPrimary">
                  {t('trial', 'Trial')}
                </span>
              )}
            </div>
            <div className="text-[24px] font-semibold text-textColor">
              {currentTier} · ${price}
              <span className="text-[14px] text-newTableText font-normal">
                {period === 'YEARLY'
                  ? t('billing_slash_year', '/year')
                  : t('billing_slash_month', '/month')}
              </span>
            </div>
            {renewalDate && (
              <div className="text-[13px] text-newTableText">
                {subscription?.cancelAt
                  ? t('active_until_date', 'Active until {{date}}', { date: renewalDate })
                  : t('renews_on_date', 'Renews on {{date}}', { date: renewalDate })}
              </div>
            )}
            {subscription?.isLifetime && (
              <div className="text-[13px] text-btnPrimary">
                {t('lifetime_plan', 'Lifetime plan')}
              </div>
            )}
          </div>
          <Button
            loading={cancelLoading}
            secondary={!subscription?.cancelAt}
            danger={!subscription?.cancelAt}
            onClick={handleCancel}
          >
            {subscription?.cancelAt
              ? t('resume_subscription', 'Resume subscription')
              : t('cancel_subscription_1', 'Cancel subscription')}
          </Button>
        </div>

        {subscription?.pendingTier && (
          <div className="rounded-[4px] bg-amber-500/10 border border-amber-500/20 p-[12px] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-[12px]">
            <span className="text-[13px] text-textColor">
              {t(
                'pending_tier_banner',
                'Switches to {{tier}} on {{date}}.',
                {
                  tier: subscription.pendingTier,
                  date: renewalDate || t('at_renewal', 'at renewal'),
                }
              )}
            </span>
            <Button
              loading={changeLoading}
              secondary
              onClick={handleUndoPending}
            >
              {t('undo', 'Undo')}
            </Button>
          </div>
        )}
      </div>

      {/* Usage */}
      <div className="bg-newBgColorInner border border-newTableBorder rounded-[4px] p-[20px] flex flex-col gap-[16px]">
        <h3 className="text-[16px] font-semibold text-textColor">
          {t('usage', 'Usage')}
        </h3>
        {usageData && limits ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-[16px]">
            <UsageBar
              label={t('video_exports_label', 'Video exports')}
              used={usageData.videoExports}
              limit={limits.videoExports}
            />
            <UsageBar
              label={t('storage_gb_label', 'Storage')}
              used={bytesToGb(usageData.storageBytes)}
              limit={usage?.byoStorageActive ? 0 : limits.storageGb}
              unit="GB"
              unlimited={usage?.byoStorageActive}
            />
            <UsageBar
              label={t('channels', 'Channels')}
              used={usageData.channels}
              limit={typeof limits.channels === 'number' ? limits.channels : 0}
              unlimited={typeof limits.channels !== 'number'}
            />
            <UsageBar
              label={t('team_members', 'Team members')}
              used={usageData.teamMembers}
              limit={typeof limits.teamMembers === 'number' ? limits.teamMembers : 0}
              unlimited={typeof limits.teamMembers !== 'number'}
            />
          </div>
        ) : (
          <div className="text-[13px] text-newTableText">
            {t('usage_unavailable', 'Usage data unavailable')}
          </div>
        )}
      </div>

      {/* Change plan */}
      <div className="bg-newBgColorInner border border-newTableBorder rounded-[4px] p-[20px] flex flex-col gap-[16px]">
        <h3 className="text-[16px] font-semibold text-textColor">
          {t('change_plan', 'Change plan')}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[12px]">
          {TIER_ORDER.map((tier) => (
            <PlanCard
              key={tier}
              tier={tier}
              plan={pricing[tier]}
              period={period}
              isCurrent={tier === currentTier}
              isSelected={tier === selectedTier}
              onSelect={() => setSelectedTier(tier)}
            />
          ))}
        </div>
        {selectedTier && selectedTier !== currentTier && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-[12px]">
            <Button loading={changeLoading} onClick={handleChangePlan}>
              {changeActionLabel}
            </Button>
            <span className="text-[13px] text-newTableText">{changeHint}</span>
          </div>
        )}
      </div>

      {/* Add-ons */}
      <div className="bg-newBgColorInner border border-newTableBorder rounded-[4px] p-[20px] flex flex-col gap-[16px]">
        <h3 className="text-[16px] font-semibold text-textColor">
          {t('addons', 'Add-ons')}
        </h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-[16px]">
          <AddonControl
            title={t('extra_storage', 'Extra storage')}
            description={t(
              'extra_storage_description',
              '+{{gb}} GB per pack for ${{price}}/mo',
              { gb: ADDON_STORAGE_GB_PER_PACK, price: 19 }
            )}
            nudge={
              <div className="text-[12px] text-amber-600 mt-[8px]">
                {t(
                  'storage_addon_nudge',
                  'Storage add-ons are premium on purpose — connect your own storage bucket and get unlimited storage at no extra cost.'
                )}{' '}
                <Link
                  href="/settings/storage/providers"
                  className="underline hover:text-textColor"
                >
                  {t('connect_storage', 'Connect storage')}
                </Link>
              </div>
            }
            onBuy={(packs) => updateAddon('storage', packs)}
            onRemove={() => removeAddon('storage')}
            loading={addonLoading.storage}
          />
          <AddonControl
            title={t('extra_video_exports', 'Extra video exports')}
            description={t(
              'extra_video_exports_description',
              '+{{count}} exports per pack for ${{price}}/mo',
              { count: ADDON_VIDEO_EXPORTS_PER_PACK, price: 19 }
            )}
            onBuy={(packs) => updateAddon('video_exports', packs)}
            onRemove={() => removeAddon('video_exports')}
            loading={addonLoading.video_exports}
          />
        </div>
      </div>
    </div>
  );
};

const AddonControl: React.FC<{
  title: string;
  description: string;
  nudge?: React.ReactNode;
  onBuy: (packs: number) => void;
  onRemove: () => void;
  loading?: boolean;
}> = ({ title, description, nudge, onBuy, onRemove, loading }) => {
  const t = useT();
  const [packs, setPacks] = useState(1);

  return (
    <div className="border border-newTableBorder rounded-[4px] p-[16px] flex flex-col gap-[12px]">
      <div>
        <div className="text-[14px] font-semibold text-textColor">{title}</div>
        <div className="text-[13px] text-newTableText">{description}</div>
      </div>
      {nudge}
      <div className="flex items-center gap-[12px] pt-[4px]">
        <Stepper value={packs} onChange={setPacks} disabled={loading} />
        <Button loading={loading} onClick={() => onBuy(packs)}>
          {t('buy_update', 'Buy / Update')}
        </Button>
        <Button secondary loading={loading} onClick={onRemove}>
          {t('remove', 'Remove')}
        </Button>
      </div>
    </div>
  );
};
