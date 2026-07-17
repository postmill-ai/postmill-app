'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { MediaSelectorModal } from '@gitroom/frontend/components/media-tools/media-selector-modal';
import { openInDesigner } from '@gitroom/frontend/components/media-tools/open-in-designer';
import type { StudioCustomProps } from '@gitroom/frontend/components/media-tools/studio-kit/types';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface Segment {
  start: number;
  end: number;
  text: string;
}
interface TranscriptResult {
  text: string;
  words: { word: string; start: number; end: number }[];
  segments: Segment[];
}
interface SelectedSource {
  fileId?: string;
  url: string;
  type: 'image' | 'video' | 'audio';
  width: number;
  height: number;
}

const MODELS = [
  { value: 'nova-2', labelKey: 'deepgram_model_nova_2', label: 'Nova-2 (recommended)' },
  { value: 'nova-3', labelKey: 'deepgram_model_nova_3', label: 'Nova-3' },
  { value: 'whisper', labelKey: 'deepgram_model_whisper', label: 'Whisper' },
];

// seconds → SRT (00:00:00,000) / VTT (00:00:00.000) timecodes.
const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, '0');
const timecode = (sec: number, sep: ',' | '.') => {
  // Round to whole milliseconds first, then carry — rounding the fraction alone
  // could yield 1000 ms (e.g. sec=5.9997 → "1000"), an invalid 4-digit field.
  const totalMs = Math.round(sec * 1000);
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  return `${pad(totalSec / 3600)}:${pad((totalSec % 3600) / 60)}:${pad(totalSec % 60)}${sep}${pad(ms, 3)}`;
};

const buildSrt = (segments: Segment[]) =>
  segments
    .map((s, i) => `${i + 1}\n${timecode(s.start, ',')} --> ${timecode(s.end, ',')}\n${s.text}`)
    .join('\n\n') + '\n';

const buildVtt = (segments: Segment[]) =>
  'WEBVTT\n\n' +
  segments.map((s) => `${timecode(s.start, '.')} --> ${timecode(s.end, '.')}\n${s.text}`).join('\n\n') +
  '\n';

