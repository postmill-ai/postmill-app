'use client';

import React, { FC, useCallback, useEffect, useMemo, useState } from 'react';
import { TextFormatPanel } from './text-format-panel';
import { TEXT_STYLE_PRESETS, TextStylePreset, FONT_PAIRINGS } from '../text-styles';
import { ensureFontLoaded } from '../fonts';
import { sharedStageRef } from '../stage-ref';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import type { DesignerElement } from '../designer.store';

interface TextInspectorProps {
  store: any;
}

const getContrastRatio = (fg: string, bg: string): number => {
  const getLuminance = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const toLinear = (c: number) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  };
  const l1 = getLuminance(fg);
  const l2 = getLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
};

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

  const textElements = useMemo(() => {
    const children = out?.children ?? [];
    return children.filter(
      (c: any) => selectedIds.includes(c.id) && c.type === 'text'
    );
  }, [selectedIds, out]);

  const applyPreset = useCallback(
    (preset: TextStylePreset) => {
      if (!textElements.length) return;
      void ensureFontLoaded(preset.fontFamily);
      store.getState().updateElements(
        textElements.map((el: any) => el.id),
        {
          fontFamily: preset.fontFamily,
          fontSize: preset.fontSize,
          fontWeight: preset.fontWeight,
          lineHeight: preset.lineHeight,
          letterSpacing: preset.letterSpacing,
          fill: preset.fill,
        }
      );
    },
    [store, textElements]
  );

  const applyPairingPreset = useCallback(
    (preset: TextStylePreset) => {
      if (!textElements.length) return;
      void ensureFontLoaded(preset.fontFamily);
      store.getState().updateElements(
        textElements.map((el: any) => el.id),
        {
          fontFamily: preset.fontFamily,
          fontSize: preset.fontSize,
          fontWeight: preset.fontWeight,
          lineHeight: preset.lineHeight,
          letterSpacing: preset.letterSpacing,
        }
      );
    },
    [store, textElements]
  );

  const handleAddBackdrop = useCallback(() => {
    const state = store.getState();
    const output = state.doc.outputs[state.currentOutput];
    const primary = output.children.find((c: DesignerElement) => state.selectedIds.includes(c.id));
    if (!primary) return;

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

  const primary = textElements[0];
  const textFill = primary?.fill || '#000000';
  const heuristicBg =
    out?.bg?.type === 'gradient' || out?.bg?.type === 'image'
      ? '#808080'
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
  const ratio = primary ? getContrastRatio(textFill, bgColor) : 21;
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
          <div className="text-[12px] font-medium text-textColor/60 uppercase tracking-wider">
            {t('designer_text_styles', 'Text Styles')}
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
                        onClick={() => applyPreset(preset)}
                        className="px-[10px] py-[6px] rounded-[6px] border border-studioBorder bg-newBgColorInner text-left hover:border-designerAccent hover:bg-studioBorder/10 transition-all"
                        title={`${preset.name}: ${preset.fontSize}px / ${preset.fontWeight} / ${preset.lineHeight}`}
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
                    onClick={() => applyPairingPreset(pairing.heading)}
                    className="text-[10px] px-2 py-1 rounded bg-designerAccent/10 hover:bg-designerAccent/20 text-textColor"
                    title={t('designer_pairing_heading_title', '{{font}} heading', { font: pairing.heading.fontFamily })}
                  >
                    H
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPairingPreset(pairing.body)}
                    className="text-[10px] px-2 py-1 rounded bg-designerAccent/10 hover:bg-designerAccent/20 text-textColor"
                    title={t('designer_pairing_body_title', '{{font}} body', { font: pairing.body.fontFamily })}
                  >
                    B
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <button
              className="w-full px-3 py-2 bg-designerAccent/10 hover:bg-designerAccent/20 text-sm rounded border border-designerAccent/30 text-left"
              onClick={handleAddBackdrop}
            >
              {t('designer_add_text_backdrop', 'Add Text Backdrop')}
            </button>

            {isLowContrast && (
              <div className="flex items-center gap-2 px-3 py-2 bg-yellow-500/10 border border-yellow-500/30 rounded text-sm text-yellow-400">
                <span>{t('designer_low_contrast', '⚠ Low contrast ({{ratio}}:1)', { ratio: ratio.toFixed(1) })}</span>
                <button
                  className="px-2 py-0.5 bg-yellow-500/20 hover:bg-yellow-500/30 rounded text-xs"
                  onClick={handleAddBackdrop}
                >
                  {t('designer_add_backdrop', 'Add backdrop')}
                </button>
                <button
                  className="px-2 py-0.5 bg-yellow-500/20 hover:bg-yellow-500/30 rounded text-xs"
                  onClick={() => {
                    store.getState().updateElement(primary.id, { fill: '#000000' });
                  }}
                >
                  {t('designer_darken', 'Darken')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <TextFormatPanel store={store} />
    </div>
  );
};
