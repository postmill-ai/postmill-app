'use client';

import React, { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { Button } from '@postmill-ai/react/form/button';
import { MEDIA_SETUP_HREF } from '@postmill-ai/frontend/components/layout/use-media-tools-status';
import { readErrorMessage } from '@postmill-ai/frontend/components/media-tools/designer/read-error-message';
import { useReplicateStore, type CategoryDefinition } from './replicate.store';
import { ModelPicker } from './model-picker';
import { DynamicForm } from './dynamic-form';
import { classifySchema, type InputSchema } from './field-classification';
import { missingRequiredFields } from './use-generate';
import type { CompactOperation, CompactStudioResult } from '../studio-kit/compact-registry';

// Compact, chrome-less embed of the Replicate studio for the Designer's
// generate dialogs: category (filtered to the dialog's medium), ModelPicker,
// DynamicForm and inline progress. The dialog's prompt box drives the schema's
// prompt field; the finished asset is handed back through onGenerated.

function useReplicateStatus() {
  const fetch = useFetch();
  return useSWR('replicate-status', async () => {
    const res = await fetch('/media/replicate/status');
    return (await res.json()) as { configured: boolean };
  });
}

function useReplicateCategories() {
  const fetch = useFetch();
  return useSWR('replicate-categories', async () => {
    const res = await fetch('/media/replicate/categories');
    return (await res.json()) as CategoryDefinition[];
  });
}

function useReplicateJobPoll(jobId: string | null) {
  const fetch = useFetch();
  return useSWR(
    jobId ? `replicate-job-${jobId}` : null,
    async () => {
      const res = await fetch(`/media/replicate/jobs/${jobId}`);
      return (await res.json()) as {
        status: string;
        result: { kind: string; urls: string[] } | null;
        error: string | null;
      };
    },
    { refreshInterval: 6000 }
  );
}

export const CompactReplicate: FC<{
  operation: CompactOperation;
  prompt: string;
  onGenerated: (result: CompactStudioResult) => void;
  onError?: (message: string) => void;
}> = ({ operation, prompt, onGenerated, onError }) => {
  const t = useT();
  const fetch = useFetch();
  const { data: status } = useReplicateStatus();
  const { data: categories } = useReplicateCategories();

  const selectedCategory = useReplicateStore((s) => s.selectedCategory);
  const selectedModel = useReplicateStore((s) => s.selectedModel);
  const formInput = useReplicateStore((s) => s.formInput);
  const setCategory = useReplicateStore((s) => s.setCategory);
  const updateFormField = useReplicateStore((s) => s.updateFormField);
  const resetStore = useReplicateStore((s) => s.reset);

  // The zustand store is a module-global singleton shared with the full-page
  // studio (ModelPicker / DynamicForm read it directly) — leave it clean on
  // the way out, mirroring the full studio, so no state bleeds across pages.
  useEffect(() => () => resetStore(), [resetStore]);

  const eligible = useMemo(
    () => (categories ?? []).filter((c) => c.medium === operation && c.execution !== 'local'),
    [categories, operation]
  );
  const categoryDef = eligible.find((c) => c.key === selectedCategory);

  const [starting, setStarting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fail = useCallback(
    (message: string) => {
      setError(message);
      onError?.(message);
    },
    [onError]
  );

  const schema = selectedModel?.inputSchema as InputSchema | null | undefined;

  // The dialog owns the prompt box: hide ALL prompt-role fields from the
  // DynamicForm (they're driven, not user-edited here), but inject the prop
  // value into the FIRST one in primary order only — a riffusion-style
  // `prompt_b` keeps its schema default.
  const promptFields = useMemo(
    () =>
      classifySchema(schema, new Set(['mask'])).primary.filter((f) => f.role === 'prompt'),
    [schema]
  );
  const primaryPromptField = promptFields[0]?.name;
  const hiddenFields = useMemo(() => new Set(promptFields.map((f) => f.name)), [promptFields]);
  useEffect(() => {
    if (primaryPromptField) updateFormField(primaryPromptField, prompt);
  }, [primaryPromptField, prompt, updateFormField]);

  const missing = useMemo(() => {
    const merged = { ...formInput };
    if (primaryPromptField) merged[primaryPromptField] = prompt;
    return selectedModel ? missingRequiredFields(schema, merged) : [];
  }, [selectedModel, schema, formInput, primaryPromptField, prompt]);

  // Async runs poll the shared job endpoint to completion.
  const { data: jobData } = useReplicateJobPoll(jobId);
  const handledJobRef = useRef<string | null>(null);
  useEffect(() => {
    if (!jobId) return;
    // Bound the poll: without it a wedged job spins the dialog forever. 20 min
    // is deliberate — the legacy path caps at 200×3s=10min, but seedance/veo
    // can legitimately take 10-15 min. On timeout the job may still finish
    // server-side (it already lands in Files when it does), so say so instead
    // of reporting a failure.
    const guard = window.setTimeout(() => {
      handledJobRef.current = jobId;
      setJobId(null);
      fail(
        t(
          'compact_replicate_generation_timeout',
          'Generation is taking longer than expected — the job may still finish. Check the media library or jobs list shortly.'
        )
      );
    }, 20 * 60 * 1000);
    return () => window.clearTimeout(guard);
  }, [jobId, fail, t]);
  useEffect(() => {
    if (!jobId || !jobData || handledJobRef.current === jobId) return;
    if (jobData.status === 'completed' && jobData.result?.urls?.[0]) {
      handledJobRef.current = jobId;
      setJobId(null);
      // Async runs already land in Files via the job lifecycle; the poll
      // payload carries the artifact URL but not the file id.
      onGenerated({ operation, artifactUrl: jobData.result.urls[0], fileId: '' });
    } else if (jobData.status === 'failed') {
      handledJobRef.current = jobId;
      setJobId(null);
      // The jobs endpoint carries the real failure reason — show it.
      fail(jobData.error || t('generation_failed', 'Generation failed'));
    }
  }, [jobData, jobId, operation, onGenerated, fail, t]);

  const onGenerate = useCallback(async () => {
    if (!selectedModel || !categoryDef) return;
    const input = { ...formInput };
    if (primaryPromptField) input[primaryPromptField] = prompt;
    const absent = missingRequiredFields(schema, input);
    if (absent.length > 0) {
      fail(
        t('missing_required_fields_note', 'Missing required fields: {{fields}}', {
          fields: absent.join(', '),
        })
      );
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const endpoint = categoryDef.execution === 'sync' ? '/run/sync' : '/run/async';
      const res = await fetch(`/media/replicate${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: selectedModel.id,
          versionId: selectedModel.versionId || undefined,
          input,
          operation,
          folderId: null,
        }),
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, t('generation_failed', 'Generation failed')));
      }
      const data = await res.json();
      if (data.status === 'succeeded') {
        const url = (data.urls || [])[0] as string | undefined;
        if (!url) throw new Error(t('generation_failed', 'Generation failed'));
        // Sync runs resolve to a transient provider URL — persist it to Files
        // before handing the asset to the dialog.
        const save = await fetch('/media/replicate/save-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, name: `replicate-${Date.now()}` }),
        });
        if (!save.ok) {
          throw new Error(await readErrorMessage(save, t('failed_to_save_to_files', 'Failed to save to Files')));
        }
        const saved = (await save.json()) as { id?: string; path?: string };
        onGenerated({ operation, artifactUrl: saved.path || url, fileId: saved.id || '' });
      } else if (data.jobId) {
        // Async (or a sync run that timed out server-side): poll to completion.
        setJobId(data.jobId);
      } else {
        throw new Error(data.error || t('generation_failed', 'Generation failed'));
      }
    } catch (err) {
      fail((err as Error)?.message || t('generation_failed', 'Generation failed'));
    } finally {
      setStarting(false);
    }
  }, [selectedModel, categoryDef, formInput, primaryPromptField, prompt, schema, fetch, operation, onGenerated, fail, t]);

  if (!status) {
    return (
      <div className="flex items-center justify-center py-6">
        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-designerAccent" />
      </div>
    );
  }

  if (!status.configured) {
    return (
      <div className="rounded-[8px] border border-studioBorder bg-newBgColor/40 p-[12px] text-[12px] text-newTextColor/70">
        {t(
          'compact_studio_not_configured',
          "{{title}} isn't configured — add your credentials to generate with it here.",
          { title: 'Replicate' }
        )}{' '}
        <a href={MEDIA_SETUP_HREF} className="text-btnPrimaryAccent underline">
          {t('studio_configure_provider', 'Configure {{title}}', { title: 'Replicate' })}
        </a>
      </div>
    );
  }

  const busy = starting || !!jobId;

  return (
    <div className="flex flex-col gap-[12px]">
      <div>
        <label
          htmlFor="compact-replicate-category"
          className="block text-xs uppercase tracking-wider text-newTextColor/70 mb-1.5"
        >
          {t('category_label', 'Category')}
        </label>
        <select
          id="compact-replicate-category"
          value={categoryDef?.key ?? ''}
          onChange={(e) => setCategory(e.target.value || null)}
          className="w-full px-3 py-2.5 rounded-lg border border-studioBorder bg-newBgColorInner text-textColor text-sm focus:outline-hidden focus:border-designerAccent"
        >
          <option value="">{t('select_a_tool', 'Select a tool…')}</option>
          {eligible.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      {categoryDef && <ModelPicker categoryKey={categoryDef.key} />}
      {categoryDef && selectedModel && <DynamicForm hiddenFields={hiddenFields} />}

      {selectedModel && !primaryPromptField && (
        <p className="text-[11px] text-amber-600">
          {t(
            'compact_replicate_no_prompt_field',
            'This model has no prompt field — the dialog prompt is ignored.'
          )}
        </p>
      )}

      {selectedModel && missing.length > 0 && (
        <p className="text-[11px] text-newTextColor/65">
          {t('required_fields_list', 'Required: {{fields}}', { fields: missing.join(', ') })}
        </p>
      )}

      <div className="flex items-center gap-[10px]">
        <Button
          onClick={onGenerate}
          disabled={!selectedModel || missing.length > 0}
          loading={busy}
          className="h-[36px] text-[13px]"
        >
          {busy ? t('generating_ellipsis', 'Generating…') : t('generate', 'Generate')}
        </Button>
        {jobId && (
          <span className="text-[11px] text-newTextColor/65">
            {t('compact_studio_in_progress', 'Rendering — this can take a few minutes.')}
          </span>
        )}
      </div>

      {error && (
        <div role="alert" className="text-[12px] text-dangerText">
          {error}
        </div>
      )}
    </div>
  );
};