const download = (filename: string, content: string, mime: string) => {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

export const DeepgramPanel: React.FC<StudioCustomProps> = ({ onGenerated }) => {
  const fetch = useFetch();
  const toaster = useToaster();
  const modal = useModals();
  const t = useT();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [source, setSource] = useState<SelectedSource | null>(null);
  const [model, setModel] = useState('nova-2');
  const [language, setLanguage] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TranscriptResult | null>(null);
  const [transcript, setTranscript] = useState('');

  const onSelect = useCallback(
    (item: {
      source: string;
      url: string;
      fileId?: string;
      type: 'image' | 'video' | 'audio';
      width: number;
      height: number;
    }) => {
      if (item.type !== 'audio' && item.type !== 'video') {
        toaster.show(t('deepgram_pick_audio_or_video', 'Pick an audio or video file to transcribe'), 'warning');
        return;
      }
      if (!item.fileId) {
        toaster.show(t('deepgram_needs_library_file', 'Transcription needs a file from your library'), 'warning');
        return;
      }
      setSource({
        fileId: item.fileId,
        url: item.url,
        type: item.type,
        width: item.width,
        height: item.height,
      });
      setResult(null);
      setTranscript('');
    },
    [toaster]
  );

  const transcribe = useCallback(async () => {
    if (!source?.fileId) return;
    setLoading(true);
    try {
      const res = await fetch('/media/deepgram/transcribe', {
        method: 'POST',
        body: JSON.stringify({ fileId: source.fileId, model, language: language.trim() || undefined }),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        toaster.show(msg || t('deepgram_transcription_failed', 'Transcription failed'), 'warning');
        return;
      }
      const data = (await res.json()) as TranscriptResult;
      if (!data.text) {
        toaster.show(t('deepgram_no_speech_detected', 'No speech detected'), 'warning');
        return;
      }
      setResult(data);
      setTranscript(data.text);
    } catch {
      toaster.show(t('deepgram_transcription_failed', 'Transcription failed'), 'warning');
    } finally {
      setLoading(false);
    }
  }, [source, model, language, fetch, toaster, t]);

  const saveToFiles = useCallback(async () => {
    if (!result) return;
    try {
      const res = await fetch('/media/deepgram/save-transcript', {
        method: 'POST',
        body: JSON.stringify({ text: transcript, segments: result.segments }),
      });
      if (!res.ok) {
        toaster.show(t('deepgram_could_not_save_transcript', 'Could not save transcript'), 'warning');
        return;
      }
      toaster.show(t('deepgram_transcript_saved', 'Transcript saved to Files'), 'success');
      onGenerated();
    } catch {
      toaster.show(t('deepgram_could_not_save_transcript', 'Could not save transcript'), 'warning');
    }
  }, [result, transcript, fetch, toaster, onGenerated, t]);

  const sendToComposer = useCallback(async () => {
    if (!transcript) return;
    const integrationsRes = await fetch('/integrations');
    if (!integrationsRes.ok) {
      toaster.show(t('deepgram_could_not_load_channels', 'Could not load channels'), 'warning');
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
          onlyValues={[{ content: transcript, id: 'new', image: [] }]}
          mutate={() => {}}
          reopenModal={() => {}}
        />
      ),
    });
  }, [transcript, fetch, modal, toaster, t]);

  const copy = useCallback(() => {
    navigator.clipboard.writeText(transcript).then(
      () => toaster.show(t('deepgram_copied', 'Copied'), 'success'),
      () => toaster.show(t('deepgram_copy_failed', 'Copy failed'), 'warning')
    );
  }, [transcript, toaster, t]);

  // Hand the source video + computed word timings to the Designer so it opens a video
  // project with a caption track already built — no re-transcribe. Payload rides in
  // sessionStorage (too large/long for the query string), keyed for the Designer to read.
  const openCaptionInDesigner = useCallback(() => {
    if (!source || source.type !== 'video' || !result) return;
    const payload = {
      url: source.url,
      fileId: source.fileId,
      width: source.width || undefined,
      height: source.height || undefined,
      words: result.words,
    };
    try {
      window.sessionStorage.setItem('designer:caption-handoff', JSON.stringify(payload));
    } catch {
      toaster.show(t('deepgram_could_not_open_designer', 'Could not open the Designer'), 'warning');
      return;
    }
    window.open('/media/designer?captions=1', '_blank');
  }, [source, result, toaster, t]);

  // Audio sources open directly on the timeline audio track.
  const openAudioInDesigner = useCallback(() => {
    if (!source || source.type === 'video' || !source.url) return;
    openInDesigner({ operation: 'audio', artifactUrl: source.url, fileId: source.fileId });
  }, [source]);

  const segments = useMemo(() => result?.segments ?? [], [result]);

  return (
    <div className="max-w-[760px] mx-auto flex flex-col gap-[18px]">
      <p className="text-[13px] text-newTextColor/70">
        {t(
          'deepgram_intro',
          'Transcribe any audio or video from your library with Deepgram, then export captions (.srt / .vtt), copy the transcript, or send it to the composer.'
        )}
      </p>

      {/* Source */}
      <div className="flex flex-col gap-[8px]">
        <label htmlFor="deepgram-source" className="text-[12px] font-[600] text-textColor">{t('deepgram_source_label', 'Source')}</label>
        <div className="flex items-center gap-[10px] flex-wrap">
          <button
            id="deepgram-source"
            type="button"
            onClick={() => setPickerOpen(true)}
            className="px-[14px] py-[9px] rounded-[8px] border border-studioBorder text-[13px] text-textColor hover:bg-boxHover transition-all"
          >
            {source ? t('deepgram_change_file', 'Change file') : t('deepgram_pick_audio_video', 'Pick audio / video')}
          </button>
          {source && (
            <span className="text-[12px] text-newTextColor/60 truncate max-w-[420px]">
              {source.type} · {source.url.split('/').pop()}
            </span>
          )}
        </div>
      </div>

      {/* Options */}
      <div className="flex gap-[14px] flex-wrap">
        <div className="flex flex-col gap-[6px]">
          <label htmlFor="deepgram-model" className="text-[12px] font-[600] text-textColor">{t('deepgram_model_label', 'Model')}</label>
          <select
            id="deepgram-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="h-[38px] px-[10px] rounded-[8px] border border-studioBorder bg-newBgColorInner text-[13px] text-textColor"
          >
            {MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {t(m.labelKey, m.label)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-[6px]">
          <label htmlFor="deepgram-language" className="text-[12px] font-[600] text-textColor">{t('language', 'Language')}</label>
          <input
            id="deepgram-language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            placeholder={t('deepgram_auto_detect', 'auto-detect')}
            className="h-[38px] px-[10px] rounded-[8px] border border-studioBorder bg-newBgColorInner text-[13px] text-textColor w-[160px]"
          />
        </div>
      </div>

      <button
        type="button"
        onClick={transcribe}
        disabled={!source || loading}
        className="self-start px-[20px] py-[10px] rounded-[8px] bg-[#2B5CD3] text-white text-[13px] font-[600] hover:bg-[#2B5CD3]/80 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? t('deepgram_transcribing', 'Transcribing…') : t('deepgram_transcribe', 'Transcribe')}
      </button>

      {/* Result */}
      {result && (
        <div className="flex flex-col gap-[14px] border-t border-studioBorder pt-[18px]">
          <div className="flex flex-col gap-[8px]">
            <label htmlFor="deepgram-transcript" className="text-[12px] font-[600] text-textColor">{t('deepgram_transcript_label', 'Transcript')}</label>
            <textarea
              id="deepgram-transcript"
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              rows={6}
              className="w-full p-[12px] rounded-[8px] border border-studioBorder bg-newBgColorInner text-[13px] text-textColor leading-[1.6] resize-y"
            />
          </div>

          <div className="flex gap-[8px] flex-wrap">
            <button type="button" onClick={copy} className="px-[12px] py-[8px] rounded-[8px] bg-btnSimple text-textColor text-[12px] hover:bg-boxHover transition-all">
              {t('copy', 'Copy')}
            </button>
            <button type="button" onClick={() => download('transcript.srt', buildSrt(segments), 'application/x-subrip')} className="px-[12px] py-[8px] rounded-[8px] bg-btnSimple text-textColor text-[12px] hover:bg-boxHover transition-all">
              {t('deepgram_download_srt', 'Download .srt')}
            </button>
            <button type="button" onClick={() => download('captions.vtt', buildVtt(segments), 'text/vtt')} className="px-[12px] py-[8px] rounded-[8px] bg-btnSimple text-textColor text-[12px] hover:bg-boxHover transition-all">
              {t('deepgram_download_vtt', 'Download .vtt')}
            </button>
            <button type="button" onClick={() => download('transcript.txt', transcript, 'text/plain')} className="px-[12px] py-[8px] rounded-[8px] bg-btnSimple text-textColor text-[12px] hover:bg-boxHover transition-all">
              {t('deepgram_download_txt', 'Download .txt')}
            </button>
            <button type="button" onClick={saveToFiles} className="px-[12px] py-[8px] rounded-[8px] bg-btnSimple text-textColor text-[12px] hover:bg-boxHover transition-all">
              {t('deepgram_save_to_files', 'Save to Files')}
            </button>
            {source?.type === 'video' && (
              <button type="button" onClick={openCaptionInDesigner} className="px-[12px] py-[8px] rounded-[8px] bg-btnSimple text-textColor text-[12px] hover:bg-boxHover transition-all">
                {t('deepgram_edit_in_designer', 'Edit in Designer')}
              </button>
            )}
            {source?.type === 'audio' && (
              <button type="button" onClick={openAudioInDesigner} className="px-[12px] py-[8px] rounded-[8px] bg-btnSimple text-textColor text-[12px] hover:bg-boxHover transition-all">
                {t('deepgram_edit_in_designer', 'Edit in Designer')}
              </button>
            )}
            <button type="button" onClick={sendToComposer} className="px-[12px] py-[8px] rounded-[8px] bg-[#2B5CD3] text-white text-[12px] font-[500] hover:bg-[#2B5CD3]/80 transition-all">
              {t('deepgram_send_to_composer', 'Send to composer')}
            </button>
          </div>

          {/* Segments with timecodes */}
          <div className="flex flex-col gap-[6px] max-h-[280px] overflow-y-auto">
            {segments.map((s, i) => (
              <div key={i} className="flex gap-[10px] text-[12px]">
                <span className="shrink-0 text-newTextColor/60 tabular-nums w-[64px]">{timecode(s.start, '.').slice(0, 8)}</span>
                <span className="text-textColor">{s.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <MediaSelectorModal open={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={onSelect} />
    </div>
  );
};
