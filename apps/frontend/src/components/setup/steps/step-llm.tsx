'use client';

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { StepFrame } from '@gitroom/frontend/components/setup/step-frame';
import { ProviderSettingsPanel } from '@gitroom/frontend/components/settings/shared/kit/provider-settings-panel';
import { aiDescriptor } from '@gitroom/frontend/components/settings/shared/kit/descriptors/ai.descriptor';
import { useProviderSurface } from '@gitroom/frontend/components/settings/shared/kit/use-provider-surface';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export function StepLlm({
  onProviderChange,
  onActiveChange,
}: {
  onProviderChange?: () => void;
  onActiveChange?: (active: boolean) => void;
}) {
  const t = useT();

  // Shares the SWR cache ('org-ai-config') with the panel below, so this sees the
  // provider the instant it is saved. The setup gate ("Next") requires an ACTIVE
  // provider, but the backend only auto-activates the org's very first row and swallows
  // any failure (isFirstProvider + best-effort setActive in OrgAiSettingsService.upsert).
  // When that heuristic misses, the provider is saved-but-inactive and Next stays disabled
  // with no obvious remedy. Deterministically activate a configured provider here so that
  // adding one always flips the gate — mirrors the panel's manual "Make Primary" condition.
  const surface = useProviderSurface(aiDescriptor);
  const { data, setPrimary, mutate } = surface;

  const rows = data?.rows ?? [];
  const hasActive = rows.some((r) => r.isConfigured && r.isPrimary);
  const target = useMemo(
    () => rows.find((r) => r.isConfigured && r.enabled && !r.isPrimary),
    [rows]
  );
  const targetId = hasActive ? undefined : target?.identifier;
  const targetVersion = target?.version;

  // One activation attempt per provider — if set-active rejects we don't hot-retry
  // (the panel's manual "Make Primary" remains as a fallback).
  const attemptedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!targetId || attemptedRef.current === targetId) return;
    attemptedRef.current = targetId;
    setPrimary(targetId, targetVersion).then(() => {
      mutate();
      onProviderChange?.();
    });
  }, [targetId, targetVersion, setPrimary, mutate, onProviderChange]);

  // Drive the wizard's "Next"/"Finish" gate from this uncached, authoritative surface
  // rather than the Redis-cached (60s) /dashboard/summary — otherwise the gate reflects
  // a stale `aiProviderActive:false` for up to a minute after the provider goes active.
  useEffect(() => {
    onActiveChange?.(hasActive);
  }, [hasActive, onActiveChange]);

  const handleChange = useCallback(() => {
    mutate();
    onProviderChange?.();
  }, [mutate, onProviderChange]);

  return (
    <StepFrame
      title={t('setup_llm_title', 'Connect an LLM provider')}
      subtitle={t(
        'setup_llm_subtitle',
        'Pick a Large Language Model provider to power AI features. This step is required before you can finish setup.'
      )}
    >
      <ProviderSettingsPanel
        descriptor={aiDescriptor}
        hideHeader
        onChange={handleChange}
      />
    </StepFrame>
  );
}
