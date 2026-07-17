'use client';

import React, { useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Slider } from '@gitroom/react/form/slider';
import { Select } from '@gitroom/react/form/select';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface LanguageProfile {
  instructions?: string;
  overrides?: Record<string, string>;
}

interface BrandProfile {
  instructions?: string;
  language?: string;
  enabled?: boolean;
  platformInstructions?: Record<string, string>;
  languageProfiles?: Record<string, LanguageProfile>;
}

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'es', label: 'Spanish' },
  { value: 'pt-BR', label: 'Portuguese (Brazil)' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ar', label: 'Arabic' },
  { value: 'zh-CN', label: 'Chinese (Simplified)' },
  { value: 'zh-TW', label: 'Chinese (Traditional)' },
  { value: 'ko', label: 'Korean' },
  { value: 'it', label: 'Italian' },
  { value: 'nl', label: 'Dutch' },
  { value: 'pl', label: 'Polish' },
  { value: 'ru', label: 'Russian' },
  { value: 'tr', label: 'Turkish' },
  { value: 'hi', label: 'Hindi' },
  { value: 'sv', label: 'Swedish' },
  { value: 'da', label: 'Danish' },
  { value: 'fi', label: 'Finnish' },
];

interface NormalizedProfile {
  instructions: string;
  overrides: Record<string, string>;
}

// Seed the per-language map from the brand. Brands that predate languageProfiles
// migrate their single instructions/overrides set into the active language.
const seedProfiles = (initial?: BrandProfile): Record<string, NormalizedProfile> => {
  const lp = initial?.languageProfiles;
  if (lp && typeof lp === 'object' && Object.keys(lp).length) {
    const out: Record<string, NormalizedProfile> = {};
    for (const [lang, prof] of Object.entries(lp)) {
      out[lang] = {
        instructions: prof?.instructions || '',
        overrides: prof?.overrides || {},
      };
    }
    return out;
  }
  return {
    [initial?.language || 'en']: {
      instructions: initial?.instructions || '',
      overrides: initial?.platformInstructions || {},
    },
  };
};

