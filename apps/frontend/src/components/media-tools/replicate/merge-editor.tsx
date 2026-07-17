'use client';

import React, { FC, useState, useCallback, useEffect } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { MediaSelectorModal } from '@gitroom/frontend/components/media-tools/media-selector-modal';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useReplicateStore } from './replicate.store';
import { VideoPlayer } from './players/video-player';
import { EditorShell, toolbarBtn, toolbarPrimary } from './editor-shell';

interface MergeClip {
  url?: string;
  fileId?: string;
  trimStart?: number;
  trimEnd?: number;
}

interface MergeTransition {
  type: string;
  duration: number;
}

// Data-module option list — labelKey is translated at render (module scope, no hook access here).
const TRANSITION_OPTIONS = [
  { value: 'fade', label: 'Fade', labelKey: 'transition_fade' },
  { value: 'dissolve', label: 'Dissolve', labelKey: 'transition_dissolve' },
  { value: 'xfade-wipe', label: 'Wipe Right', labelKey: 'transition_wipe_right' },
  { value: 'pixelize', label: 'Pixelize', labelKey: 'transition_pixelize' },
  { value: 'radial', label: 'Radial', labelKey: 'transition_radial' },
  { value: 'fadegrayscale', label: 'Fade Grayscale', labelKey: 'transition_fade_grayscale' },
];

const fieldLabel = 'text-[10px] uppercase tracking-wider text-newTextColor/65';
const fieldInput =
  'w-full px-2 py-1 rounded border border-studioBorder bg-newBgColor text-textColor text-xs focus:outline-none focus:border-designerAccent';

type MergeJobData = { status: string; result: { kind: string; urls: string[] } | null };

function useJobPoll(jobId: string | null) {
  const fetch = useFetch();
  return useSWR(
    jobId ? `merge-job-${jobId}` : null,
    async () => {
      const res = await fetch(`/media/replicate/jobs/${jobId}`);
      return (await res.json()) as MergeJobData;
    },
    {
      // Stop polling once the job reaches a terminal state — the previous
      // unconditional interval polled forever while the editor stayed mounted.
      refreshInterval: (data) =>
        data && (data.status === 'completed' || data.status === 'failed') ? 0 : 6000,
    }
  );
}

