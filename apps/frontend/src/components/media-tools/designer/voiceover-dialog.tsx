'use client';

import React, { FC, useCallback, useState } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import {
  GenerationProviderPicker,
  useGenerationProviderChoice,
} from '@postmill-ai/frontend/components/media-tools/designer/panels/generation-provider-picker';
import { useMediaVoices } from './use-media-voices';
import { readErrorMessage } from './read-error-message';

interface VoiceoverDialogProps {
  onClose: () => void;
  onGenerate: (text: string, voiceId: string, instructions?: string, provider?: string) => void | Promise<void>;
}

const inputClass =
  'w-full px-[12px] py-[9px] rounded-[8px] bg-newBgColorInner border border-studioBorder text-[13px] text-textColor outline-hidden focus:border-[#2B5CD3] transition-colors';

export const VoiceoverDialog: FC<VoiceoverDialogProps> = ({
  onClose,
  onGenerate,
}) => {
  const t = useT();
  const toaster = useToaster();
  const fetch = useFetch();
  const [text, setText] = useState('');
  const [topic, setTopic] = useState('');
  const [instructions, setInstructions] = useState('');
  const [selectedVoice, setSelectedVoice] = useState('');
  const [generating, setGenerating] = useState(false);
  const [writing, setWriting] = useState(false);
  // '' = org default TTS provider; a pinned provider is sent with the TTS call.
  const [provider, setProvider] = useGenerationProviderChoice('voiceover');
  const { data: voices, isLoading, error } = useMediaVoices(provider || undefined);

  // Voice ids are provider-specific — a provider switch invalidates the pick.
  const handleProviderChange = useCallback((next: string) => {
    setProvider(next);
    setSelectedVoice('');
  }, [setProvider]);

  const canGenerate = text.trim().length > 0 && selectedVoice.length > 0;
  // No dedicated topic field entry? The script box's current content is the
  // best topic the dialog has — a rewrite of what the user started.
  const canWrite = (topic.trim() || text.trim()).length > 0;

  const handleWriteScript = async () => {
    if (!canWrite || writing) return;
    setWriting(true);
    try {
      const res = await fetch('/media/voiceover-script', {
        method: 'POST',
        body: JSON.stringify({ topic: topic.trim() || text.trim() }),
      });
      if (!res.ok) {
        toaster.show(
          await readErrorMessage(res, t('designer_voiceover_script_failed', 'Could not write a script')),
          'warning'
        );
        return;
      }
      const body = await res.json();
      if (typeof body?.script === 'string' && body.script.trim()) {
        // Fills the textarea — the user edits before the TTS call is made.
        setText(body.script.trim());
      }
    } catch {
      toaster.show(t('designer_voiceover_script_failed', 'Could not write a script'), 'warning');
    } finally {
      setWriting(false);
    }
  };

  const handleGenerate = async () => {
    if (!canGenerate || generating) return;
    setGenerating(true);
    try {
      await onGenerate(text.trim(), selectedVoice, instructions.trim() || undefined, provider || undefined);
      onClose();
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex flex-col gap-[16px] p-[4px] min-w-[320px]">
      <h3 className="text-[14px] font-medium text-textColor">{t('designer_generate_ai_voiceover_title', 'Generate AI voiceover')}</h3>

      <div>
        <label htmlFor="voiceover-script" className="block text-[12px] text-newTextColor/70 mb-[6px]">
          {t('designer_script_label', 'Script')} <span className="text-amber-600">*</span>
        </label>
        <textarea
          id="voiceover-script"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('designer_voiceover_script_placeholder', 'Type the voiceover text…')}
          rows={4}
          className={`${inputClass} resize-y min-h-[88px]`}
        />
        <div className="flex gap-[8px] mt-[8px]">
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder={t('designer_voiceover_topic_placeholder', 'Topic (or use the script above)…')}
            aria-label={t('designer_voiceover_topic_label', 'Script topic')}
            className={`${inputClass} flex-1`}
          />
          <button
            type="button"
            onClick={handleWriteScript}
            disabled={!canWrite || writing}
            className="px-[12px] py-[8px] rounded-[8px] text-[13px] border border-[#2B5CD3]/40 text-[#2B5CD3] hover:bg-[#2B5CD3]/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            {writing ? t('designer_writing_ellipsis', 'Writing…') : t('designer_write_script_with_ai', 'Write script with AI')}
          </button>
        </div>
      </div>

      <GenerationProviderPicker
        operation="tts"
        dialogKey="voiceover"
        value={provider}
        onChange={handleProviderChange}
        requireCompact={false}
      />

      <div>
        <label htmlFor="voiceover-voice" className="block text-[12px] text-newTextColor/70 mb-[6px]">
          {t('designer_voice_label', 'Voice')} <span className="text-amber-600">*</span>
        </label>
        {isLoading && (
          <div className="text-[13px] text-newTextColor/60">{t('designer_loading_voices', 'Loading voices…')}</div>
        )}
        {error && (
          <div className="text-[13px] text-amber-600">
            {t('designer_voiceover_load_error', 'Could not load voices. Make sure a TTS-capable provider is configured.')}
          </div>
        )}
        {!isLoading && !error && (
          <select
            id="voiceover-voice"
            value={selectedVoice}
            onChange={(e) => setSelectedVoice(e.target.value)}
            className={inputClass}
          >
            <option value="" disabled>
              {t('designer_choose_a_voice_option', 'Choose a voice…')}
            </option>
            {(voices || []).map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.label}
              </option>
            ))}
          </select>
        )}
      </div>

      <div>
        <label htmlFor="voiceover-tone" className="block text-[12px] text-newTextColor/70 mb-[6px]">
          {t('designer_voiceover_tone_label', 'Tone / style (optional)')}
        </label>
        <input
          id="voiceover-tone"
          type="text"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder={t('designer_voiceover_tone_placeholder', 'e.g. warm and conversational, energetic…')}
          className={inputClass}
        />
        <p className="mt-[4px] text-[11px] text-newTextColor/50">
          {t(
            'designer_voiceover_tone_hint',
            'Tone is applied by voices that support it (OpenAI: gpt-4o-mini-tts); other models ignore it.'
          )}
        </p>
      </div>

      <div className="flex justify-end gap-[8px] pt-[4px]">
        <button
          type="button"
          onClick={onClose}
          className="px-[12px] py-[8px] rounded-[8px] text-[13px] text-textColor hover:bg-studioBorder/30 transition-colors"
        >
          {t('cancel', 'Cancel')}
        </button>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={!canGenerate || generating}
          className="px-[12px] py-[8px] rounded-[8px] text-[13px] bg-[#2B5CD3] text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#244bb0] transition-colors"
        >
          {generating ? t('designer_generating_ellipsis', 'Generating…') : t('generate', 'Generate')}
        </button>
      </div>
    </div>
  );
};
