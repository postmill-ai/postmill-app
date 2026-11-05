'use client';

import React, { FC } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import type { DesignerElement } from '../designer.store';
import { defaultStyle } from '../layer-actions';

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

export const TextEffectPresets: FC<{
  store: any;
  textElements: DesignerElement[];
}> = ({ store, textElements }) => {
  const t = useT();
  if (!textElements.length) return null;
  const primary = textElements[0];
  const effects: { kind: TextEffectKind; key: string; label: string }[] = [
    { kind: 'arc', key: 'designer_path_arc', label: 'Arc text' },
    { kind: 'wave', key: 'designer_path_wave', label: 'Wave text' },
    { kind: 'circle', key: 'designer_mask_circle', label: 'Circle text' },
    { kind: 'gradient', key: 'designer_gradient', label: 'Gradient text' },
    { kind: 'outline', key: 'designer_label_outline', label: 'Text outline' },
    { kind: 'shadow', key: 'designer_label_drop_shadow', label: 'Text shadow' },
    { kind: 'extrusion', key: 'designer_style_extrusion', label: '3D Extrusion' },
  ];
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[12px] font-medium text-textColor/60 uppercase tracking-wider">
        {t('designer_effects_heading', 'Text Effects')}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {effects.map((effect) => (
          <button
            key={effect.kind}
            type="button"
            onClick={() => store.getState().updateElements(
              textElements.map((element) => element.id),
              textEffectPatch(effect.kind, primary)
            )}
            className="px-2.5 py-1.5 rounded-md border border-studioBorder bg-newBgColorInner text-[11px] text-textColor hover:border-designerAccent hover:bg-designerAccent/10"
          >
            {t(effect.key, effect.label)}
          </button>
        ))}
      </div>
    </div>
  );
};
