'use client';

import React, { FC, useCallback, useEffect, useState } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import type { VideoClip } from '../designer.store';
import { useMediaVoices } from '../use-media-voices';
import { readErrorMessage } from '../read-error-message';
import { regenerateVoiceoverClip } from '../add-media-to-timeline';
import { postTextToSpeech } from '../text-to-speech';

interface VoiceoverClipSectionProps {
  store: any;
  outputIndex: number;
  trackId: string;
  clipId: string;
  clip: VideoClip;
}

/**
 * Re-voice / re-script a TTS voiceover clip in place. Only renders for clips
 * carrying `voiceover` provenance (written at landing — see
 * addVoiceoverToTimeline); mic recordings and pre-existing clips have none.
 * Regenerate re-calls TTS with the SAME tone instructions and provider pin
 * the original generation used (both editable here) and swaps the clip's
 * audio (`src`/`fileId`, end re-probed) without touching its timeline
 * position.
 */
export const VoiceoverClipSection: FC<VoiceoverClipSectionProps> = ({
  store,
  outputIndex,
  trackId,
  clipId,
  clip,
}) => {
  const t = useT();
  const toaster = useToaster();
  const fetch = useFetch();
  const { data: voices, isLoading } = useMediaVoices();
  const [script, setScript] = useState(clip.voiceover?.script || '');
  const [voice, setVoice] = useState(clip.voiceover?.voice || '');
  const [instructions, setInstructions] = useState(clip.voiceover?.instructions || '');
  const [regenerating, setRegenerating] = useState(false);

  // Follow the clip when the inspector switches targets (or an undo rewrites
  // the provenance) without clobbering an in-progress edit of the same clip.
  useEffect(() => {
    setScript(clip.voiceover?.script || '');
    setVoice(clip.voiceover?.voice || '');
    setInstructions(clip.voiceover?.instructions || '');
  }, [clipId, clip.voiceover?.script, clip.voiceover?.voice, clip.voiceover?.instructions]);

  // Same-input re-roll is allowed on purpose: TTS is non-deterministic, so
  // regenerating without edits is a valid "try another take".
  const canRegenerate = script.trim().length > 0 && voice.length > 0 && !regenerating;

  const regenerate = useCallback(async () => {
    if (!canRegenerate) return;
    setRegenerating(true);
    try {
      const tone = instructions.trim();
      const provider = clip.voiceover?.provider;
      const res = await postTextToSpeech(fetch, {
        text: script.trim(),
        voiceId: voice,
        ...(tone ? { instructions: tone } : {}),
        ...(provider ? { provider } : {}),
      });
      if (!res.ok) {
        toaster.show(
          await readErrorMessage(res, t('voiceover_generation_failed', 'Voiceover generation failed')),
          'warning'
        );
        return;
      }
      const { id, path } = await res.json();
      const landed = await regenerateVoiceoverClip(
        store,
        { outputIndex, trackId, clipId },
        {
          url: path,
          fileId: id,
          voiceover: {
            script: script.trim(),
            voice,
            ...(tone ? { instructions: tone } : {}),
            ...(provider ? { provider } : {}),
          },
        }
      );
      if (!landed) {
        toaster.show(t('voiceover_generation_failed', 'Voiceover generation failed'), 'warning');
        return;
      }
      toaster.show(t('designer_voiceover_regenerated', 'Voiceover regenerated'), 'success');
    } catch {
      toaster.show(t('voiceover_generation_failed', 'Voiceover generation failed'), 'warning');
    } finally {
      setRegenerating(false);
    }
  }, [canRegenerate, fetch, script, voice, instructions, clip.voiceover?.provider, toaster, t, store, outputIndex, trackId, clipId]);

  const selectClass =
    'w-full h-[28px] px-2 rounded-md bg-newBgColor border border-studioBorder text-[12px] text-textColor outline-hidden';

  return (
    <div className="pt-1 border-t border-studioBorder space-y-2">
      <div className="text-[11px] text-textColor/50">{t('designer_voiceover_section', 'Voiceover')}</div>
      <textarea
        value={script}
        onChange={(e) => setScript(e.target.value)}
        rows={3}
        aria-label={t('designer_script_label', 'Script')}
        className="w-full px-2 py-1.5 rounded-md bg-newBgColor border border-studioBorder text-[12px] text-textColor outline-hidden resize-y"
      />
      <select
        value={voice}
        onChange={(e) => setVoice(e.target.value)}
        disabled={isLoading}
        aria-label={t('designer_voice_label', 'Voice')}
        className={selectClass}
      >
        {/* The clip's stored voice stays selectable even while the catalog
            loads or no longer lists it. */}
        {voice && !(voices || []).some((v) => v.id === voice) && (
          <option value={voice}>{voice}</option>
        )}
        {!voice && (
          <option value="" disabled>
            {t('designer_choose_a_voice_option', 'Choose a voice…')}
          </option>
        )}
        {(voices || []).map((v) => (
          <option key={v.id} value={v.id}>
            {v.label}
          </option>
        ))}
      </select>
      <input
        type="text"
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        placeholder={t('designer_voiceover_tone_placeholder', 'Tone / style, e.g. warm and conversational…')}
        aria-label={t('designer_voiceover_tone_label', 'Tone / style')}
        className={selectClass}
      />
      <button
        type="button"
        disabled={!canRegenerate}
        onClick={regenerate}
        className="w-full px-2 py-1.5 rounded-sm text-[11px] border border-designerAccent/30 text-btnPrimaryAccent hover:bg-designerAccent/10 disabled:opacity-50 disabled:hover:bg-transparent"
      >
        {regenerating
          ? t('designer_regenerating_ellipsis', 'Regenerating…')
          : t('designer_regenerate_voiceover', 'Regenerate voiceover')}
      </button>
    </div>
  );
};
