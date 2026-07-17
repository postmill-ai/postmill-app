'use client';

import React, { FC, useCallback, useMemo, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import { useDashboardSummary } from './hooks/useDashboardSummary';
import { SectionCard } from './kit/section-card';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const DISMISS_KEY = 'onboarding_dismissed';
const DISMISS_EVENT = 'onboarding-dismiss-change';

const readDismissedRaw = () => {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
};

const parseDismissed = (raw: string | null) => raw === 'true';

const writeDismissed = (value: boolean) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(DISMISS_KEY, String(value));
    window.dispatchEvent(new CustomEvent(DISMISS_EVENT));
  } catch {
    /* ignore */
  }
};

const subscribeDismissed = (callback: () => void) => {
  if (typeof window === 'undefined') return () => {};
  const handler = () => callback();
  window.addEventListener(DISMISS_EVENT, handler);
  return () => window.removeEventListener(DISMISS_EVENT, handler);
};

export const DashboardSetup: FC = () => {
  const router = useRouter();
  const { data: integrations } = useIntegrationList();
  const { data: summary } = useDashboardSummary();
  const t = useT();
  const dismissedRaw = useSyncExternalStore(
    subscribeDismissed,
    readDismissedRaw,
    () => null
  );
  const dismissed = parseDismissed(dismissedRaw);

  const SETUP_STEPS = useMemo(
    () => [
      {
        key: 'ai',
        label: t('setup_step_ai_label', 'Connect an AI (LLM) Provider'),
        hint: 'OpenAI, Anthropic, DeepSeek',
        href: '/settings/ai/llm-providers',
      },
      {
        key: 'media',
        label: t('setup_step_media_label', 'Connect an AI Media Provider'),
        hint: 'OpenAI, Replicate, Luma',
        href: '/settings/content/ai-media',
      },
      {
        key: 'storage',
        label: t('setup_step_storage_label', 'Connect a Storage Provider'),
        hint: 'AWS S3, Cloudflare R2, Backblaze B2',
        href: '/settings/storage/providers',
      },
      {
        key: 'channel',
        label: t('setup_step_channel_label', 'Connect a Social Channel'),
        hint: 'Instagram, TikTok, YouTube',
        href: '/settings/channels',
      },
      {
        key: 'post',
        label: t('setup_step_post_label', 'Create your First Post'),
        hint: t('setup_step_post_hint', 'Craft, review, publish'),
        href: '/posts',
      },
      {
        key: 'team',
        label: t('setup_step_team_label', 'Invite a Team Member'),
        hint: t('setup_step_team_hint', 'Colleague, Contractor, Client'),
        href: '/settings/team',
      },
    ],
    [t]
  );

  const steps: Record<string, boolean> = useMemo(() => ({
    ai: summary?.aiProviderActive === true,
    media: summary?.mediaProviderActive === true,
    storage: summary?.storageProviderActive === true,
    channel: (integrations?.length || 0) > 0,
    post: (summary?.totalPosts || 0) > 0,
    team: (summary?.teamMembers || 0) > 1,
  }), [integrations, summary]);

  const completedCount = Object.values(steps).filter(Boolean).length;
  const allComplete = completedCount === SETUP_STEPS.length;

  const handleDismiss = useCallback(() => {
    writeDismissed(true);
  }, []);

  if (dismissed || allComplete) return null;

  return (
    <SectionCard id="setup" title={t('welcome_to_postmill', 'Welcome to Postmill')}>
      <div className="flex items-center justify-between mb-[16px]">
        <p className="text-[12px] text-newTableText">
          {t('lets_get_you_set_up', "Let's get you set up")}
        </p>
        <button onClick={handleDismiss} className="text-[12px] text-newTableText hover:text-textColor cursor-pointer" type="button">{t('dismiss', 'Dismiss')}</button>
      </div>

      <div className="mb-[16px]">
        <div className="flex justify-between text-[11px] text-newTableText mb-[4px]">
          <span>{t('setup_progress', 'Setup progress')}</span>
          <span>{completedCount}/{SETUP_STEPS.length}</span>
        </div>
        <div className="h-[6px] bg-newTableHeader rounded-full overflow-hidden">
          <div className="h-full bg-green-500 rounded-full transition-all duration-500" style={{ width: `${(completedCount / SETUP_STEPS.length) * 100}%` }} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-[8px]">
        {SETUP_STEPS.map((step, idx) => {
          const done = steps[step.key];
          return (
            <button
              key={step.key}
              type="button"
              onClick={() => !done && router.push(step.href)}
              className={clsx(
                'flex items-center gap-[10px] p-[10px] rounded-[8px] text-start',
                !done && 'hover:bg-boxHover cursor-pointer transition-colors',
                done && 'cursor-default'
              )}
            >
              <div className={clsx(
                'w-[20px] h-[20px] rounded-full flex items-center justify-center shrink-0 text-[10px] font-[600]',
                done ? 'bg-green-500 text-white' : 'border-2 border-newTableText text-newTableText'
              )}>
                {done ? (
                  <svg viewBox="0 0 15 15" fill="none" width="10" height="10">
                    <path d="M11.4669 3.72684C11.7558 3.91574 11.8369 4.30308 11.648 4.592L7.39799 11.092C7.29783 11.2452 7.13556 11.3467 6.95402 11.3699C6.77247 11.3931 6.58989 11.3355 6.45446 11.2124L3.20446 8.21243C2.94715 7.97215 2.93374 7.56924 3.17402 7.31193C3.4143 7.05462 3.81721 7.04122 4.07452 7.2815L6.69638 9.73846L10.352 3.90804C10.5409 3.61913 10.9282 3.53795 11.2171 3.72684C11.4669 3.88593 11.5532 4.17873 11.4669 3.72684Z" fill="white" fillRule="evenodd" clipRule="evenodd" />
                  </svg>
                ) : (
                  idx + 1
                )}
              </div>
              <div className="flex flex-col min-w-0">
                <span className={clsx('text-[12px]', done ? 'text-green-700 dark:text-green-400 line-through' : 'text-textColor')}>{step.label}</span>
                <span className="text-[10px] text-newTableText truncate">{step.hint}</span>
              </div>
            </button>
          );
        })}
      </div>
    </SectionCard>
  );
};
