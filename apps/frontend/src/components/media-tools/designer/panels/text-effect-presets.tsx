'use client';

import React, { FC } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { pageChildren } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.pages';
import type { DesignerElement } from '../designer.store';
import { defaultStyle } from '../layer-actions';
import { usePresetPreview } from '../use-preset-preview';

export type TextEffectKind = 'arc' | 'wave' | 'circle' | 'gradient' | 'outline' | 'shadow' | 'extrusion';

export const textEffectPatch = (
  kind: TextEffectKind,
  element: DesignerElement
): Partial<DesignerElement> => {
  const w = element.width;
  const h = element.height;
  switch (kind) {
    case 'arc':
      return { curve: 45, textPath: undefined };
    case 'wave': {
      const cy = h / 2;
      const amp = Math.max(10, h * 0.15);
      return {
        curve: 0,
        textPath: `M 0,${cy} Q ${w / 4},${cy - amp} ${w / 2},${cy} Q ${(w * 3) / 4},${cy + amp} ${w},${cy}`,
      };
    }
    case 'circle': {
      const r = Math.min(w, h) * 0.4;
      const top = h * 0.1;
      return {
        curve: 0,
        textPath: `M ${w / 2},${top} A ${r},${r} 0 1,1 ${w / 2 - 0.01},${top}`,
      };
    }
    case 'gradient':
      return {
        fillGradient: {
          type: 'linear',
          angle: 0,
          stops: [
            { offset: 0, color: '#2B5CD3' },
            { offset: 1, color: '#A855F7' },
          ],
        },
      };
    case 'outline':
      return { textStroke: { color: '#000000', width: 2 } };
    case 'shadow':
      return { textShadow: { color: '#00000080', blur: 8, offsetX: 4, offsetY: 4 } };
    case 'extrusion':
      return {
        styles: [
          ...(element.styles || []).filter((style) => style.type !== 'extrusion'),
          defaultStyle('extrusion'),
        ],
      };
  }
};

export const textEffectResetPatch = (
  kind: TextEffectKind,
  element: DesignerElement
): Partial<DesignerElement> => {
  switch (kind) {
    case 'arc':
    case 'wave':
    case 'circle':
      return { curve: 0, textPath: undefined };
    case 'gradient':
      return { fillGradient: undefined };
    case 'outline':
      return { textStroke: undefined };
    case 'shadow':
      return { textShadow: undefined };
    case 'extrusion':
      return {
        styles: (element.styles || []).filter((style) => style.type !== 'extrusion'),
      };
  }
};

export const TextEffectPresets: FC<{
  store: any;
  textElements: DesignerElement[];
}> = ({ store, textElements }) => {
  const t = useT();
  const { preview, cancel } = usePresetPreview(store);
  if (!textElements.length) return null;
  const effects: { kind: TextEffectKind; key: string; label: string }[] = [
    { kind: 'arc', key: 'designer_path_arc', label: 'Arc text' },
    { kind: 'wave', key: 'designer_path_wave', label: 'Wave text' },
    { kind: 'circle', key: 'designer_mask_circle', label: 'Circle text' },
    { kind: 'gradient', key: 'designer_gradient', label: 'Gradient text' },
    { kind: 'outline', key: 'designer_label_outline', label: 'Text outline' },
    { kind: 'shadow', key: 'designer_label_drop_shadow', label: 'Text shadow' },
    { kind: 'extrusion', key: 'designer_style_extrusion', label: '3D Extrusion' },
  ];
  const previewEffect = (kind: TextEffectKind, reset = false) => {
    preview(Object.fromEntries(
      textElements.map((element) => [
        element.id,
        reset ? textEffectResetPatch(kind, element) : textEffectPatch(kind, element),
      ])
    ));
  };
  const applyEffect = (kind: TextEffectKind, reset = false) => {
    cancel();
    const state = store.getState();
    const output = state.doc.outputs[state.currentOutput];
    const selected = new Set(textElements.map((element) => element.id));
    const current = pageChildren(output, state.currentPage).filter(
      (element: DesignerElement) => selected.has(element.id) && element.type === 'text'
    );
    for (const element of current) {
      state.updateElement(
        element.id,
        reset ? textEffectResetPatch(kind, element) : textEffectPatch(kind, element)
      );
    }
    state.pushHistory();
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[12px] font-medium text-textColor/60 uppercase tracking-wider">
        {t('designer_effects_heading', 'Text Effects')}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {effects.map((effect) => {
          const label = t(effect.key, effect.label);
          return (
            <div key={effect.kind} className="flex rounded-md border border-studioBorder bg-newBgColorInner overflow-hidden">
              <button
                type="button"
                onMouseEnter={() => previewEffect(effect.kind)}
                onMouseLeave={cancel}
                onClick={() => applyEffect(effect.kind)}
                className="px-2.5 py-1.5 text-[11px] text-textColor hover:bg-designerAccent/10"
              >
                {label}
              </button>
              <button
                type="button"
                aria-label={t('designer_reset_named_effect', 'Reset {{effect}}', { effect: label })}
                title={t('designer_none', 'None')}
                onMouseEnter={() => previewEffect(effect.kind, true)}
                onMouseLeave={cancel}
                onClick={() => applyEffect(effect.kind, true)}
                className="px-1.5 py-1.5 border-s border-studioBorder text-[10px] text-textColor/50 hover:bg-designerAccent/10 hover:text-textColor"
              >
                {t('designer_none_short', 'None')}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
