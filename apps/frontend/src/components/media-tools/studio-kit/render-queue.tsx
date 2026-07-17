'use client';

import React, { FC, useCallback } from 'react';
import { useMediaDirectory } from '@gitroom/react/helpers/use.media.directory';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import type { StudioJob } from './types';
import { openInDesigner } from '@gitroom/frontend/components/media-tools/open-in-designer';

// Status/operation display text is resolved at render via `t()` (data-module pattern):
// className stays here, the label is keyed off the stable status/operation id.
const STATUS_META: Record<StudioJob['status'], { labelKey: string; label: string; className: string }> = {
  pending: { labelKey: 'render_status_queued', label: 'Queued', className: 'text-amber-600 bg-amber-500/10' },
  processing: { labelKey: 'render_status_rendering', label: 'Rendering', className: 'text-amber-600 bg-amber-500/10' },
  completed: { labelKey: 'render_status_ready', label: 'Ready', className: 'text-green-500 bg-green-500/10' },
  failed: { labelKey: 'render_status_failed', label: 'Failed', className: 'text-red-700 dark:text-red-400 bg-red-500/10' },
};

const OPERATION_LABEL: Record<string, { labelKey: string; label: string }> = {
  video: { labelKey: 'render_op_video', label: 'Video' },
  avatar: { labelKey: 'render_op_video', label: 'Video' },
  image: { labelKey: 'render_op_image', label: 'Image' },
  audio: { labelKey: 'render_op_audio', label: 'Audio' },
  stt: { labelKey: 'render_op_transcript', label: 'Transcript' },
};

