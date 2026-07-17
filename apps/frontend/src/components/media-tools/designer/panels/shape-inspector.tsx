'use client';

import React, { FC } from 'react';
import { ColorSwatch, Slider, Stepper } from '../controls';
import type { DesignerElement, DesignerTextShadow } from '../designer.store';
import { useBrandColors } from './use-brand-colors';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface ShapeInspectorProps {
  element: DesignerElement;
  ids: string[];
  store: any;
}

const DEFAULT_SHADOW: DesignerTextShadow = {
  color: '#000000',
  blur: 4,
  offsetX: 2,
  offsetY: 2,
};

export const ShapeInspector: FC<ShapeInspectorProps> = ({
  element,
  ids,
  store,
}) => {
  const t = useT();
  const updateElements = store((s: any) => s.updateElements);
  const brandColors = useBrandColors();
  const brandEnforcement = store((s: any) => s.brandEnforcement);

  const set = (u: Partial<DesignerElement>) => updateElements(ids, u);

  const shadow = element.boxShadow;

  return (
    <div className="space-y-3">
      <div className="text-[12px] font-medium text-textColor/60 uppercase tracking-wider">
        {t('designer_shape_heading', 'Shape')}
      </div>

      <ColorSwatch
        label={t('fill_button', 'Fill')}
        value={element.fill || '#2B5CD3'}
        onChange={(hex) => set({ fill: hex })}
        brandColors={brandColors}
        brandEnforcement={brandEnforcement}
      />

      <div className="space-y-2">
        <div className="text-[11px] text-textColor/50">{t('designer_label_stroke', 'Stroke')}</div>
        <ColorSwatch
          label={t('color', 'Color')}
          value={element.stroke || '#000000'}
          onChange={(hex) => set({ stroke: hex })}
          brandColors={brandColors}
          brandEnforcement={brandEnforcement}
        />
        <Stepper
          label={t('designer_label_width', 'Width')}
          min={0}
          max={40}
          value={element.strokeWidth || 0}
          onChange={(n) => set({ strokeWidth: n })}
        />
      </div>

      <Stepper
        label={t('designer_label_corner_radius', 'Corner radius')}
        min={0}
        value={element.borderRadius || 0}
        onChange={(n) => set({ borderRadius: n })}
      />

      <div className="flex flex-col gap-2 pt-1 border-t border-studioBorder">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-textColor/50">{t('designer_label_shadow', 'Shadow')}</span>
          <button
            type="button"
            role="switch"
            aria-checked={!!shadow}
            onClick={() =>
              set({
                boxShadow: shadow ? undefined : { ...DEFAULT_SHADOW },
              } as Partial<DesignerElement>)
            }
            className={`relative w-[40px] h-[22px] rounded-full transition-colors ${
              shadow ? 'bg-designerAccent' : 'bg-studioBorder'
            }`}
          >
            <span
              className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] rounded-full bg-white transition-transform ${
                shadow ? 'translate-x-[18px]' : ''
              }`}
            />
          </button>
        </div>
        {shadow && (
          <div className="flex flex-col gap-3">
            <ColorSwatch
              label={t('designer_label_shadow_color', 'Shadow color')}
              value={shadow.color || '#000000'}
              onChange={(hex) =>
                set({
                  boxShadow: { ...shadow, color: hex },
                } as Partial<DesignerElement>)
              }
              brandColors={brandColors}
              brandEnforcement={brandEnforcement}
            />
            <Slider
              label={t('designer_label_blur', 'Blur')}
              min={0}
              max={40}
              value={shadow.blur}
              onChange={(n) =>
                set({
                  boxShadow: { ...shadow, blur: n },
                } as Partial<DesignerElement>)
              }
            />
            <Slider
              label={t('designer_label_offset_x', 'Offset X')}
              min={-40}
              max={40}
              value={shadow.offsetX}
              onChange={(n) =>
                set({
                  boxShadow: { ...shadow, offsetX: n },
                } as Partial<DesignerElement>)
              }
            />
            <Slider
              label={t('designer_label_offset_y', 'Offset Y')}
              min={-40}
              max={40}
              value={shadow.offsetY}
              onChange={(n) =>
                set({
                  boxShadow: { ...shadow, offsetY: n },
                } as Partial<DesignerElement>)
              }
            />
          </div>
        )}
      </div>
    </div>
  );
};
