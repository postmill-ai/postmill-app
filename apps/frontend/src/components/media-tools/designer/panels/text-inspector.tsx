'use client';

import React, { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TextFormatPanel } from './text-format-panel';
import {
  FONT_PAIRINGS,
  RESET_TEXT_STYLE,
  TEXT_STYLE_PRESETS,
  TextStylePreset,
  textStyleFontSize,
  textStylePatch,
} from '../text-styles';
import { usePresetPreview } from '../use-preset-preview';
import { ensureFontLoaded } from '../fonts';
import { sharedStageRef } from '../stage-ref';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import type { DesignerElement } from '../designer.store';
import { DesignerAssistantPanel } from './designer-assistant-panel';
import { TextEffectPresets } from './text-effect-presets';
import { getContrastRatio } from '../contrast';
import {
  pageBackground,
  pageChildren,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.pages';

interface TextInspectorProps {
  store: any;
}

const findTextBackdrop = (
  children: DesignerElement[],
  primary: DesignerElement | undefined
) =>
  primary?.parentId
    ? children.find(
        (element) =>
          element.type === 'shape' &&
          element.name === 'Text Backdrop' &&
          element.parentId === primary.parentId
      )
    : undefined;

const averageColor = (data: Uint8ClampedArray): string => {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  // Sample every 4th pixel for performance; text boxes are usually small.
  for (let i = 0; i < data.length; i += 16) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    count++;
  }
  if (count === 0) return '#ffffff';
  const toHex = (n: number) =>
    Math.round(n / count)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

/**
 * Sample the actual composited pixels behind a text element by temporarily
 * hiding the text node and exporting the stage region it occupies. Falls back
 * to null when the stage is not available (SSR, no canvas mounted, etc.).
 */
const sampleTextBackground = (el: DesignerElement): string | null => {
  if (typeof window === 'undefined') return null;
  const stage = sharedStageRef.current;
  if (!stage) return null;
  const node = stage.findOne('#' + el.id);
  if (!node) return null;

  const rect = node.getClientRect({
    skipTransform: false,
    skipShadow: true,
    skipStroke: true,
  });
  if (!rect.width || !rect.height) return null;

  const wasVisible = node.visible();
  node.visible(false);
  node.getLayer()?.batchDraw();
  try {
    // toCanvas is synchronous in Konva.
    const canvas = stage.toCanvas({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      pixelRatio: 1,
    });
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return averageColor(imageData.data);
  } catch {
    return null;
  } finally {
    node.visible(wasVisible);
    node.getLayer()?.batchDraw();
  }
};

export const TextInspector: FC<TextInspectorProps> = ({ store }) => {
  const t = useT();
  const selectedIds = store((s: any) => s.selectedIds);
  const out = store((s: any) => s.doc.outputs[s.currentOutput]);
  const currentPage = store((s: any) => s.currentPage);

  const textElements = useMemo(() => {
    const children = out ? pageChildren(out, currentPage) : [];
    return children.filter(
      (c: any) => selectedIds.includes(c.id) && c.type === 'text'
    );
  }, [selectedIds, out, currentPage]);

  const { previewAsync, applyAsync, cancel } = usePresetPreview(store);
  const textColorTriggerRef = useRef<HTMLButtonElement>(null);
  const grownHeights = useRef(
    new Map<string, { grownHeight: number; authoredHeight: number }>()
  );
  const stylePatchFor = useCallback(
    (
      preset: TextStylePreset,
      element: DesignerElement,
      canvas: { width: number; height: number }
    ) => {
      const remembered = grownHeights.current.get(element.id);
      if (remembered && remembered.grownHeight !== element.height) {
        grownHeights.current.delete(element.id);
      }
      const canShrink = remembered?.grownHeight === element.height;
      const patch = textStylePatch(preset, element, canvas, {
        shrinkGrownHeight: canShrink,
      });
      if (remembered?.grownHeight === element.height && patch.height !== undefined) {
        patch.height = Math.max(remembered.authoredHeight, patch.height);
      }
      return patch;
    },
    []
  );
  const noteAppliedPatch = useCallback(
    (element: DesignerElement, patch: Partial<DesignerElement>) => {
      if (patch.height === undefined) return;
      const remembered = grownHeights.current.get(element.id);
      const continuing = remembered?.grownHeight === element.height;
      if (patch.height > element.height) {
        grownHeights.current.set(element.id, {
          grownHeight: patch.height,
          authoredHeight: continuing ? remembered.authoredHeight : element.height,
        });
      } else if (continuing && patch.height < element.height) {
        grownHeights.current.set(element.id, {
          ...remembered,
          grownHeight: patch.height,
        });
      } else if (patch.height < element.height) {
        grownHeights.current.delete(element.id);
      }
    },
    []
  );

  const previewPreset = useCallback(
    (preset: TextStylePreset) => {
      if (!textElements.length || !out) return;
      const startingDoc = store.getState().doc;
      void previewAsync(async () => {
        await ensureFontLoaded(
          preset.fontFamily,
          [preset.fontWeight],
          preset.fontStyle === 'italic'
        );
        if (store.getState().doc !== startingDoc) return {};
        return Object.fromEntries(
          textElements.map((element) => [
            element.id,
            stylePatchFor(preset, element, out),
          ])
        );
      });
    },
    [previewAsync, textElements, out, store, stylePatchFor]
  );

  const applyPreset = useCallback(
    (preset: TextStylePreset) => {
      if (!textElements.length) return;
      cancel();
      void applyAsync(async () => {
        await ensureFontLoaded(
          preset.fontFamily,
          [preset.fontWeight],
          preset.fontStyle === 'italic'
        );
        return () => {
          const state = store.getState();
          const output = state.doc.outputs[state.currentOutput];
          const selected = new Set(textElements.map((element) => element.id));
          const current = pageChildren(output, state.currentPage).filter(
            (element: DesignerElement) => selected.has(element.id) && element.type === 'text'
          );
          if (!current.length) return;
          for (const element of current) {
            const patch = stylePatchFor(preset, element, output);
            state.updateElement(element.id, patch);
            noteAppliedPatch(element, patch);
          }
          state.pushHistory();
        };
      });
    },
    [store, textElements, cancel, applyAsync, stylePatchFor, noteAppliedPatch]
  );

  const handleAddBackdrop = useCallback(() => {
    const state = store.getState();
    const output = state.doc.outputs[state.currentOutput];
    const children = pageChildren(output, state.currentPage);
    const primary = children.find(
      (c: DesignerElement) => state.selectedIds.includes(c.id) && c.type === 'text'
    );
    if (!primary || findTextBackdrop(children, primary)) return;

    const backdrop: DesignerElement = {
      id: `backdrop-${Date.now()}`,
      type: 'shape',
      shape: 'rect',
      x: primary.x - 8,
      y: primary.y - 4,
      width: primary.width + 16,
      height: primary.height + 8,
      fill: '#000000',
      opacity: 0.4,
      borderRadius: 4,
      locked: false,
      hidden: false,
      rotation: 0,
      name: 'Text Backdrop',
    };

    store.getState().addElement(backdrop, primary.id);
    store.getState().setSelectedIds([primary.id, backdrop.id]);
    setTimeout(() => store.getState().groupSelection(), 0);
  }, [store]);

  const handleToggleBackdrop = useCallback(() => {
    const state = store.getState();
    const output = state.doc.outputs[state.currentOutput];
    const children = pageChildren(output, state.currentPage);
    const selected = children.find(
      (element: DesignerElement) => state.selectedIds.includes(element.id) && element.type === 'text'
    );
    const backdrop = findTextBackdrop(children, selected);
    if (backdrop) {
      state.removeElement(backdrop.id);
      return;
    }
    handleAddBackdrop();
  }, [handleAddBackdrop, store]);

  const openTextColor = useCallback(() => {
    const trigger = textColorTriggerRef.current;
    trigger?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    trigger?.click();
  }, []);

  const primary = textElements[0];
  const textBackdrop = findTextBackdrop(
    out ? pageChildren(out, currentPage) : [],
    primary
  );
  const textFill = primary?.fill || '#000000';
  const background = out ? pageBackground(out, currentPage) : undefined;
  const heuristicBg =
    background?.type === 'gradient' || background?.type === 'image'
      ? '#808080'
      : background?.type === 'color' && background.color
      ? background.color
      : out?.background || '#ffffff';
  const [sampledBg, setSampledBg] = useState<string | null>(null);
  // Sample only when the element identity/geometry actually changes — keying the
  // effect on a stable primitive string (not the `primary` object reference, which
  // is new on every store mutation) stops the background being re-sampled on every
  // unrelated edit while a text element is selected.
  const sampleKey = primary
    ? `${primary.id}:${primary.x}:${primary.y}:${primary.width}:${primary.height}`
    : '';
  useEffect(() => {
    if (!primary) {
      queueMicrotask(() => setSampledBg(null));
      return;
    }
    queueMicrotask(() => setSampledBg(sampleTextBackground(primary)));
  }, [sampleKey]);
  const bgColor = sampledBg ?? heuristicBg;
  const ratio = primary ? getContrastRatio(textFill, bgColor) ?? 21 : 21;
  const isLowContrast = ratio < 4.5;

  const categories = ['heading', 'subheading', 'body', 'caption'] as const;
  const categoryLabels: Record<string, string> = {
    heading: 'Headings',
    subheading: 'Subheadings',
    body: 'Body',
    caption: 'Captions',
  };

  return (
    <div className="flex flex-col gap-5">
      {textElements.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="text-[12px] font-medium text-textColor/60 uppercase tracking-wider">
              {t('designer_text_styles', 'Text Styles')}
            </div>
            <button
              type="button"
              onMouseEnter={() => previewPreset(RESET_TEXT_STYLE)}
              onMouseLeave={cancel}
              onClick={() => applyPreset(RESET_TEXT_STYLE)}
              className="text-[10px] px-2 py-1 rounded-sm border border-studioBorder text-textColor/60 hover:text-textColor hover:bg-designerAccent/10"
            >
              {t('designer_reset_text_style', 'Reset style')}
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {categories.map((cat) => {
              const presets = TEXT_STYLE_PRESETS.filter((p) => p.category === cat);
              if (!presets.length) return null;
              return (
                <div key={cat}>
                  <div className="text-[10px] font-semibold text-textColor/40 uppercase tracking-wider mb-[6px]">
                    {t(`designer_text_category_${cat}`, categoryLabels[cat])}
                  </div>
                  <div className="flex flex-wrap gap-[6px]">
                    {presets.map((preset) => (
                      <button
                        key={preset.name}
                        type="button"
                        onMouseEnter={() => previewPreset(preset)}
                        onMouseLeave={cancel}
                        onClick={() => applyPreset(preset)}
                        className="px-[10px] py-[6px] rounded-[6px] border border-studioBorder bg-newBgColorInner text-left hover:border-designerAccent hover:bg-studioBorder/10 transition-all"
                        title={`${preset.name}: ${textStyleFontSize(preset, out)}px / ${preset.fontWeight} / ${preset.lineHeight}`}
                      >
                        <div className="flex items-center gap-[6px]">
                          <span className="text-[10px] text-textColor/40 font-medium uppercase tracking-wider w-[20px]">
                            {cat === 'heading' ? 'H' : cat === 'subheading' ? 'SH' : cat === 'body' ? 'B' : 'C'}
                          </span>
                          <span
                            className="text-textColor whitespace-nowrap"
                            style={{
                              fontFamily: `"${preset.fontFamily}"`,
                              fontSize: `${Math.min(preset.fontSize, 18)}px`,
                              fontWeight: preset.fontWeight,
                            }}
                          >
                            {preset.name}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-col gap-2">
            <div className="text-[12px] font-medium text-textColor/60 uppercase tracking-wider">
              {t('designer_pairings', 'Pairings')}
            </div>
            <div className="flex flex-col gap-2">
              {FONT_PAIRINGS.map((pairing) => (
                <div
                  key={pairing.name}
                  className="flex items-center gap-2 rounded-[6px] border border-studioBorder bg-newBgColorInner px-[10px] py-[6px]"
                >
                  <span className="text-xs text-textColor font-medium">{pairing.name}</span>
                  <div className="flex-1" />
                  <button
                    type="button"
                    onMouseEnter={() => previewPreset(pairing.heading)}
                    onMouseLeave={cancel}
                    onClick={() => applyPreset(pairing.heading)}
                    className="text-[10px] px-2 py-1 rounded-sm bg-designerAccent/10 hover:bg-designerAccent/20 text-textColor"
                    title={t('designer_pairing_heading_title', '{{font}} heading', { font: pairing.heading.fontFamily })}
                  >
                    H
                  </button>
                  <button
                    type="button"
                    onMouseEnter={() => previewPreset(pairing.body)}
                    onMouseLeave={cancel}
                    onClick={() => applyPreset(pairing.body)}
                    className="text-[10px] px-2 py-1 rounded-sm bg-designerAccent/10 hover:bg-designerAccent/20 text-textColor"
                    title={t('designer_pairing_body_title', '{{font}} body', { font: pairing.body.fontFamily })}
                  >
                    B
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div
            role="group"
            aria-label={t('designer_readability', 'Readability')}
            className="flex flex-col gap-2"
          >
            {isLowContrast && (
              <div
                role="alert"
                className="flex flex-col gap-2 px-3 py-2 bg-yellow-500/10 border border-yellow-500/30 rounded-sm text-yellow-800 dark:text-yellow-200"
              >
                <div className="flex items-center gap-2 text-sm">
                  <span aria-hidden="true">⚠</span>
                  <span>{t('designer_low_contrast', 'Text is hard to read on this background')}</span>
                </div>
                <div data-testid="designer-contrast-fixes" className="flex flex-nowrap items-center gap-1">
                  <button
                    type="button"
                    className="flex-1 min-w-0 whitespace-nowrap px-1 py-1 bg-yellow-500/20 hover:bg-yellow-500/30 disabled:opacity-50 rounded-sm text-[10px]"
                    onClick={handleAddBackdrop}
                    disabled={!!textBackdrop}
                  >
                    {t('designer_add_backdrop', 'Add backdrop')}
                  </button>
                  <button
                    type="button"
                    className="flex-1 min-w-0 whitespace-nowrap px-1 py-1 bg-yellow-500/20 hover:bg-yellow-500/30 rounded-sm text-[10px]"
                    onClick={() => {
                      store.getState().updateElement(primary.id, { fill: '#000000' });
                    }}
                  >
                    {t('designer_darken_background', 'Darken background')}
                  </button>
                  <button
                    type="button"
                    className="flex-1 min-w-0 whitespace-nowrap px-1 py-1 bg-yellow-500/20 hover:bg-yellow-500/30 rounded-sm text-[10px]"
                    onClick={openTextColor}
                  >
                    {t('designer_text_color', 'Text color')}
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1 text-[12px] text-textColor/80">
                  <span>{t('designer_text_backdrop', 'Text backdrop')}</span>
                  <button
                    type="button"
                    aria-label={t('designer_text_backdrop_info', 'About Text backdrop')}
                    data-tooltip-id="tooltip"
                    data-tooltip-content={t(
                      'designer_text_backdrop_description',
                      'Adds a solid or see-through box behind the text, so it stays readable on busy photos.'
                    )}
                    className="text-textColor/50 hover:text-textColor"
                  >
                    ⓘ
                  </button>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-label={t('designer_text_backdrop', 'Text backdrop')}
                  aria-checked={!!textBackdrop}
                  onClick={handleToggleBackdrop}
                  className={`relative w-[40px] h-[22px] rounded-full transition-colors shrink-0 ${
                    textBackdrop ? 'bg-designerAccent' : 'bg-studioBorder'
                  }`}
                >
                  <span
                    className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] rounded-full bg-white transition-transform ${
                      textBackdrop ? 'translate-x-[18px]' : ''
                    }`}
                  />
                </button>
              </div>
              <p className="text-[10px] leading-[14px] text-textColor/50">
                {t(
                  'designer_text_backdrop_description',
                  'Adds a solid or see-through box behind the text, so it stays readable on busy photos.'
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      <TextEffectPresets store={store} textElements={textElements} />
      <TextFormatPanel store={store} colorTriggerRef={textColorTriggerRef} />
      {primary && (
        <DesignerAssistantPanel
          store={store}
          selectedElementId={primary.id}
          selectedText={primary.text || ''}
          context={{
            type: 'text',
            text: primary.text || '',
            x: primary.x,
            y: primary.y,
            width: primary.width,
            height: primary.height,
            canvasWidth: out.width,
            canvasHeight: out.height,
            fontFamily: primary.fontFamily,
            fill: primary.fill,
          }}
        />
      )}
    </div>
  );
};
