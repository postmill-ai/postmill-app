'use client';

import React, { useCallback, useEffect, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useReplicateStore } from './replicate.store';
import { AudioPlayer } from '@gitroom/frontend/components/media-tools/audio-player';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { VideoPlayer } from './players/video-player';
import { ElapsedTimer } from './elapsed-timer';
import { useGenerate } from './use-generate';
import { openInDesigner } from '@gitroom/frontend/components/media-tools/open-in-designer';

type Medium = 'image' | 'video' | 'audio';

function mediumNoun(t: (key: string, fallback: string) => string, medium: Medium): string {
  switch (medium) {
    case 'image':
      return t('media_noun_image', 'image');
    case 'video':
      return t('media_noun_video', 'video');
    case 'audio':
      return t('media_noun_audio', 'audio');
  }
}

function useJobPoll(jobId: string | null) {
  const fetch = useFetch();
  return useSWR(
    jobId ? `replicate-job-${jobId}` : null,
    async () => {
      const res = await fetch(`/media/replicate/jobs/${jobId}`);
      return (await res.json()) as {
        status: string;
        result: { kind: string; urls: string[] } | null;
      };
    },
    { refreshInterval: 6000 }
  );
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function generateSrt(segments: Array<{ text: string; start?: number; end?: number }>): string {
  return segments
    .map((seg, i) => {
      const start = seg.start ?? 0;
      const end = seg.end ?? start + 1;
      const fmt = (s: number) => {
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = Math.floor(s % 60);
        const ms = Math.floor((s % 1) * 1000);
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
      };
      return `${i + 1}\n${fmt(start)} --> ${fmt(end)}\n${seg.text}\n`;
    })
    .join('\n');
}

const MEDIUM_ICON: Record<Medium, string> = {
  image: '🖼️',
  video: '🎬',
  audio: '🎵',
};

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full w-full flex items-center justify-center p-6">
      <div className="w-full max-w-2xl">{children}</div>
    </div>
  );
}

// ── Hover action overlay (oc-platform: Download / Regenerate / New) ───────────
function ActionOverlay({
  onDownload,
  onRegenerate,
  onNew,
}: {
  onDownload?: () => void;
  onRegenerate: () => void;
  onNew: () => void;
}) {
  const t = useT();
  const btn =
    'flex items-center justify-center w-9 h-9 rounded-full bg-black/60 backdrop-blur text-white hover:bg-black/80 transition-colors';
  return (
    <div className="absolute top-3 right-3 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
      {onDownload && (
        <button type="button" onClick={onDownload} className={btn} title={t('download', 'Download')}>
          ⤓
        </button>
      )}
      <button type="button" onClick={onRegenerate} className={btn} title={t('regenerate', 'Regenerate')}>
        ⟳
      </button>
      <button type="button" onClick={onNew} className={btn} title={t('new_label', 'New')}>
        ＋
      </button>
    </div>
  );
}

