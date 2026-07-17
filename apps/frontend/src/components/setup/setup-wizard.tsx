'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR, { useSWRConfig } from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { usePermissions } from '@gitroom/frontend/components/layout/use-permissions';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Button } from '@gitroom/react/form/button';
import { SetupStepper } from '@gitroom/frontend/components/setup/setup-stepper';
import { StepLlm } from '@gitroom/frontend/components/setup/steps/step-llm';
import { StepAiMedia } from '@gitroom/frontend/components/setup/steps/step-ai-media';
import { StepChannels } from '@gitroom/frontend/components/setup/steps/step-channels';
import { StepContentPacks } from '@gitroom/frontend/components/setup/steps/step-content-packs';
import { StepStorage } from '@gitroom/frontend/components/setup/steps/step-storage';
import { StepShortlinks } from '@gitroom/frontend/components/setup/steps/step-shortlinks';
import { StepVpn } from '@gitroom/frontend/components/setup/steps/step-vpn';

// Only StepLlm consumes `onProviderChange` / `onActiveChange`; the others are no-arg
// components and remain assignable to this prop type (extra optional props are ignored).
const STEP_COMPONENTS: React.FC<{
  onProviderChange?: () => void;
  onActiveChange?: (active: boolean) => void;
}>[] = [
  StepLlm,
  StepAiMedia,
  StepChannels,
  StepContentPacks,
  StepStorage,
  StepShortlinks,
  StepVpn,
];

