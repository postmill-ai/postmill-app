'use client';

import React, { FC, useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

interface VoiceoverRecordDialogProps {
  onClose: () => void;
  /** Receives the recorded blob and its (normalized) MIME type; should upload
   *  and land it on the timeline. The dialog closes only when the returned
   *  promise resolves — a rejection keeps it open, shows the error, and the
   *  recording stays intact for a retry. */
  onAdd: (blob: Blob, mimeType: string) => void | Promise<void>;
  /** Title override — the voice-clone field says "Record voice". */
  title?: string;
  /** Primary CTA override — a form field accepts the recording with "Use
   *  recording", not "Add to timeline". */
  addLabel?: string;
}

/** Client-side recording cap — auto-stop, matching the timeline ceiling. */
export const MAX_VOICEOVER_RECORD_MS = 180_000;

// Preference order: Chrome/Firefox opus-in-webm first, Safari's AAC-in-mp4,
// then ogg/opus. The first isTypeSupported hit wins.
const MIME_PREFERENCES = [
  'audio/webm;codecs=opus',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

export const pickRecordingMimeType = (): string | undefined =>
  MIME_PREFERENCES.find(
    (m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)
  ) ?? '';

type Phase =
  | 'requesting' // permission prompt in flight
  | 'ready' // stream live, not recording
  | 'recording'
  | 'review' // blob recorded, previewing
  | 'denied' // NotAllowedError
  | 'no-mic' // NotFoundError / OverconstrainedError
  | 'unsupported' // no getUserMedia/MediaRecorder, or NotSupportedError
  | 'error';

const inputClass =
  'w-full px-[12px] py-[9px] rounded-[8px] bg-newBgColorInner border border-studioBorder text-[13px] text-textColor outline-hidden focus:border-[#2B5CD3] transition-colors';

const formatElapsed = (ms: number) => {
  const totalSec = Math.floor(ms / 1000);
  return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}`;
};

// Lazy singleton — the AudioContext must not be created at module load (jsdom
// has none, and an unused context would hold an audio thread). Same pattern as
// video-timeline.tsx's audioContextSingleton, just deferred.
let sharedAudioContext: AudioContext | null | undefined;
const getAudioContext = (): AudioContext | null => {
  if (sharedAudioContext !== undefined) return sharedAudioContext;
  const Ctor =
    typeof window !== 'undefined'
      ? window.AudioContext || (window as any).webkitAudioContext
      : undefined;
  sharedAudioContext = Ctor ? new Ctor() : null;
  return sharedAudioContext;
};

export const VoiceoverRecordDialog: FC<VoiceoverRecordDialogProps> = ({
  onClose,
  onAdd,
  title,
  addLabel,
}) => {
  const t = useT();
  const [phase, setPhase] = useState<Phase>('requesting');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobRef = useRef<Blob | null>(null);
  const mimeRef = useRef<string>('audio/webm');
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const levelBarRef = useRef<HTMLDivElement | null>(null);
  const analyserCleanupRef = useRef<(() => void) | null>(null);
  // Mounted flag: async permission/recorder callbacks must not setState after
  // the dialog unmounted (the modal can close mid-prompt).
  const mountedRef = useRef(true);

  const stopStream = useCallback(() => {
    analyserCleanupRef.current?.();
    analyserCleanupRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const revokePreview = useCallback(() => {
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    blobRef.current = null;
  }, []);

  // Full teardown on unmount: recorder, mic tracks, object URL, analyser.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {
          /* best-effort */
        }
      }
      stopStream();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Level meter: AnalyserNode on the live stream, rAF-driven, writing the bar
  // width straight to the DOM (a 60fps setState would re-render the dialog
  // constantly).
  const attachLevelMeter = useCallback((stream: MediaStream) => {
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      let raf = 0;
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (let i = 0; i < data.length; i++) {
          peak = Math.max(peak, Math.abs(data[i] - 128) / 128);
        }
        if (levelBarRef.current) {
          levelBarRef.current.style.width = `${Math.min(100, Math.round(peak * 100))}%`;
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      analyserCleanupRef.current = () => {
        cancelAnimationFrame(raf);
        source.disconnect();
        analyser.disconnect();
      };
    } catch {
      /* meter is cosmetic — a failure must not block recording */
    }
  }, []);

  const requestStream = useCallback(
    async (requestedDeviceId?: string) => {
      setPhase('requesting');
      stopStream();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            ...(requestedDeviceId ? { deviceId: requestedDeviceId } : {}),
          },
        });
        if (!mountedRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        attachLevelMeter(stream);
        // Device labels only unlock AFTER a grant — enumerate now.
        try {
          const all = await navigator.mediaDevices.enumerateDevices();
          if (mountedRef.current) {
            setDevices(all.filter((d) => d.kind === 'audioinput'));
          }
        } catch {
          /* a missing device list degrades to the default mic */
        }
        setPhase('ready');
      } catch (err) {
        if (!mountedRef.current) return;
        const name = (err as DOMException)?.name;
        if (name === 'NotAllowedError') setPhase('denied');
        else if (name === 'NotFoundError' || name === 'OverconstrainedError')
          setPhase('no-mic');
        else if (name === 'NotSupportedError') setPhase('unsupported');
        else setPhase('error');
      }
    },
    [attachLevelMeter, stopStream]
  );

  // Open = ask for the mic immediately (the prompt spinner state).
  useEffect(() => {
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      setPhase('unsupported');
      return;
    }
    void requestStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop(); // onstop builds the preview blob
    }
  }, []);

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const mimeType = pickRecordingMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
    } catch {
      setPhase('unsupported');
      return;
    }
    mimeRef.current = recorder.mimeType || mimeType || 'audio/webm';
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      if (!mountedRef.current) return;
      blobRef.current = new Blob(chunksRef.current, { type: mimeRef.current });
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blobRef.current!);
      });
      setPhase('review');
    };
    recorderRef.current = recorder;
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    setPhase('recording');
    recorder.start();
    // Elapsed ticker + the 180s auto-stop cap.
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAtRef.current;
      setElapsedMs(elapsed);
      if (elapsed >= MAX_VOICEOVER_RECORD_MS) stopRecording();
    }, 250);
  }, [stopRecording]);

  const handleReRecord = useCallback(() => {
    revokePreview();
    setElapsedMs(0);
    setPhase(streamRef.current ? 'ready' : 'requesting');
    if (!streamRef.current) void requestStream();
  }, [requestStream, revokePreview]);

  const handleAdd = useCallback(async () => {
    const blob = blobRef.current;
    if (!blob || adding) return;
    setAdding(true);
    setAddError(null);
    try {
      await onAdd(blob, mimeRef.current);
      onClose();
    } catch (err) {
      // Upload/landing failed — stay open with the recording intact so
      // "Add to timeline" can be retried; closing would GC the blob.
      if (mountedRef.current) {
        setAddError(
          (err as Error)?.message ||
            t('designer_add_to_timeline_failed', 'Could not add the recording to the timeline.')
        );
      }
    } finally {
      if (mountedRef.current) setAdding(false);
    }
  }, [adding, onAdd, onClose, t]);

  const switchDevice = useCallback(
    (id: string) => {
      setDeviceId(id);
      if (phase === 'ready' || phase === 'review') {
        revokePreview();
        void requestStream(id);
      }
    },
    [phase, requestStream, revokePreview]
  );

  const remainingMs = MAX_VOICEOVER_RECORD_MS - elapsedMs;

  return (
    <div className="flex flex-col gap-[16px] p-[4px] min-w-[320px]">
      <h3 className="text-[14px] font-medium text-textColor">
        {title ?? t('designer_record_voiceover_title', 'Record voiceover')}
      </h3>

      {phase === 'requesting' && (
        <div className="flex items-center gap-[10px] text-[13px] text-newTextColor/70">
          <span
            className="w-[14px] h-[14px] rounded-full border-2 border-studioBorder border-t-designerAccent animate-spin"
            aria-hidden="true"
          />
          {t('designer_requesting_mic', 'Requesting microphone…')}
        </div>
      )}

      {phase === 'denied' && (
        <div className="text-[13px] text-amber-600">
          {t(
            'designer_mic_denied',
            'Microphone access was denied. Allow the microphone in your browser settings, then retry.'
          )}
        </div>
      )}
      {phase === 'no-mic' && (
        <div className="text-[13px] text-amber-600">
          {t(
            'designer_no_mic_found',
            'No microphone found. Connect a microphone and try again.'
          )}
        </div>
      )}
      {phase === 'unsupported' && (
        <div className="text-[13px] text-amber-600">
          {t(
            'designer_recording_not_supported',
            'Recording is not supported in this browser.'
          )}
        </div>
      )}
      {phase === 'error' && (
        <div className="text-[13px] text-amber-600">
          {t('designer_mic_error', 'Could not start the microphone.')}
        </div>
      )}

      {(phase === 'ready' || phase === 'recording' || phase === 'review') &&
        devices.length > 1 && (
          <div>
            <label
              htmlFor="voiceover-mic"
              className="block text-[12px] text-newTextColor/70 mb-[6px]"
            >
              {t('designer_microphone_label', 'Microphone')}
            </label>
            <select
              id="voiceover-mic"
              value={deviceId}
              onChange={(e) => switchDevice(e.target.value)}
              disabled={phase === 'recording'}
              className={inputClass}
            >
              <option value="">{t('designer_default_mic', 'Default')}</option>
              {devices.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `${t('designer_microphone_label', 'Microphone')} ${i + 1}`}
                </option>
              ))}
            </select>
          </div>
        )}

      {(phase === 'ready' || phase === 'recording') && (
        <div className="flex items-center gap-[10px]">
          {/* Level meter — the bar width is driven by the analyser rAF loop. */}
          <div
            className="flex-1 h-[8px] rounded-full bg-studioBorder overflow-hidden"
            role="progressbar"
            aria-label={t('designer_mic_level', 'Microphone level')}
          >
            <div
              ref={levelBarRef}
              className={`h-full transition-none ${
                phase === 'recording' ? 'bg-red-500' : 'bg-designerAccent'
              }`}
              style={{ width: '0%' }}
            />
          </div>
          <span className="text-[12px] text-textColor/70 tabular-nums w-[44px] text-end">
            {formatElapsed(elapsedMs)}
          </span>
        </div>
      )}

      {phase === 'recording' && (
        <div className="text-[11px] text-textColor/50">
          {t(
            'designer_recording_auto_stop',
            'Recording stops automatically at 3:00.'
          )}{' '}
          {formatElapsed(Math.max(0, remainingMs))}
        </div>
      )}

      {phase === 'review' && previewUrl && (
        // eslint-disable-next-line jsx-a11y/media-has-caption -- a voiceover preview has no caption track to offer
        <audio controls src={previewUrl} className="w-full" />
      )}

      {phase === 'review' && addError && (
        <div className="text-[13px] text-amber-600">{addError}</div>
      )}

      <div className="flex justify-end gap-[8px] pt-[4px]">
        <button
          type="button"
          onClick={onClose}
          className="px-[12px] py-[8px] rounded-[8px] text-[13px] text-textColor hover:bg-studioBorder/30 transition-colors"
        >
          {t('cancel', 'Cancel')}
        </button>
        {(phase === 'denied' || phase === 'no-mic' || phase === 'error') && (
          <button
            type="button"
            onClick={() => void requestStream()}
            className="px-[12px] py-[8px] rounded-[8px] text-[13px] bg-[#2B5CD3] text-white hover:bg-[#244bb0] transition-colors"
          >
            {t('retry', 'Retry')}
          </button>
        )}
        {phase === 'ready' && (
          <button
            type="button"
            onClick={startRecording}
            className="px-[12px] py-[8px] rounded-[8px] text-[13px] bg-red-600 text-white hover:bg-red-700 transition-colors"
          >
            {t('designer_start_recording', '● Record')}
          </button>
        )}
        {phase === 'recording' && (
          <button
            type="button"
            onClick={stopRecording}
            className="px-[12px] py-[8px] rounded-[8px] text-[13px] bg-[#2B5CD3] text-white hover:bg-[#244bb0] transition-colors"
          >
            {t('designer_stop_recording', '■ Stop')}
          </button>
        )}
        {phase === 'review' && (
          <>
            <button
              type="button"
              onClick={handleReRecord}
              className="px-[12px] py-[8px] rounded-[8px] text-[13px] text-textColor hover:bg-studioBorder/30 transition-colors"
            >
              {t('designer_re_record', 'Re-record')}
            </button>
            <button
              type="button"
              onClick={handleAdd}
              disabled={adding}
              className="px-[12px] py-[8px] rounded-[8px] text-[13px] bg-[#2B5CD3] text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#244bb0] transition-colors"
            >
              {adding
                ? t('designer_adding_ellipsis', 'Adding…')
                : (addLabel ?? t('designer_add_to_timeline', 'Add to timeline'))}
            </button>
          </>
        )}
      </div>
    </div>
  );
};