function DetailsCard() {
  const t = useT();
  const meta = useReplicateStore((s) => s.resultMeta);
  const estimate = useReplicateStore((s) => s.estimate);
  if (!meta) return null;
  const entries = Object.entries(meta.input).filter(
    ([, v]) => v !== undefined && v !== null && v !== ''
  );
  return (
    <div className="mt-4 rounded-xl border border-studioBorder bg-newBgColorInner p-3">
      <div className="flex gap-6 mb-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-newTextColor/65">{t('model', 'Model')}</div>
          <div className="text-sm text-textColor">{meta.modelName}</div>
        </div>
        {estimate && !estimate.approximate && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-newTextColor/65">{t('est_cost', 'Est. cost')}</div>
            <div className="text-sm text-green-700 dark:text-green-400">${estimate.usd.toFixed(4)}</div>
          </div>
        )}
      </div>
      {entries.length > 0 && (
        <div className="border-t border-studioBorder pt-2 space-y-1">
          {entries.map(([k, v]) => {
            const display =
              typeof v === 'object' ? (v as any).url || (v as any).fileId || JSON.stringify(v) : String(v);
            return (
              <div key={k} className="text-[11px] text-newTextColor/70">
                <span className="text-newTextColor/65">{k.replace(/_/g, ' ')}: </span>
                <span className="text-newTextColor/80">{display}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ResultPanel({ medium }: { medium: Medium }) {
  const t = useT();
  const runState = useReplicateStore((s) => s.runState);
  const result = useReplicateStore((s) => s.result);
  const error = useReplicateStore((s) => s.error);
  const selectedModel = useReplicateStore((s) => s.selectedModel);
  const selectedCategory = useReplicateStore((s) => s.selectedCategory);
  const saveFolderId = useReplicateStore((s) => s.saveFolderId);
  const setResult = useReplicateStore((s) => s.setResult);
  const setRunState = useReplicateStore((s) => s.setRunState);
  const setError = useReplicateStore((s) => s.setError);
  const resultJobId = useReplicateStore((s) => s.result?.jobId);

  const fetch = useFetch();
  const generate = useGenerate();
  const [saving, setSaving] = useState(false);
  const [savedPaths, setSavedPaths] = useState<Record<string, string>>({});

  const isPolling = runState === 'running' && !!result?.jobId;
  const { data: jobData } = useJobPoll(isPolling ? result!.jobId! : null);

  useEffect(() => {
    if (jobData?.status === 'completed' && jobData.result) {
      setResult({
        kind: jobData.result.kind as Medium | 'text',
        urls: jobData.result.urls,
        jobId: resultJobId,
      });
      setRunState('success');
    }
    if (jobData?.status === 'failed') {
      setError(t('generation_failed', 'Generation failed'));
      setRunState('error');
    }
  }, [jobData, setResult, setRunState, setError, resultJobId, t]);

  const handleNew = useCallback(() => {
    setResult(null);
    setError(null);
    setRunState('idle');
  }, [setResult, setError, setRunState]);

  const handleSaveToFiles = useCallback(
    async (url: string) => {
      setSaving(true);
      try {
        const res = await fetch('/media/replicate/save-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, name: `replicate-${Date.now()}`, folderId: saveFolderId }),
        });
        const data = await res.json();
        if (data.path) setSavedPaths((prev) => ({ ...prev, [url]: data.path }));
      } catch {
        setError(t('failed_to_save_to_files', 'Failed to save to Files'));
      } finally {
        setSaving(false);
      }
    },
    [fetch, saveFolderId, setError, t]
  );

  const handleDownload = useCallback((url: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  const openInFiles = useCallback(() => {
    const target = saveFolderId ? `/files?folderId=${encodeURIComponent(saveFolderId)}` : '/files';
    window.open(target, '_blank');
  }, [saveFolderId]);

  // ── State 1: placeholder ───────────────────────────────────────────────────
  if (!selectedModel) {
    return (
      <Frame>
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-studioBorder py-20 text-center">
          <span className="text-5xl opacity-40">{MEDIUM_ICON[medium]}</span>
          <p className="text-newTextColor/70">{t('nothing_generated_yet', 'Nothing generated yet')}</p>
          <p className="text-xs text-newTextColor/65">
            {t('pick_model_configure_start', 'Pick a model and configure it to get started.')}
          </p>
        </div>
      </Frame>
    );
  }

  // ── State 2: example media (model picked, idle) ────────────────────────────
  if (runState === 'idle' && !result) {
    return (
      <Frame>
        <div className="flex flex-col gap-2">
          <div className="text-xs text-newTextColor/65">
            {t('example_of', 'Example of')} <span className="text-btnPrimaryAccent">{selectedModel.id}</span>
          </div>
          {selectedModel.coverImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- external provider asset
            <img
              src={selectedModel.coverImageUrl}
              alt={t('model_example_alt', 'Model example')}
              className="w-full rounded-2xl border border-studioBorder object-contain max-h-[60vh]"
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-studioBorder py-20">
              <span className="text-5xl opacity-40">{MEDIUM_ICON[medium]}</span>
              <p className="text-xs text-newTextColor/65">
                {t('no_example_available', 'No example available — generate to see output.')}
              </p>
            </div>
          )}
        </div>
      </Frame>
    );
  }

  // ── State 3: loading ───────────────────────────────────────────────────────
  if (runState === 'running') {
    return (
      <Frame>
        <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-studioBorder py-20">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-designerAccent" />
          <p className="text-newTextColor/80">
            {t('generating_your_medium', 'Generating your {{medium}}…', { medium: mediumNoun(t, medium) })}
          </p>
          <p className="text-xs text-newTextColor/65">
            {medium === 'image'
              ? t('takes_10_30_seconds', 'This usually takes 10–30 seconds.')
              : t('takes_few_minutes', 'This can take a few minutes.')}
          </p>
          <ElapsedTimer />
        </div>
      </Frame>
    );
  }

  // ── State 4: error ─────────────────────────────────────────────────────────
  if (runState === 'error') {
    // A missing-field error is self-explanatory; any other failure may be an
    // out-of-credit / rate-limit on Replicate (which has no balance API), so
    // point the user at their Replicate billing.
    const isInputError = /missing required/i.test(error || '');
    return (
      <Frame>
        <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-red-900/50 bg-red-950/20 py-16 px-6">
          <p className="text-dangerText text-center">{error || t('generation_failed', 'Generation failed')}</p>
          {!isInputError && (
            <p className="text-xs text-newTextColor/65 text-center max-w-sm">
              {t('check_replicate_balance_prefix', 'If a generation fails for no clear reason, check your')}{' '}
              <a
                href="https://replicate.com/account/billing"
                target="_blank"
                rel="noopener noreferrer"
                className="text-btnPrimaryAccent underline"
              >
                {t('replicate_balance_link', 'Replicate balance')}
              </a>{' '}
              {t(
                'check_replicate_balance_suffix',
                '— low or empty credit causes rate-limiting and failed runs.'
              )}
            </p>
          )}
          <button
            onClick={() => generate()}
            className="px-4 py-2 rounded-lg bg-btnSimple text-textColor text-sm hover:bg-boxHover transition-colors"
          >
            {t('retry', 'Retry')}
          </button>
        </div>
      </Frame>
    );
  }

  // ── State 5: result ────────────────────────────────────────────────────────
  if (runState === 'success' && result) {
    const urls = result.urls || [];
    const single = urls.length <= 1;

    return (
      <Frame>
        <div className="flex flex-col gap-3">
          {selectedCategory === 'caption' && (
            <p className="text-xs text-newTextColor/70">
              {t(
                'captions_burned_note',
                'Captions are burned into the video — the output is an MP4, not a subtitle file.'
              )}
            </p>
          )}

          {result.kind === 'image' && urls.length > 0 && (
            <div className={single ? '' : 'grid grid-cols-2 gap-3'}>
              {urls.map((url, i) => (
                <div key={url} className="group relative">
                  {/* eslint-disable-next-line @next/next/no-img-element -- external provider result */}
                  <img
                    src={url}
                    alt={t('result_number_alt', 'Result {{number}}', { number: i + 1 })}
                    className="w-full rounded-2xl border border-studioBorder"
                  />
                  <ActionOverlay
                    onDownload={() => handleDownload(url)}
                    onRegenerate={() => generate()}
                    onNew={handleNew}
                  />
                </div>
              ))}
            </div>
          )}

          {result.kind === 'video' && urls.length > 0 && (
            <div className="group relative">
              <VideoPlayer src={urls[0]} />
              <ActionOverlay onDownload={() => handleDownload(urls[0])} onRegenerate={() => generate()} onNew={handleNew} />
            </div>
          )}

          {result.kind === 'audio' && urls.length > 0 && (
            <div className="group relative rounded-2xl border border-studioBorder p-3">
              <AudioPlayer src={urls[0]} />
              <ActionOverlay onDownload={() => handleDownload(urls[0])} onRegenerate={() => generate()} onNew={handleNew} />
            </div>
          )}

          {result.kind === 'text' && result.text && (
            <div className="rounded-2xl border border-studioBorder bg-newBgColorInner p-4 max-h-[50vh] overflow-y-auto">
              <p className="text-sm text-textColor whitespace-pre-wrap">{result.text}</p>
            </div>
          )}

          {/* Persist / open actions */}
          {urls.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {!result.jobId ? (
                <button
                  onClick={() => handleSaveToFiles(urls[0])}
                  disabled={saving}
                  className="px-3 py-1.5 rounded-lg bg-[#2B5CD3] text-white text-xs hover:bg-[#2B5CD3]/80 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                  </svg>
                  {saving ? t('saving_ellipsis', 'Saving…') : t('save_to_files', 'Save to Files')}
                </button>
              ) : (
                <button
                  onClick={openInFiles}
                  className="px-3 py-1.5 rounded-lg bg-btnSimple text-textColor text-xs hover:bg-boxHover transition-colors"
                >
                  {t('open_in_files', 'Open in Files')}
                </button>
              )}
              {['image', 'audio', 'video'].includes(result.kind) && (
                <button
                  onClick={() =>
                    openInDesigner({
                      operation: result.kind,
                      artifactUrl: savedPaths[urls[0]] || urls[0],
                    })
                  }
                  className="px-3 py-1.5 rounded-lg bg-designerAccent/20 text-btnPrimaryAccent text-xs hover:bg-designerAccent/30 transition-colors"
                >
                  {t('open_in_designer', 'Open in Designer')}
                </button>
              )}
            </div>
          )}

          {result.kind === 'text' && result.text && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => navigator.clipboard.writeText(result.text!)}
                className="px-3 py-1.5 rounded-lg bg-btnSimple text-textColor text-xs hover:bg-boxHover transition-colors"
              >
                {t('copy', 'Copy')}
              </button>
              <button
                onClick={() => downloadBlob(result.text!, 'transcript.txt', 'text/plain')}
                className="px-3 py-1.5 rounded-lg bg-btnSimple text-textColor text-xs hover:bg-boxHover transition-colors"
              >
                {t('download_txt', 'Download .txt')}
              </button>
              {result.segments && result.segments.length > 0 && (
                <button
                  onClick={() => downloadBlob(generateSrt(result.segments!), 'transcript.srt', 'text/plain')}
                  className="px-3 py-1.5 rounded-lg bg-btnSimple text-textColor text-xs hover:bg-boxHover transition-colors"
                >
                  {t('download_srt', 'Download .srt')}
                </button>
              )}
              <button onClick={handleNew} className="px-3 py-1.5 rounded-lg bg-btnSimple text-textColor text-xs hover:bg-boxHover transition-colors">
                {t('new_label', 'New')}
              </button>
            </div>
          )}

          <DetailsCard />
        </div>
      </Frame>
    );
  }

  return null;
}