export function SetupWizard() {
  const t = useT();
  const fetch = useFetch();
  const router = useRouter();
  const { mutate: globalMutate } = useSWRConfig();

  // Setup configures org-level providers (owner/admin only). A member who lands here directly
  // can't complete the required LLM step (AI-config endpoints 403) — send them to the app
  // instead of a dead-end wizard. The layout gate already avoids force-redirecting members
  // here; this covers direct navigation / stale links.
  const permissions = usePermissions();
  const canCompleteSetup =
    permissions.isSuperAdmin || permissions.isOwner || permissions.isAdmin;
  useEffect(() => {
    if (permissions.isResolved && !canCompleteSetup) {
      router.replace('/dashboard');
    }
  }, [permissions.isResolved, canCompleteSetup, router]);

  // Restore the active step after an OAuth full-page round-trip (connecting a channel or an
  // OAuth short-link provider navigates the tab out to the provider and back; the gate then
  // returns the still-incomplete user to /setup, remounting this wizard). sessionStorage
  // survives same-tab navigation, so we resume on the step the user left instead of step 0.
  const [currentStep, setCurrentStep] = useState<number>(() => {
    if (typeof window === 'undefined') return 0;
    const saved = window.sessionStorage.getItem('setup:step');
    const n = saved ? parseInt(saved, 10) : 0;
    return Number.isInteger(n) && n >= 0 && n < STEP_COMPONENTS.length ? n : 0;
  });
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [skippedSteps, setSkippedSteps] = useState<Set<number>>(new Set());
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  // Live, uncached active-provider signal reported by StepLlm's own SWR surface — the
  // authoritative gate source (the /dashboard/summary read below is Redis-cached 60s).
  const [llmActive, setLlmActive] = useState(false);

  const steps = useMemo(
    () => [
      { id: 'llm', label: t('setup_step_llm', 'LLM'), required: true },
      { id: 'ai-media', label: t('setup_step_ai_media', 'AI Media') },
      { id: 'channels', label: t('setup_step_channels', 'Channels') },
      { id: 'content-packs', label: t('setup_step_content_packs', 'Content Packs') },
      { id: 'storage', label: t('setup_step_storage', 'Storage') },
      { id: 'shortlinks', label: t('setup_step_shortlinks', 'Shortlinks') },
      { id: 'vpn', label: t('setup_step_vpn', 'VPN') },
    ],
    [t]
  );

  // The LLM step's first provider auto-activates synchronously on save (§3.5).
  // Rather than poll (which hammers the throttled /dashboard/summary), we
  // revalidate this once whenever the step reports a provider change — see
  // `handleProviderChange` passed into the active step below.
  const { data: summary, mutate: mutateSummary } = useSWR(
    '/dashboard/summary',
    useCallback(async (url: string) => (await fetch(url)).json(), [fetch]),
    {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
    }
  );

  const handleProviderChange = useCallback(() => {
    mutateSummary();
  }, [mutateSummary]);

  // Persist the active step so it survives an OAuth round-trip / gate remount (see above).
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem('setup:step', String(currentStep));
    }
  }, [currentStep]);

  // Prefer the live surface signal; fall back to the (cached) summary so a returning user
  // resuming setup with an already-active provider still clears the gate on first mount.
  const aiProviderActive = llmActive || !!summary?.aiProviderActive;
  const isLastStep = currentStep === steps.length - 1;
  const canFinish = aiProviderActive;

  const handleNext = useCallback(() => {
    if (currentStep === 0 && !aiProviderActive) return;
    setCompletedSteps((prev) => new Set(prev).add(currentStep));
    setCurrentStep((s) => Math.min(s + 1, steps.length - 1));
  }, [currentStep, aiProviderActive, steps.length]);

  const handleSkip = useCallback(() => {
    if (currentStep === 0) return;
    setSkippedSteps((prev) => new Set(prev).add(currentStep));
    setCompletedSteps((prev) => new Set(prev).add(currentStep));
    setCurrentStep((s) => Math.min(s + 1, steps.length - 1));
  }, [currentStep, steps.length]);

  const handleBack = useCallback(() => {
    setCurrentStep((s) => Math.max(s - 1, 0));
  }, []);

  const handleStepClick = useCallback((index: number) => {
    setCurrentStep(index);
  }, []);

  const finishSetup = useCallback(async () => {
    if (!canFinish) return;
    setFinishing(true);
    setFinishError(null);
    try {
      const res = await fetch('/settings/setup/complete', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || t('setup_complete_failed', 'Could not complete setup'));
      }
      // CRITICAL: update the /user/self cache BEFORE navigating, otherwise the
      // LayoutComponent gate on /dashboard sees the stale setupCompleted:false
      // and bounces the user back to /setup.
      await globalMutate(
        '/user/self',
        (prev: any) => (prev ? { ...prev, setupCompleted: true } : prev),
        { revalidate: true }
      );
      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem('setup:step');
      }
      router.replace('/dashboard');
    } catch (err) {
      setFinishing(false);
      setFinishError(
        err instanceof Error ? err.message : t('setup_complete_failed', 'Could not complete setup')
      );
    }
  }, [canFinish, fetch, globalMutate, router, t]);

  const ActiveStepComponent = STEP_COMPONENTS[currentStep];

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-[24px] pt-[20px] pb-[16px] border-b border-newBorder">
        <h1 className="text-[22px] font-[700] text-btnPrimary">
          {t('setup_title', "Welcome — let's set up your workspace")}
        </h1>
        <p className="text-[13px] text-newTableText mt-[6px] max-w-[720px] leading-[1.5]">
          {t(
            'setup_intro',
            'A quick one-time setup to get Postmill ready. Only the'
          )}{' '}
          <span className="text-textColor font-[600]">
            {t('setup_step_llm', 'LLM')}
          </span>{' '}
          {t(
            'setup_intro_2',
            'step is required — connect an AI provider to continue. Everything else is optional: skip any step and change it later in Settings.'
          )}
        </p>
      </div>

      <SetupStepper
        steps={steps}
        currentStep={currentStep}
        completedSteps={completedSteps}
        skippedSteps={skippedSteps}
        onStepClick={handleStepClick}
      />

      <div className="flex-1 min-h-0 overflow-hidden">
        <ActiveStepComponent
          onProviderChange={handleProviderChange}
          onActiveChange={setLlmActive}
        />
      </div>

      {finishError && (
        <div className="shrink-0 px-[24px] py-[8px] bg-red-500/10 border-t border-red-500/20 text-red-500 text-[13px]">
          {finishError}
        </div>
      )}

      <div className="shrink-0 h-[64px] px-[24px] border-t border-newBorder flex items-center justify-between bg-primary">
        <Button
          type="button"
          onClick={handleBack}
          disabled={currentStep === 0}
          className="!bg-transparent border border-newTableBorder text-textColor"
        >
          {t('back', 'Back')}
        </Button>

        <div className="flex items-center gap-[12px]">
          {currentStep !== 0 && !isLastStep && (
            <Button
              type="button"
              onClick={handleSkip}
              className="!bg-transparent border border-newTableBorder text-textColor"
            >
              {t('skip', 'Skip')}
            </Button>
          )}

          {canFinish && (
            <Button
              type="button"
              onClick={finishSetup}
              disabled={finishing}
              className="bg-btnPrimary text-white"
            >
              {finishing
                ? t('finishing', 'Finishing...')
                : t('finish_setup', 'Finish setup')}
            </Button>
          )}

          {!isLastStep && (
            <Button
              type="button"
              onClick={handleNext}
              disabled={currentStep === 0 && !aiProviderActive}
              className="bg-btnPrimary text-white"
            >
              {t('next', 'Next')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