// Shared render-queue used by every studio. The three handoffs are baked in:
// Save (implicit — the job already landed in /files), Edit in Designer, Post to Composer.
export const RenderQueue: FC<{ jobs: StudioJob[] | undefined; isLoading: boolean }> = ({ jobs, isLoading }) => {
  const mediaDirectory = useMediaDirectory();
  const modal = useModals();
  const toaster = useToaster();
  const fetch = useFetch();
  const t = useT();

  const openComposer = useCallback(
    async (content: string, image: { id: string; path: string }[]) => {
      const integrationsRes = await fetch('/integrations');
      if (!integrationsRes.ok) {
        toaster.show(t('could_not_load_channels', 'Could not load channels'), 'warning');
        return;
      }
      const integrations = await integrationsRes.json();
      const { Composer } = await import('@gitroom/frontend/components/composer/composer');
      const dayjs = (await import('dayjs')).default;
      modal.openModal({
        fullScreen: true,
        removeLayout: true,
        children: (
          <Composer
            date={dayjs()}
            integrations={integrations}
            allIntegrations={integrations}
            onlyValues={[{ content, id: 'new', image }]}
            mutate={() => {}}
            reopenModal={() => {}}
          />
        ),
      });
    },
    [fetch, modal, toaster]
  );

  const post = useCallback(
    (job: StudioJob) => {
      if (!job.artifactUrl || !job.fileId) {
        toaster.show(t('render_not_ready_to_post', 'This render is not ready to post yet'), 'warning');
        return;
      }
      return openComposer('', [{ id: job.fileId, path: job.artifactUrl }]);
    },
    [openComposer, toaster]
  );

  // Transcript (stt) jobs carry text, not a previewable artifact — fetch the stored
  // text on demand for copy / insert-to-composer.
  const fetchTranscript = useCallback(
    async (job: StudioJob): Promise<string | null> => {
      if (!job.artifactUrl) return null;
      try {
        const res = await window.fetch(mediaDirectory.set(job.artifactUrl));
        if (!res.ok) return null;
        return await res.text();
      } catch {
        return null;
      }
    },
    [mediaDirectory]
  );

  const copyTranscript = useCallback(
    async (job: StudioJob) => {
      const text = await fetchTranscript(job);
      if (text == null) {
        toaster.show(t('could_not_load_transcript', 'Could not load transcript'), 'warning');
        return;
      }
      navigator.clipboard.writeText(text).then(
        () => toaster.show(t('transcript_copied', 'Transcript copied'), 'success'),
        () => toaster.show(t('copy_failed', 'Copy failed'), 'warning')
      );
    },
    [fetchTranscript, toaster]
  );

  const insertTranscript = useCallback(
    async (job: StudioJob) => {
      const text = await fetchTranscript(job);
      if (text == null) {
        toaster.show(t('could_not_load_transcript', 'Could not load transcript'), 'warning');
        return;
      }
      await openComposer(text, []);
    },
    [fetchTranscript, openComposer, toaster]
  );

  if (!isLoading && (!jobs || jobs.length === 0)) {
    return (
      <div className="text-[12px] text-newTextColor/60 px-[4px] py-[10px]">
        {t('studio_renders_appear_here', 'Your renders will appear here.')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[8px]">
      {(jobs || []).map((job) => {
        const meta = STATUS_META[job.status];
        const isStt = job.operation === 'stt';
        const isAudio = job.operation === 'audio';
        const isImage = job.operation === 'image';
        const previewUrl = job.artifactUrl ? mediaDirectory.set(job.artifactUrl) : null;
        return (
          <div key={job.id} className="rounded-[10px] border border-studioBorder bg-newBgColorInner overflow-hidden">
            {job.status === 'completed' && previewUrl && isImage && (
              // eslint-disable-next-line @next/next/no-img-element -- external media preview
              <img src={previewUrl} alt="" className="w-full aspect-video object-cover bg-black" />
            )}
            {job.status === 'completed' && previewUrl && !isStt && !isAudio && !isImage && (
              <video src={previewUrl} className="w-full aspect-video object-cover bg-black" controls preload="metadata" aria-label={t('generated_video_preview', 'Generated video preview')}>
                <track kind="captions" srcLang="en" label="English" />
              </video>
            )}
            {job.status === 'completed' && previewUrl && isAudio && (
              <audio src={previewUrl} className="w-full" controls preload="metadata" aria-label={t('generated_audio_preview', 'Generated audio preview')}>
                <track kind="captions" srcLang="en" label="English" />
              </audio>
            )}
            <div className="flex items-center justify-between gap-[8px] px-[10px] py-[8px]">
              <div className="min-w-0">
                <div className="text-[12px] text-textColor truncate">
                  {OPERATION_LABEL[job.operation]
                    ? t(OPERATION_LABEL[job.operation].labelKey, OPERATION_LABEL[job.operation].label)
                    : job.operation}
                </div>
                {job.status === 'failed' && job.error && (
                  <div className="text-[11px] text-red-600 dark:text-red-400 truncate" title={job.error}>{job.error}</div>
                )}
              </div>
              <span className={`shrink-0 text-[10px] font-[600] px-[7px] py-[3px] rounded-full ${meta.className}`}>
                {(job.status === 'pending' || job.status === 'processing') && (
                  <span className="inline-block w-[8px] h-[8px] mr-[5px] rounded-full bg-current animate-pulse align-middle" />
                )}
                {t(meta.labelKey, meta.label)}
              </span>
            </div>
            {job.status === 'completed' && isStt && (
              <div className="flex gap-[6px] px-[10px] pb-[10px]">
                <button
                  type="button"
                  onClick={() => copyTranscript(job)}
                  className="flex-1 px-[10px] py-[7px] rounded-[8px] bg-btnSimple text-textColor text-[12px] hover:bg-boxHover transition-all"
                >
                  {t('copy', 'Copy')}
                </button>
                <button
                  type="button"
                  onClick={() => insertTranscript(job)}
                  className="flex-1 px-[10px] py-[7px] rounded-[8px] bg-[#2B5CD3] text-white text-[12px] font-[500] hover:bg-[#2B5CD3]/80 transition-all"
                >
                  {t('to_composer', 'To composer')}
                </button>
              </div>
            )}
            {job.status === 'completed' && !isStt && (
              <div className="flex gap-[6px] px-[10px] pb-[10px]">
                <button
                  type="button"
                  onClick={() => openInDesigner(job)}
                  className="flex-1 px-[10px] py-[7px] rounded-[8px] bg-btnSimple text-textColor text-[12px] hover:bg-boxHover transition-all"
                >
                  {t('edit_in_designer', 'Edit in Designer')}
                </button>
                <button
                  type="button"
                  onClick={() => post(job)}
                  className="flex-1 px-[10px] py-[7px] rounded-[8px] bg-[#2B5CD3] text-white text-[12px] font-[500] hover:bg-[#2B5CD3]/80 transition-all"
                >
                  {t('post', 'Post')}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