// Modal replacement for the native `prompt()` (which the app forbids); lets the user
// paste an external https clip URL with inline validation.
const UrlClipModal: FC<{ onClose: () => void; onSubmit: (url: string) => void }> = ({
  onClose,
  onSubmit,
}) => {
  const t = useT();
  const [url, setUrl] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const submit = () => {
    const trimmed = url.trim();
    if (!trimmed.startsWith('https://')) {
      setErr(t('external_clip_url_https_required', 'External clip URL must start with https://'));
      return;
    }
    onSubmit(trimmed);
  };
  return (
    <div className="p-4 w-[420px] max-w-full flex flex-col gap-3">
      <input
        value={url}
        onChange={(e) => {
          setUrl(e.target.value);
          setErr(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
        placeholder="https://example.com/clip.mp4"
        className={fieldInput}
      />
      {err && <p className="text-xs text-dangerText">{err}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={toolbarBtn}>
          {t('cancel', 'Cancel')}
        </button>
        <button type="button" onClick={submit} className={toolbarPrimary}>
          {t('add_clip', 'Add clip')}
        </button>
      </div>
    </div>
  );
};

export function MergeEditor() {
  const t = useT();
  const fetch = useFetch();
  const modals = useModals();
  const toaster = useToaster();
  const saveFolderId = useReplicateStore((s) => s.saveFolderId);
  const [clips, setClips] = useState<MergeClip[]>([]);
  const [transitions, setTransitions] = useState<MergeTransition[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: jobData } = useJobPoll(jobId);
  const status = jobData?.status;
  const isComplete = status === 'completed';

  // Terminal state resolution: reset `running` (so Merge re-enables) and surface a
  // failure. Previously only the throw path reset `running`, so success left Merge
  // disabled and failure spun forever.
  useEffect(() => {
    if (status === 'completed' || status === 'failed') {
      setRunning(false);
      if (status === 'failed') setError(t('merge_failed_retry', 'Merge failed. Please try again.'));
    }
  }, [status, t]);

  // A transition sits between two clips: N clips ⇒ N-1 transitions. Append one only
  // when this is not the first clip. Kept OUT of the setClips updater so StrictMode's
  // double-invoke of the pure updater can't append a duplicate transition.
  const appendTransitionIfNeeded = useCallback(() => {
    if (clips.length > 0) {
      setTransitions((t) => [...t, { type: 'fade', duration: 0.5 }]);
    }
  }, [clips.length]);

  const addFileClip = useCallback(() => {
    if (clips.length >= 6) return;
    modals.openModal({
      title: t('select_video_clip', 'Select video clip'),
      removeLayout: true,
      children: (close) => (
        <MediaSelectorModal
          open
          onClose={close}
          kinds={['video']}
          onSelect={(item) => {
            if (item.type !== 'video') {
              toaster.show(t('please_choose_video_clip', 'Please choose a video clip'), 'warning');
              return;
            }
            setClips((prev) => (prev.length >= 6 ? prev : [...prev, { fileId: item.fileId }]));
            appendTransitionIfNeeded();
            close();
          }}
        />
      ),
    });
  }, [clips.length, modals, toaster, appendTransitionIfNeeded, t]);

  const addUrlClip = useCallback(() => {
    if (clips.length >= 6) return;
    modals.openModal({
      title: t('add_external_clip_url', 'Add external clip URL'),
      children: (close) => (
        <UrlClipModal
          onClose={close}
          onSubmit={(url) => {
            setClips((prev) => (prev.length >= 6 ? prev : [...prev, { url }]));
            appendTransitionIfNeeded();
            close();
          }}
        />
      ),
    });
  }, [clips.length, modals, appendTransitionIfNeeded, t]);

  const removeClip = useCallback((index: number) => {
    setClips((prev) => prev.filter((_, i) => i !== index));
    // Drop the transition adjacent to the removed clip: the one before it when the
    // last clip is removed, otherwise the one after it (clamped into range).
    setTransitions((prev) => {
      if (prev.length === 0) return prev;
      const tIdx = Math.min(index, prev.length - 1);
      return prev.filter((_, i) => i !== tIdx);
    });
    // Reindex the selection: cleared if it was the removed clip, shifted down if it
    // sat after it.
    setSelected((cur) => {
      if (cur === null || cur === index) return null;
      return cur > index ? cur - 1 : cur;
    });
  }, []);

  const updateClip = useCallback((index: number, patch: Partial<MergeClip>) => {
    setClips((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }, []);

  const updateTransition = useCallback((index: number, field: string, value: unknown) => {
    setTransitions((prev) => prev.map((t, i) => (i === index ? { ...t, [field]: value } : t)));
  }, []);

  const handleMerge = useCallback(async () => {
    if (clips.length === 0 || !saveFolderId) return;
    setRunning(true);
    setError(null);
    try {
      const res = await fetch('/media/replicate/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clips, transitions, folderId: saveFolderId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || t('merge_failed', 'Merge failed'));
      setJobId(data.jobId);
    } catch (err: any) {
      setError(err.message);
      setRunning(false);
    }
  }, [clips, transitions, fetch, saveFolderId, t]);

  const openInFiles = useCallback(() => {
    const target = saveFolderId ? `/files?folderId=${encodeURIComponent(saveFolderId)}` : '/files';
    window.open(target, '_blank');
  }, [saveFolderId]);

  const selectedClip = selected !== null ? clips[selected] : null;

  const toolbar = (
    <>
      <button onClick={addFileClip} disabled={clips.length >= 6} className={toolbarBtn}>
        {t('plus_files_count', '+ Files ({{count}}/6)', { count: clips.length })}
      </button>
      <button onClick={addUrlClip} disabled={clips.length >= 6} className={toolbarBtn}>
        {t('plus_url', '+ URL')}
      </button>
      <button
        onClick={handleMerge}
        disabled={clips.length === 0 || running || !saveFolderId}
        className={toolbarPrimary}
      >
        {running && !isComplete ? t('merging_ellipsis', 'Merging…') : t('merge', 'Merge')}
      </button>
    </>
  );

  const inspector = (
    <div className="p-4 space-y-4">
      {!saveFolderId && (
        <p className="text-xs text-amber-600">
          {t('pick_save_folder_before_merging', 'Pick a save folder (header) before merging.')}
        </p>
      )}
      {selectedClip ? (
        <div className="space-y-3">
          <div className={fieldLabel}>{t('clip_number', 'Clip {{number}}', { number: selected! + 1 })}</div>
          <p className="text-[11px] text-newTextColor/60 truncate">{selectedClip.url || selectedClip.fileId}</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className={fieldLabel}>{t('trim_start_s', 'Trim start (s)')}</div>
              <input
                type="number"
                value={selectedClip.trimStart ?? ''}
                onChange={(e) =>
                  updateClip(selected!, { trimStart: e.target.value ? Number(e.target.value) : undefined })
                }
                placeholder="0"
                className={fieldInput}
              />
            </div>
            <div>
              <div className={fieldLabel}>{t('trim_end_s', 'Trim end (s)')}</div>
              <input
                type="number"
                value={selectedClip.trimEnd ?? ''}
                onChange={(e) =>
                  updateClip(selected!, { trimEnd: e.target.value ? Number(e.target.value) : undefined })
                }
                placeholder={t('end_placeholder', 'end')}
                className={fieldInput}
              />
            </div>
          </div>
          {selected! < clips.length - 1 && transitions[selected!] && (
            <div className="border-t border-studioBorder pt-3 space-y-2">
              <div className={fieldLabel}>{t('transition_to_next_clip', 'Transition → next clip')}</div>
              <select
                value={transitions[selected!].type}
                onChange={(e) => updateTransition(selected!, 'type', e.target.value)}
                className={fieldInput}
              >
                {TRANSITION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {t(opt.labelKey, opt.label)}
                  </option>
                ))}
              </select>
              <div>
                <div className={fieldLabel}>{t('duration_s', 'Duration (s)')}</div>
                <input
                  type="number"
                  min={0.1}
                  max={5}
                  step={0.1}
                  value={transitions[selected!].duration}
                  onChange={(e) => updateTransition(selected!, 'duration', Number(e.target.value))}
                  className={fieldInput}
                />
              </div>
            </div>
          )}
          <button onClick={() => removeClip(selected!)} className="text-xs text-dangerText hover:text-red-300">
            {t('remove_clip', 'Remove clip')}
          </button>
        </div>
      ) : (
        <p className="text-xs text-newTextColor/65">
          {t('select_clip_to_trim', 'Select a clip in the strip to trim it or set its transition.')}
        </p>
      )}
      {error && <p className="text-xs text-dangerText">{error}</p>}
    </div>
  );

  return (
    <EditorShell
      title={t('merge_videos_title', 'Merge Videos')}
      toolbar={toolbar}
      inspector={inspector}
      stageClassName="!items-stretch !justify-start flex-col"
    >
      {clips.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-newTextColor/65 text-sm">
          {t('add_up_to_6_clips', 'Add up to 6 video clips to merge them with transitions.')}
        </div>
      ) : (
        <div className="w-full">
          {/* Filmstrip */}
          <div className="flex items-stretch gap-1 overflow-x-auto pb-4">
            {clips.map((clip, idx) => (
              <React.Fragment key={idx}>
                <button
                  onClick={() => setSelected(idx)}
                  className={`flex-shrink-0 w-40 h-24 rounded-lg border flex flex-col items-center justify-center gap-1 transition-colors ${
                    selected === idx
                      ? 'border-designerAccent bg-designerAccent/15 text-textColor'
                      : 'border-studioBorder bg-newBgColorInner text-newTextColor/70 hover:bg-boxHover'
                  }`}
                >
                  <span className="text-2xl">🎬</span>
                  <span className="text-xs">{t('clip_number', 'Clip {{number}}', { number: idx + 1 })}</span>
                  {(clip.trimStart != null || clip.trimEnd != null) && (
                    <span className="text-[10px] text-newTextColor/65">
                      {clip.trimStart ?? 0}s–{clip.trimEnd ?? '∞'}s
                    </span>
                  )}
                </button>
                {idx < clips.length - 1 && (
                  <div className="flex-shrink-0 flex flex-col items-center justify-center w-16 text-center">
                    <span className="text-newTextColor/65 text-lg">⟶</span>
                    <span className="text-[9px] text-newTextColor/65">{transitions[idx]?.type || 'fade'}</span>
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>

          {/* Preview / status */}
          {running && !isComplete && (
            <div className="flex items-center gap-2 mt-2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-designerAccent" />
              <span className="text-sm text-newTextColor/70">{t('processing_merge', 'Processing merge…')}</span>
            </div>
          )}
          {isComplete && jobData?.result?.urls && (
            <div className="flex flex-col gap-2 mt-2 max-w-xl">
              <VideoPlayer src={jobData.result.urls[0]} />
              <button onClick={openInFiles} className={`${toolbarBtn} self-start`}>
                {t('open_in_files', 'Open in Files')}
              </button>
            </div>
          )}
        </div>
      )}
    </EditorShell>
  );
}
