'use client';

import React, { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { Button } from '@postmill-ai/react/form/button';
import { OverflowTabs } from '@postmill-ai/frontend/components/ui/overflow-tabs';
import { MEDIA_SETUP_HREF } from '@postmill-ai/frontend/components/layout/use-media-tools-status';
import { parseJobError, providerErrorToastText, type ProviderError } from '@postmill-ai/frontend/components/ai/provider-error';
import { StudioForm } from './studio-form';
import { useStudioStatus, useStudioJobs, useStudioGenerate } from './hooks';
import { studioTabKey } from './i18n-keys';
import { buildBody, defaultsFor, isFilled, validateStudioValues } from './studio-form-utils';
import {
  COMPACT_STUDIO_REGISTRY,
  type CompactOperation,
  type CompactStudioEntry,
  type CompactStudioResult,
} from './compact-registry';
import { CompactReplicate } from '../replicate/compact-replicate';
import { CompactHeyGen } from '../heygen/compact-heygen';
import { UtcToLocalDateRender } from '@postmill-ai/react/helpers/utc.date.render';
import type { StudioFieldValue, StudioJob } from './types';

export type { CompactStudioResult };

export interface CompactStudioProps {
  provider: string;
  operation: CompactOperation;
  // The hosting dialog owns the prompt box; its value is injected into the
  // descriptor's `prompt`-type field at generate time.
  prompt: string;
  // Hosting canvas's aspect ratio (e.g. '16:9') — descriptor studios ignore
  // it; CompactReplicate seeds it into a schema `aspect_ratio` field.
  aspectRatio?: string;
  onGenerated: (result: CompactStudioResult) => void;
  onError?: (message: string) => void;
}

// Chrome-less, embeddable variant of a provider studio: no header, tab bar
// chrome, render queue or fullscreen — just the descriptor fields for the
// requested operation, a Generate button and inline progress. The dialog's
// prompt drives the descriptor's prompt field; the finished asset is handed
// back through onGenerated.
export const CompactStudio: FC<CompactStudioProps> = (props) => {
  // Distinct component types — React remounts when the picker switches between
  // a bespoke embed and a descriptor studio (keeps hook order safe).
  if (props.provider === 'replicate') {
    return (
      <CompactReplicate
        operation={props.operation}
        prompt={props.prompt}
        aspectRatio={props.aspectRatio}
        onGenerated={props.onGenerated}
        onError={props.onError}
      />
    );
  }
  if (props.provider === 'heygen') {
    return (
      <CompactHeyGen
        operation={props.operation}
        prompt={props.prompt}
        onGenerated={props.onGenerated}
        onError={props.onError}
      />
    );
  }
  return <DescriptorCompactStudio {...props} />;
};

const DescriptorCompactStudio: FC<CompactStudioProps> = ({
  provider,
  operation,
  prompt,
  onGenerated,
  onError,
}) => {
  const t = useT();
  const entry: CompactStudioEntry | undefined = COMPACT_STUDIO_REGISTRY[provider];
  const { data: status } = useStudioStatus(provider);
  const configured = !!status?.configured;

  // Only tabs for the dialog's operation, and never `custom` panels (bespoke
  // structured tools are not embeddable).
  const eligible = useMemo(
    () => (entry?.tabs ?? []).filter(({ tab }) => !tab.custom && tab.operation === operation),
    [entry, operation]
  );

  const [tabKey, setTabKey] = useState<string | undefined>(undefined);
  const active = eligible.find((ct) => ct.key === tabKey) ?? eligible[0];

  const [valuesByTab, setValuesByTab] = useState<Record<string, Record<string, StudioFieldValue>>>({});
  const values = useMemo(
    () => (active ? valuesByTab[active.key] ?? defaultsFor(active.tab) : {}),
    [active, valuesByTab]
  );
  const setValue = useCallback(
    (name: string, value: StudioFieldValue) => {
      if (!active) return;
      setValuesByTab((prev) => ({
        ...prev,
        [active.key]: { ...(prev[active.key] ?? defaultsFor(active.tab)), [name]: value },
      }));
    },
    [active]
  );

  const generate = useStudioGenerate(provider);
  const [starting, setStarting] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [resumedJob, setResumedJob] = useState<StudioJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorSettingsUrl, setErrorSettingsUrl] = useState<string | null>(null);
  // True once the mount-time adoption check has run (see below) — jobs polling
  // stays enabled until then so a refreshed page can find its in-flight job.
  const [adoptChecked, setAdoptChecked] = useState(false);
  const { data: jobs, mutate: mutateJobs } = useStudioJobs(
    provider,
    configured && (!!activeJobId || !adoptChecked)
  );
  // onGenerated must fire exactly once per job, even while SWR keeps re-rendering.
  const handledJobRef = useRef<string | null>(null);
  const fail = useCallback(
    (message: string, settingsUrl?: string) => {
      setError(message);
      setErrorSettingsUrl(settingsUrl ?? null);
      onError?.(message);
    },
    [onError]
  );

  // A refresh mid-render used to strand the job: activeJobId lived only in
  // this component's state, so the embed never re-attached and the finished
  // artifact silently landed in Files. On mount, adopt any still-running job
  // for this provider (jobs arrive most-recent-first) and let the effect
  // below drive it to completion.
  useEffect(() => {
    if (adoptChecked || activeJobId || !jobs || !Array.isArray(jobs)) return;
    setAdoptChecked(true);
    const running = jobs.find((j) => j.status === 'pending' || j.status === 'processing');
    if (running) {
      const model =
        running.model ??
        active?.tab.model ??
        (typeof values.model === 'string' ? values.model : undefined);
      setResumedJob({ ...running, model });
      setActiveJobId(running.id);
    }
  }, [adoptChecked, activeJobId, jobs, active, values]);

  useEffect(() => {
    if (!activeJobId || !jobs) return;
    const job = jobs.find((j) => j.id === activeJobId);
    if (!job || handledJobRef.current === job.id) return;
    if (job.status === 'completed' && job.artifactUrl) {
      handledJobRef.current = job.id;
      setActiveJobId(null);
      setResumedJob(null);
      onGenerated({
        operation: (job.operation as CompactOperation) || operation,
        artifactUrl: job.artifactUrl,
        fileId: job.fileId ?? '',
        fileType: job.fileType,
        metadata: job.metadata,
      });
    } else if (job.status === 'failed') {
      handledJobRef.current = job.id;
      setActiveJobId(null);
      setResumedJob(null);
      // Poll-path failures can carry the structured envelope (message +
      // settingsUrl) — unwrap it so the settings link renders (B7).
      const envelope = parseJobError(job.error);
      fail(
        envelope?.message ?? job.error ?? t('generation_failed', 'Generation failed'),
        envelope?.settingsUrl
      );
    }
  }, [jobs, activeJobId, onGenerated, operation, fail, t]);

  const promptField = active?.tab.fields.find((f) => f.type === 'prompt');

  const validationError = useMemo(
    () => (active ? validateStudioValues(provider, active.tab, values) : null),
    [active, provider, values]
  );
  const canGenerate = useMemo(() => {
    if (!active || validationError) return false;
    return active.tab.fields
      .filter((f) => f.required)
      .every((f) => (f.type === 'prompt' ? !!prompt.trim() : isFilled(values[f.name])));
  }, [active, values, prompt, validationError]);

  const onGenerate = useCallback(async () => {
    if (!active || !canGenerate) return;
    setStarting(true);
    setError(null);
    setResumedJob(null);
    try {
      const body = buildBody(active.tab, values);
      // The dialog's prompt box owns the prompt — inject it into the submitted
      // input under the descriptor's prompt field name (filtered out of the
      // rendered form above).
      if (promptField) body.input[promptField.name] = prompt.trim();
      // An idempotency-duplicate response now carries the ORIGINAL job's id
      // too, so either way there is a job to track (previously undefined).
      const { jobId } = await generate(body);
      handledJobRef.current = null;
      setActiveJobId(jobId ?? null);
      mutateJobs();
    } catch (err) {
      const providerError = (err as { providerError?: ProviderError }).providerError;
      fail(
        providerError
          ? providerErrorToastText(t, providerError)
          : (err as Error).message || t('studio_render_start_failed', 'Failed to start the render'),
        providerError?.settingsUrl
      );
    } finally {
      setStarting(false);
    }
  }, [active, canGenerate, values, promptField, prompt, generate, mutateJobs, fail, t]);

  if (!entry) return null;

  if (!status) {
    return (
      <div className="flex items-center justify-center py-6">
        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-designerAccent" />
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="rounded-[8px] border border-studioBorder bg-newBgColor/40 p-[12px] text-[12px] text-newTextColor/70">
        {t(
          'compact_studio_not_configured',
          "{{title}} isn't configured — add your credentials to generate with it here.",
          { title: entry.title }
        )}{' '}
        <a href={MEDIA_SETUP_HREF} className="text-btnPrimaryAccent underline">
          {t('studio_configure_provider', 'Configure {{title}}', { title: entry.title })}
        </a>
      </div>
    );
  }

  if (!active) {
    return (
      <div className="text-[12px] text-newTextColor/60 py-2">
        {t('compact_studio_no_tool', '{{title}} has no embeddable tool for this generation type.', {
          title: entry.title,
        })}
      </div>
    );
  }

  const busy = starting || !!activeJobId;
  const renderedFields = active.tab.fields.filter((f) => f.type !== 'prompt');

  return (
    <div className="flex flex-col gap-[12px]">
      {eligible.length > 1 && (
        <OverflowTabs
          items={eligible.map((ct) => ({
            key: ct.key,
            label: t(studioTabKey(ct.ns, ct.tab.key), ct.tab.label),
          }))}
          activeKey={active.key}
          onSelect={setTabKey}
          variant="outline"
          semantics="tabs"
          ariaLabel={t('more_tools', 'More tools')}
          listAriaLabel={entry.title}
        />
      )}

      <StudioForm
        fields={renderedFields}
        values={values}
        onChange={setValue}
        provider={provider}
        operation={operation}
        keyNs={active.ns}
        tabKey={active.tab.key}
      />

      {resumedJob && activeJobId === resumedJob.id && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-[8px] gap-y-[2px] rounded-[8px] border border-studioBorder bg-newBgColor/40 px-[10px] py-[7px] text-[11px] text-newTextColor/70"
        >
          <span className="font-[600] text-textColor">
            {t('compact_studio_resumed', 'Resumed')}
          </span>
          {resumedJob.model && (
            <span>
              {t('compact_studio_resumed_model', 'Model: {{model}}', {
                model: resumedJob.model,
              })}
            </span>
          )}
          <span>
            {t('compact_studio_resumed_created', 'Created')}{' '}
            <time dateTime={resumedJob.createdAt}>
              <UtcToLocalDateRender date={resumedJob.createdAt} format="YYYY-MM-DD HH:mm" />
            </time>
          </span>
        </div>
      )}

      {validationError && (
        <div role="alert" className="text-[12px] text-dangerText">
          {t('studio_invalid_input', 'Check inputs: {{message}}', { message: validationError })}
        </div>
      )}

      <div className="flex items-center gap-[10px]">
        <Button onClick={onGenerate} disabled={!canGenerate} loading={busy} className="h-[36px] text-[13px]">
          {busy ? t('generating_ellipsis', 'Generating…') : t('generate', 'Generate')}
        </Button>
        {activeJobId && (
          <span className="text-[11px] text-newTextColor/65">
            {t('compact_studio_in_progress', 'Rendering — this can take a few minutes.')}
          </span>
        )}
      </div>

      {error && (
        <div role="alert" className="text-[12px] text-dangerText">
          {error}
          {errorSettingsUrl && (
            <>
              {' '}
              <Link href={errorSettingsUrl} className="underline">
                {t('provider_error_open_settings', 'Open settings')}
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
};
