'use client';

import React, { FC, useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useMediaDirectory } from '@postmill-ai/react/helpers/use.media.directory';
import { useModals } from '@postmill-ai/frontend/components/layout/new-modal';
import { Button } from '@postmill-ai/react/form/button';
import { MEDIA_SETUP_HREF } from '@postmill-ai/frontend/components/layout/use-media-tools-status';
import { useMediaPicker } from '@postmill-ai/frontend/components/media-tools/use-media-picker';
import { readErrorMessage } from '@postmill-ai/frontend/components/media-tools/designer/read-error-message';
import { parseJobError } from '@postmill-ai/frontend/components/ai/provider-error';
import { VoicePicker } from './voice-picker';
import { useHeygenStatus, useHeygenVoices, useHeygenJobs } from './use-heygen';
import type { CompactOperation, CompactStudioResult } from '../studio-kit/compact-registry';

// Compact, chrome-less embed of the HeyGen talking-photo flow for the
// Designer's avatar dialog: portrait picker, HeyGen voice picker and dimension
// — the dialog's script textarea drives inputText (no script box of its own).
// The finished clip is handed back through onGenerated.

const DIMENSIONS = [
  { key: '16:9', width: 1280, height: 720 },
  { key: '9:16', width: 720, height: 1280 },
  { key: '1:1', width: 1080, height: 1080 },
];

export const CompactHeyGen: FC<{
  operation: CompactOperation;
  prompt: string;
  onGenerated: (result: CompactStudioResult) => void;
  onError?: (message: string) => void;
}> = ({ prompt, onGenerated, onError }) => {
  const t = useT();
  const fetch = useFetch();
  const modal = useModals();
  const mediaDirectory = useMediaDirectory();

  const { data: status } = useHeygenStatus();
  const configured = !!status?.configured;
  const { data: voicesData } = useHeygenVoices(configured);
  const voices = voicesData?.voices ?? [];

  const [photo, setPhoto] = useState<{ fileId: string; previewUrl: string } | null>(null);
  const [voice, setVoice] = useState<{ voiceId: string; name: string } | null>(null);
  const [dimensionKey, setDimensionKey] = useState('9:16');
  const [starting, setStarting] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fail = useCallback(
    (message: string) => {
      setError(message);
      onError?.(message);
    },
    [onError]
  );

  const photoPicker = useMediaPicker({
    title: t('select_photo', 'Select photo'),
    kinds: ['image'],
    requireFile: true,
    onSelect: (item) => {
      if (!item.fileId) return;
      setPhoto({ fileId: item.fileId, previewUrl: mediaDirectory.set(item.url) });
    },
  });

  const { data: jobs, mutate: mutateJobs } = useHeygenJobs(configured && !!activeJobId);
  // onGenerated must fire exactly once per job, even while SWR keeps re-rendering.
  const handledJobRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeJobId || !jobs) return;
    const job = jobs.find((j) => j.id === activeJobId);
    if (!job || handledJobRef.current === job.id) return;
    if (job.status === 'completed' && job.artifactUrl) {
      handledJobRef.current = job.id;
      setActiveJobId(null);
      onGenerated({ operation: 'video', artifactUrl: job.artifactUrl, fileId: job.fileId ?? '' });
    } else if (job.status === 'failed') {
      handledJobRef.current = job.id;
      setActiveJobId(null);
      // Unwrap the structured failure envelope (see JobErrorText) so the
      // inline error never shows raw JSON.
      fail(parseJobError(job.error)?.message ?? job.error ?? t('generation_failed', 'Generation failed'));
    }
  }, [jobs, activeJobId, onGenerated, fail, t]);

  const canGenerate = !!photo && !!voice && !!prompt.trim();
  const busy = starting || !!activeJobId;

  const onGenerate = useCallback(async () => {
    if (!canGenerate) return;
    const dim = DIMENSIONS.find((d) => d.key === dimensionKey)!;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch('/media/heygen/talking-photo', {
        method: 'POST',
        body: JSON.stringify({
          fileId: photo!.fileId,
          voiceId: voice!.voiceId,
          inputText: prompt.trim(),
          dimension: { width: dim.width, height: dim.height },
        }),
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, t('heygen_failed_to_start_render', 'Failed to start the render')));
      }
      const { jobId } = (await res.json()) as { jobId: string };
      handledJobRef.current = null;
      setActiveJobId(jobId);
      mutateJobs();
    } catch (err) {
      fail((err as Error)?.message || t('heygen_failed_to_start_render', 'Failed to start the render'));
    } finally {
      setStarting(false);
    }
  }, [canGenerate, dimensionKey, photo, voice, prompt, fetch, mutateJobs, fail, t]);

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
          { title: 'HeyGen' }
        )}{' '}
        <a href={MEDIA_SETUP_HREF} className="text-btnPrimaryAccent underline">
          {t('studio_configure_provider', 'Configure {{title}}', { title: 'HeyGen' })}
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[12px]">
      <button
        type="button"
        onClick={photoPicker.open}
        className="flex items-center gap-[12px] p-[10px] rounded-[10px] border border-studioBorder hover:border-designerAccent transition-all text-left"
      >
        <div className="w-[48px] h-[48px] rounded-[8px] bg-newBgColorInner overflow-hidden flex items-center justify-center shrink-0">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- external provider asset
            <img src={photo.previewUrl} alt={t('heygen_selected', 'Selected')} className="w-full h-full object-cover" />
          ) : (
            <span className="text-newTextColor/60 text-[18px]">＋</span>
          )}
        </div>
        <div>
          <div className="text-[13px] text-textColor">
            {photo ? t('heygen_change_photo', 'Change photo') : t('heygen_pick_photo_from_files', 'Pick a photo from Files')}
          </div>
          <div className="text-[11px] text-newTextColor/60">
            {t('heygen_portrait_works_best', 'A clear, front-facing portrait works best')}
          </div>
        </div>
      </button>

      <button
        type="button"
        onClick={() =>
          modal.openModal({
            classNames: { modal: 'text-textColor' },
            children: (
              <VoicePicker
                voices={voices}
                selectedId={voice?.voiceId}
                onSelect={(v) => setVoice({ voiceId: v.voiceId, name: v.name })}
              />
            ),
          })
        }
        className="flex items-center justify-between gap-[8px] px-[12px] py-[10px] rounded-[10px] border border-studioBorder hover:border-designerAccent transition-all text-left"
      >
        <div>
          <div className="text-[13px] text-textColor">{voice?.name || t('heygen_pick_a_voice', 'Pick a voice')}</div>
          <div className="text-[11px] text-newTextColor/60">{t('heygen_voice_label', 'Voice')}</div>
        </div>
        <span className="text-newTextColor/60">🎙️</span>
      </button>

      <select
        aria-label={t('heygen_dimension_label', 'Dimension')}
        value={dimensionKey}
        onChange={(e) => setDimensionKey(e.target.value)}
        className="h-[36px] px-[10px] rounded-[8px] bg-newBgColorInner border border-studioBorder text-[13px] text-textColor outline-hidden focus:border-designerAccent w-fit"
      >
        <option value="16:9">{t('heygen_dimension_landscape_16_9', 'Landscape 16:9')}</option>
        <option value="9:16">{t('heygen_dimension_portrait_9_16', 'Portrait 9:16')}</option>
        <option value="1:1">{t('heygen_dimension_square_1_1', 'Square 1:1')}</option>
      </select>

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
        </div>
      )}

      {photoPicker.element}
    </div>
  );
};
