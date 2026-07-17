'use client';

import { useCallback } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useReplicateStore } from './replicate.store';

// Category → execution routing (mirrors the backend allowlist execution modes).
const SYNC_CATEGORIES = [
  'text-to-image',
  'image-to-image',
  'background-remove',
  'upscale',
  'inpaint',
  'stt',
];
const ASYNC_CATEGORIES = [
  'restore',
  'text-to-video',
  'image-to-video',
  'video-to-video',
  'video-upscale',
  'caption',
  'tts',
  'text-to-music',
  'music-to-music',
  'voice-clone',
];
const VIDEO_CATEGORIES = [
  'text-to-video',
  'image-to-video',
  'video-to-video',
  'video-upscale',
  'caption',
];

export const FOLDER_REQUIRED_CATEGORIES = [...ASYNC_CATEGORIES];

function fieldMissing(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    return !obj.fileId && !obj.url;
  }
  return false;
}

export function missingRequiredFields(
  schema: { required?: string[] } | null | undefined,
  input: Record<string, unknown>
): string[] {
  const required = schema?.required || [];
  return required.filter((field) => fieldMissing(input[field]));
}

/**
 * Centralised generate flow shared by the controls-column Generate button and the
 * hero-output Retry button. Sync runs resolve inline; async runs return a jobId the
 * result panel polls via `GET /media/replicate/jobs/:id`.
 */
export function useGenerate() {
  const fetch = useFetch();
  const t = useT();

  return useCallback(async () => {
    const store = useReplicateStore.getState();
    const model = store.selectedModel;
    const category = store.selectedCategory;
    if (!model || !category) return;

    const inputSchema = model.inputSchema as { required?: string[] } | undefined;
    const missing = missingRequiredFields(inputSchema, store.formInput);
    if (missing.length > 0) {
      store.setError(
        t('missing_required_fields_note', 'Missing required fields: {{fields}}', {
          fields: missing.join(', '),
        })
      );
      store.setRunState('error');
      return;
    }

    store.setRunState('running');
    store.setError(null);
    store.setResult(null);
    store.setResultMeta({ modelName: model.name, input: { ...store.formInput } });

    try {
      let endpoint: string;
      let operation: string;

      if (SYNC_CATEGORIES.includes(category)) {
        endpoint = '/run/sync';
        operation = category === 'stt' ? 'stt' : 'image';
      } else if (ASYNC_CATEGORIES.includes(category)) {
        endpoint = '/run/async';
        operation = category === 'restore'
          ? 'image'
          : VIDEO_CATEGORIES.includes(category)
            ? 'video'
            : 'audio';
      } else {
        throw new Error(t('unknown_category', 'Unknown category'));
      }

      const res = await fetch(`/media/replicate${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: model.id,
          versionId: model.versionId || undefined,
          input: store.formInput,
          operation,
          folderId: store.saveFolderId,
        }),
      });

      const data = await res.json();

      if (data.status === 'succeeded') {
        store.setResult(data);
        store.setRunState('success');
        store.addToHistory({ jobId: data.jobId || '', modelId: model.id });
      } else if (data.jobId) {
        // Async or sync-timed-out: keep running, the result panel polls the job.
        store.setResult({ kind: operation as 'image' | 'video' | 'audio', urls: [], jobId: data.jobId });
        store.addToHistory({ jobId: data.jobId, modelId: model.id });
      } else {
        throw new Error(data.error || t('generation_failed', 'Generation failed'));
      }
    } catch (err: any) {
      store.setError(err?.message || t('generation_failed', 'Generation failed'));
      store.setRunState('error');
    }
  }, [fetch, t]);
}