const BrandVoiceForm = ({ initial, brandId, onMutate }: { initial?: BrandProfile; brandId?: string; onMutate?: () => void }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();

  const [enabled, setEnabled] = useState(initial?.enabled ?? false);
  const [language, setLanguage] = useState(initial?.language || 'en');
  const [languageProfiles, setLanguageProfiles] = useState<Record<string, NormalizedProfile>>(
    () => seedProfiles(initial)
  );
  // The channel currently selected to add/edit an override (within this language).
  const [selectedChannel, setSelectedChannel] = useState('');

  // The dataset for the active language.
  const current = useMemo(
    () => languageProfiles[language] || { instructions: '', overrides: {} },
    [languageProfiles, language]
  );

  // The org's connected (active) channels populate the override dropdown.
  const { data: channelData } = useSWR(
    'brand-voice-channels',
    async () => {
      const res = await fetch('/integrations/list');
      if (!res.ok) return [];
      return (await res.json()).integrations || [];
    },
    { revalidateOnFocus: false, revalidateOnReconnect: false }
  );
  const channels: { id: string; name: string; disabled?: boolean }[] = (
    channelData || []
  ).filter((c: any) => !c.disabled);
  const channelName = (id: string) => channels.find((c) => c.id === id)?.name || id;

  const setInstructions = useCallback((value: string) => {
    setLanguageProfiles((prev) => {
      const cur = prev[language] || { instructions: '', overrides: {} };
      return { ...prev, [language]: { ...cur, instructions: value } };
    });
  }, [language]);

  const setOverride = useCallback((channelId: string, value: string) => {
    setLanguageProfiles((prev) => {
      const cur = prev[language] || { instructions: '', overrides: {} };
      return {
        ...prev,
        [language]: { ...cur, overrides: { ...cur.overrides, [channelId]: value } },
      };
    });
  }, [language]);

  const removeOverride = useCallback((channelId: string) => {
    setLanguageProfiles((prev) => {
      const cur = prev[language] || { instructions: '', overrides: {} };
      const overrides = { ...cur.overrides };
      delete overrides[channelId];
      return { ...prev, [language]: { ...cur, overrides } };
    });
  }, [language]);

  const handleSave = useCallback(async () => {
    // Prune empty override strings; drop languages with no content.
    const prunedProfiles: Record<string, NormalizedProfile> = {};
    for (const [lang, prof] of Object.entries(languageProfiles)) {
      const overrides: Record<string, string> = {};
      for (const [ch, v] of Object.entries(prof.overrides || {})) {
        if (v && v.trim()) overrides[ch] = v;
      }
      if ((prof.instructions && prof.instructions.trim()) || Object.keys(overrides).length) {
        prunedProfiles[lang] = { instructions: prof.instructions || '', overrides };
      }
    }
    // Mirror the active language's profile into the legacy fields so generation
    // (which reads brand.language) keeps working.
    const active = prunedProfiles[language] || { instructions: '', overrides: {} };

    const url = brandId ? `/brands/${brandId}` : '/ai/brand-profile';
    const res = await fetch(url, {
      method: 'PUT',
      body: JSON.stringify({
        enabled,
        language,
        languageProfiles: prunedProfiles,
        instructions: active.instructions,
        platformInstructions: active.overrides,
      }),
    });
    if (!res.ok) {
      toaster.show(t('brand_profile_save_failed', 'Failed to save brand profile'), 'warning');
      return;
    }
    toaster.show(t('brand_profile_saved', 'Brand profile saved'), 'success');
    onMutate?.();
  }, [enabled, language, languageProfiles, fetch, toaster, t, onMutate, brandId]);

  return (
    <div className="my-[16px] mt-[16px] bg-newBgColorInner border-newTableBorder border rounded-[12px] p-[24px] flex flex-col gap-[24px]">
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <div className="text-[14px]">{t('brand_voice', 'Voice & Tone')}</div>
          <div className="text-[12px] text-newTableText">
            {t('brand_voice_description_v2', "Tell the AI how to write for you — like briefing a new team member. It'll follow this every time it creates a post.")}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <div className="text-[14px]">{t('enable_brand_profile', 'Use this brand voice')}</div>
          <div className="text-[12px] text-newTableText">
            {t('enable_brand_profile_description_v2', 'When this is on, the AI follows the instructions below every time it writes for you. Turn it off to pause it.')}
          </div>
        </div>
        <Slider
          value={enabled ? 'on' : 'off'}
          onChange={(value) => setEnabled(value === 'on')}
          fill={true}
        />
      </div>

      {/* Language — selects which language's dataset is being edited below. */}
      <div className="flex items-center justify-between gap-[24px]">
        <div className="flex flex-col flex-1">
          <div className="text-[14px]">{t('brand_language', 'Language')}</div>
          <div className="text-[12px] text-newTableText">
            {t('brand_language_description_v3', "The language the AI writes in. Everything below is for this language — switch it to set up a different language, and your other languages are kept.")}
          </div>
        </div>
        <div className="w-[200px]">
          <Select
            name="brandLanguage"
            label=""
            aria-label={t('brand_language', 'Language')}
            disableForm={true}
            hideErrors={true}
            value={language}
            onChange={(e) => {
              setLanguage(e.target.value);
              setSelectedChannel('');
            }}
          >
            {/* Display-only guard: a brand saved with a now-removed language
                (e.g. legacy 'he') keeps its stored value + profile intact — we
                only surface a synthetic option so the selector isn't blank. */}
            {!LANGUAGES.some((lang) => lang.value === language) && (
              <option value={language}>{language}</option>
            )}
            {LANGUAGES.map((lang) => (
              <option key={lang.value} value={lang.value}>
                {lang.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-[8px]">
        <div className="text-[14px]">{t('brand_instructions', 'How should it write?')}</div>
        <div className="text-[12px] text-newTableText">
          {t('brand_instructions_description_v2', "Describe your style in plain words: the tone to use, words to avoid, whether to use emojis, and how to end a post. There's no wrong answer — write it like you'd explain it to a person.")}
        </div>
        <textarea
          className="bg-newBgColorInner border border-newTableBorder rounded-[8px] min-h-[100px] p-[12px] text-textColor resize-y bg-newBgColor"
          value={current.instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder={t('brand_instructions_placeholder', 'e.g. Keep a friendly and professional tone. Never use emojis. Always include a call-to-action at the end.')}
        />
      </div>

      <div className="flex flex-col gap-[12px]">
        <div className="text-[14px]">{t('channel_overrides', 'Different style for one channel? (optional)')}</div>
        <div className="text-[12px] text-newTableText">
          {t('channel_overrides_description_v2', "Most people can skip this. If you want a different style on one channel — say, more formal on LinkedIn or more playful on TikTok — pick the channel and add special instructions just for it.")}
        </div>

        <div className="w-[250px]">
          <Select
            name="channelSelector"
            label=""
            aria-label={t('select_channel', 'Select Channel')}
            disableForm={true}
            hideErrors={true}
            value={selectedChannel}
            onChange={(e) => setSelectedChannel(e.target.value)}
          >
            <option value="">{t('select_channel', 'Select Channel')}</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>

        {selectedChannel && (
          <div className="flex flex-col gap-[4px]">
            <div className="text-[13px] text-newTableText">
              {t('channel_instructions', 'Instructions for {{channel}}', {
                channel: channelName(selectedChannel),
              })}
            </div>
            <textarea
              className="bg-newBgColorInner border border-newTableBorder rounded-[8px] min-h-[80px] p-[12px] text-textColor resize-y bg-newBgColor text-[13px]"
              value={current.overrides[selectedChannel] || ''}
              onChange={(e) => setOverride(selectedChannel, e.target.value)}
              placeholder={t('channel_instructions_placeholder', 'e.g. Be more casual on this channel')}
            />
          </div>
        )}

        {Object.keys(current.overrides).length > 0 && (
          <div className="flex flex-wrap gap-[6px]">
            {Object.entries(current.overrides).map(([channelId, instr]) =>
              instr ? (
                <div
                  key={channelId}
                  className="bg-newTableHeader border border-newTableBorder rounded-[4px] px-[8px] py-[4px] text-[12px] flex items-center gap-[4px]"
                >
                  <span className="font-medium">{channelName(channelId)}</span>
                  <button
                    onClick={() => removeOverride(channelId)}
                    className="text-red-500 hover:opacity-80 ml-[4px]"
                    aria-label={`Remove ${channelName(channelId)} override`}
                  >
                    ×
                  </button>
                </div>
              ) : null
            )}
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button
          className="bg-btnPrimary text-white rounded-[8px] px-[16px] py-[8px] text-[14px] hover:opacity-90"
          onClick={handleSave}
        >
          {t('save', 'Save')}
        </button>
      </div>
    </div>
  );
};

export const BrandVoice = ({ brandId, initial, onSaved }: { brandId?: string; initial?: BrandProfile; onSaved?: () => void }) => {
  return <BrandVoiceForm key={brandId || 'default'} initial={initial} brandId={brandId} onMutate={onSaved} />;
};
