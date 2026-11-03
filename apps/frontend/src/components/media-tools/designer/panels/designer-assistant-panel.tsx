'use client';

import React, { FC, useState } from 'react';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

type Store = ReturnType<typeof import('../designer.store').createDesignerStore>;
type CopyKind = 'headline' | 'promotion' | 'caption' | 'cta';
type Suggestion = {
  category: 'font' | 'color' | 'layout' | 'spacing';
  title: string;
  rationale: string;
  style?: { fontFamily?: string; fill?: string };
};

export const DesignerAssistantPanel: FC<{
  store: Store;
  selectedElementId?: string;
  clipTarget?: { outputIndex: number; trackId: string; clipId: string };
  selectedText: string;
  context: Record<string, unknown>;
}> = ({ store, selectedElementId, clipTarget, selectedText, context }) => {
  const t = useT();
  const fetch = useFetch();
  const [kind, setKind] = useState<CopyKind>('headline');
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState<'copy' | 'suggestions' | null>(null);
  const [error, setError] = useState('');
  const [variants, setVariants] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  const applyText = (text: string) => {
    const state = store.getState();
    if (clipTarget) {
      state.updateClip(clipTarget.outputIndex, clipTarget.trackId, clipTarget.clipId, { text });
    } else if (selectedElementId) {
      state.updateElement(selectedElementId, { text, richText: undefined });
      state.pushHistory('Apply AI copy');
    }
  };
  const applyStyle = (style: NonNullable<Suggestion['style']>) => {
    const state = store.getState();
    if (clipTarget) {
      state.updateClip(clipTarget.outputIndex, clipTarget.trackId, clipTarget.clipId, style);
    } else if (selectedElementId) {
      state.updateElement(selectedElementId, style);
      state.pushHistory('Apply design suggestion');
    }
  };
  const run = async (operation: 'copy' | 'suggestions') => {
    if (loading || (operation === 'copy' && !prompt.trim())) return;
    setLoading(operation);
    setError('');
    try {
      const response = await fetch(`/media/designer-assistant/${operation === 'copy' ? 'copy' : 'suggestions'}`, {
        method: 'POST',
        body: JSON.stringify(operation === 'copy'
          ? { kind, prompt: prompt.trim(), selectedText, context }
          : { prompt: prompt.trim(), context }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.message || data?.error || t('designer_assistant_failed', 'AI assistant request failed'));
      if (operation === 'copy') setVariants(Array.isArray(data.variants) ? data.variants : []);
      else setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
    } catch (err) {
      setError((err as Error).message || t('designer_assistant_failed', 'AI assistant request failed'));
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="flex flex-col gap-3 pt-3 border-t border-studioBorder">
      <div className="text-[12px] font-medium text-textColor/60 uppercase tracking-wider">
        {t('designer_ai_assistant', 'AI Content Assistant')}
      </div>
      <label className="text-[11px] text-textColor/60 flex flex-col gap-1">
        {t('designer_copy_type', 'Copy type')}
        <select value={kind} onChange={(event) => setKind(event.target.value as CopyKind)} className="h-8 rounded-sm border border-studioBorder bg-newBgColor px-2 text-[12px] text-textColor">
          <option value="headline">{t('designer_copy_headline', 'Headline')}</option>
          <option value="promotion">{t('designer_copy_promotion', 'Promotional copy')}</option>
          <option value="caption">{t('designer_copy_caption', 'Caption')}</option>
          <option value="cta">{t('designer_copy_cta', 'Call to action')}</option>
        </select>
      </label>
      <textarea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        aria-label={t('designer_assistant_brief', 'Design brief')}
        placeholder={t('designer_assistant_brief_placeholder', 'Describe the audience and goal…')}
        className="min-h-[64px] rounded-sm border border-studioBorder bg-newBgColor p-2 text-[12px] text-textColor placeholder:text-textColor/40"
      />
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={!!loading || !prompt.trim()} onClick={() => run('copy')} className="px-2 py-1.5 rounded-sm border border-designerAccent/30 text-[11px] text-btnPrimaryAccent hover:bg-designerAccent/10 disabled:opacity-40">
          {loading === 'copy' ? t('designer_generating_ellipsis', 'Generating…') : t('designer_generate_copy', 'Generate copy')}
        </button>
        <button type="button" disabled={!!loading} onClick={() => run('suggestions')} className="px-2 py-1.5 rounded-sm border border-studioBorder text-[11px] text-textColor hover:bg-boxHover disabled:opacity-40">
          {loading === 'suggestions' ? t('designer_reviewing_ellipsis', 'Reviewing…') : t('designer_smart_suggestions', 'Smart suggestions')}
        </button>
      </div>
      {error && <div role="alert" className="text-[11px] text-dangerText">{error}</div>}
      {variants.map((variant, index) => (
        <div key={index} className="rounded-md border border-studioBorder p-2 flex flex-col gap-2">
          <div className="text-[12px] text-textColor whitespace-pre-wrap">{variant}</div>
          <button type="button" onClick={() => applyText(variant)} className="self-start px-2 py-1 rounded-sm border border-studioBorder text-[11px] text-textColor hover:bg-boxHover">
            {t('designer_apply_text', 'Apply text')}
          </button>
        </div>
      ))}
      {suggestions.map((suggestion, index) => (
        <div key={index} className="rounded-md border border-studioBorder p-2 flex flex-col gap-1.5">
          <div className="text-[10px] uppercase tracking-wide text-textColor/40">{t(`designer_suggestion_${suggestion.category}`, suggestion.category)}</div>
          <div className="text-[12px] font-medium text-textColor">{suggestion.title}</div>
          <div className="text-[11px] text-newTextColor/60">{suggestion.rationale}</div>
          {suggestion.style && (
            <button type="button" onClick={() => applyStyle(suggestion.style!)} className="self-start px-2 py-1 rounded-sm border border-studioBorder text-[11px] text-textColor hover:bg-boxHover">
              {t('designer_apply_style', 'Apply style')}
            </button>
          )}
        </div>
      ))}
    </div>
  );
};
