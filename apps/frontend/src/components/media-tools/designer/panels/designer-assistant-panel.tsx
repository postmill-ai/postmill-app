'use client';

import React, { FC, useState } from 'react';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { ensureFontLoaded } from '../fonts';
import {
  applyDesignerSuggestionAction,
  captureDesignerSuggestionScope,
  designerSuggestionActionStatus,
  designerSuggestionSelection,
  type DesignerSuggestionAction,
  type DesignerSuggestionActionStatus,
  type DesignerSuggestionScope,
} from './designer-assistant-actions';

type Store = ReturnType<typeof import('../designer.store').createDesignerStore>;
type CopyKind = 'headline' | 'promotion' | 'caption' | 'cta';
type Suggestion = {
  category: 'font' | 'color' | 'layout' | 'spacing';
  title: string;
  rationale: string;
  style?: { fontFamily?: string; fill?: string };
  action?: DesignerSuggestionAction;
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
  store((state) => state.selectedIds);
  store((state) => state.currentOutput);
  store((state) => state.currentPage);
  store((state) => state.doc.mode);
  const [kind, setKind] = useState<CopyKind>('headline');
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState<'copy' | 'suggestions' | null>(null);
  const [error, setError] = useState('');
  const [variants, setVariants] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionScope, setSuggestionScope] = useState<DesignerSuggestionScope | null>(null);

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
    if (style.fontFamily) void ensureFontLoaded(style.fontFamily);
    const state = store.getState();
    if (clipTarget) {
      state.updateClip(clipTarget.outputIndex, clipTarget.trackId, clipTarget.clipId, style);
    } else if (selectedElementId) {
      state.updateElement(selectedElementId, style);
      state.pushHistory('Apply design suggestion');
    }
  };
  const actionMessage = (status: DesignerSuggestionActionStatus) => {
    if (status === 'stale') return t('designer_suggestion_stale', 'The selection changed. Run Smart suggestions again.');
    if (status === 'needs-selection') return t('designer_suggestion_needs_selection', 'Select at least one element to apply this suggestion.');
    if (status === 'needs-three') return t('designer_suggestion_needs_three', 'Select at least three elements to apply this suggestion.');
    if (status === 'unsupported') return t('designer_suggestion_static_only', 'Layout actions are available for image designs.');
    return '';
  };
  const applyAction = (action: DesignerSuggestionAction, scope: DesignerSuggestionScope) => {
    const status = applyDesignerSuggestionAction(store, action, scope);
    setError(status === 'ready' ? '' : actionMessage(status));
  };
  const run = async (operation: 'copy' | 'suggestions') => {
    if (loading || (operation === 'copy' && !prompt.trim())) return;
    const scope = captureDesignerSuggestionScope(store);
    const selection = designerSuggestionSelection(store);
    setLoading(operation);
    setError('');
    try {
      const response = await fetch(`/media/designer-assistant/${operation === 'copy' ? 'copy' : 'suggestions'}`, {
        method: 'POST',
        body: JSON.stringify(operation === 'copy'
          ? { kind, prompt: prompt.trim(), selectedText, context }
          : {
              prompt: prompt.trim(),
              context: {
                ...context,
                mode: scope.mode,
                ...(selection.length ? { selection } : {}),
              },
            }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.message || data?.error || t('designer_assistant_failed', 'AI assistant request failed'));
      if (operation === 'copy') setVariants(Array.isArray(data.variants) ? data.variants : []);
      else {
        setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
        setSuggestionScope(scope);
      }
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
      {suggestions.map((suggestion, index) => {
        const status = suggestion.action && suggestionScope
          ? designerSuggestionActionStatus(store, suggestion.action, suggestionScope)
          : null;
        const unavailable = status && status !== 'ready' ? actionMessage(status) : '';
        return (
          <div key={index} className="rounded-md border border-studioBorder p-2 flex flex-col gap-1.5">
            <div className="text-[10px] uppercase tracking-wide text-textColor/40">{t(`designer_suggestion_${suggestion.category}`, suggestion.category)}</div>
            <div className="text-[12px] font-medium text-textColor">{suggestion.title}</div>
            <div className="text-[11px] text-newTextColor/60">{suggestion.rationale}</div>
            {suggestion.style && (
              <button type="button" onClick={() => applyStyle(suggestion.style!)} className="self-start px-2 py-1 rounded-sm border border-studioBorder text-[11px] text-textColor hover:bg-boxHover">
                {t('designer_apply_style', 'Apply style')}
              </button>
            )}
            {suggestion.action && suggestionScope && (
              <>
                <button
                  type="button"
                  disabled={status !== 'ready'}
                  title={unavailable || undefined}
                  onClick={() => applyAction(suggestion.action!, suggestionScope)}
                  className="self-start px-2 py-1 rounded-sm border border-studioBorder text-[11px] text-textColor hover:bg-boxHover disabled:opacity-40"
                >
                  {suggestion.action.type === 'align'
                    ? t('designer_apply_layout', 'Apply layout')
                    : t('designer_apply_spacing', 'Apply spacing')}
                </button>
                {unavailable && <div className="text-[10px] text-newTextColor/60">{unavailable}</div>}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
};
