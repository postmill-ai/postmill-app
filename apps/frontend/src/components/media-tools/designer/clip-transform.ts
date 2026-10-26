import { JOB_MAX_POLLS, JOB_POLL_INTERVAL_MS } from './add-media-to-timeline';
import { isArtifactPath } from '@postmill-ai/frontend/components/launches/ai.video';
import { parseJobError } from '@postmill-ai/frontend/components/ai/provider-error';
import type { createDesignerStore, VideoOutput } from './designer.store';

type StoreApi = ReturnType<typeof createDesignerStore>;

/**
 * The two video background-removal models, keyed by the choice the UI offers
 * (Inspector section + timeline clip menu). `white` is lucataco/rembg-video
 * (general salient-object segmentation, best on white backgrounds); `green`
 * is arielreplicate/robust_video_matting (people matting, best on green
 * screens). Both must stay on the backend 'video-background' allowlist
 * (replicate-catalog.allowlist.ts) — the API 400s anything else. Omitting
 * `model` entirely is the "Auto" choice: the org's configured default wins.
 */
export const VIDEO_BG_REMOVAL_MODELS = {
  white: 'lucataco/rembg-video',
  green: 'arielreplicate/robust_video_matting',
} as const;

export interface ClipTransformTarget {
  outputIndex: number;
  trackId: string;
  clipId: string;
}

interface RunClipTransformOptions {
  store: StoreApi;
  target: ClipTransformTarget;
  endpoint: string;
  body: Record<string, unknown>;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  translate: (key: string, fallback: string, params?: Record<string, unknown>) => string;
  toaster: { show: (text: string, type?: 'success' | 'warning', href?: string, hrefLabel?: string) => void };
  /** Polling and toasts stop once the owning component unmounts. */
  isMounted?: () => boolean;
}

/**
 * POST a clip transform (upscale / remove background / video-to-video) and
 * swap the clip's src to the resulting artifact — synchronously when the API
 * returns a stored artifact path, otherwise by polling /media/jobs/:id.
 * Shared by the timeline clip context menu and the clip Inspector so both
 * entries run the exact same request/poll/land path. Failures toast
 * `error.message`; nothing throws to the caller.
 */
export async function runClipTransformRequest(options: RunClipTransformOptions): Promise<void> {
  const { store, target, endpoint, body, fetch, translate, toaster } = options;
  const isMounted = options.isMounted ?? (() => true);
  const state = store.getState();
  const vo = state.doc.outputs[target.outputIndex] as VideoOutput | undefined;
  const track = vo?.tracks?.find((t: { id: string }) => t.id === target.trackId);
  const clip = track?.clips.find((c: { id: string }) => c.id === target.clipId);
  if (!clip?.src) {
    toaster.show(translate('clip_has_no_source', 'Selected clip has no source'), 'warning');
    return;
  }
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(translate('transform_failed', 'Transform failed'));
    const { id } = await res.json();
    if (isArtifactPath(id)) {
      state.updateClipSilent(target.outputIndex, target.trackId, target.clipId, {
        src: id,
        fileId: undefined,
      });
      state.pushHistory();
    } else {
      let polls = 0;
      while (polls < JOB_MAX_POLLS) {
        if (!isMounted()) return; // owner unmounted — stop polling
        const jobRes = await fetch(`/media/jobs/${id}`);
        if (!jobRes.ok) throw new Error(translate('failed_to_check_transform_status', 'Failed to check transform status'));
        const job = await jobRes.json();
        if (job.status === 'completed') {
          if (!job.artifactUrl) throw new Error(translate('no_artifact', 'No artifact'));
          state.updateClipSilent(target.outputIndex, target.trackId, target.clipId, {
            src: job.artifactUrl,
            fileId: undefined,
          });
          state.pushHistory();
          break;
        }
        if (job.status === 'failed') throw new Error(parseJobError(job.error)?.message ?? job.error ?? translate('transform_failed', 'Transform failed'));
        polls++;
        await new Promise((r) => setTimeout(r, JOB_POLL_INTERVAL_MS));
      }
    }
  } catch (e) {
    if (isMounted()) toaster.show((e as Error).message || translate('transform_failed', 'Transform failed'), 'warning');
  }
}
