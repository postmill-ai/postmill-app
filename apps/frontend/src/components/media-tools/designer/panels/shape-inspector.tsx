'use client';

import React, { FC } from 'react';
import { ColorSwatch, SegmentedControl, Slider, Stepper } from '../controls';
import type {
  ArrowHead,
  LineCap,
  LineJoin,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/stroke-style';
import type { DesignerElement, DesignerTextShadow } from '../designer.store';
import { useBrandColors } from './use-brand-colors';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

interface ShapeInspectorProps {
  element: DesignerElement;
  ids: string[];
  store: any;
}

/** The three dash patterns worth a one-click preset; the rest is Illustrator. */
const DASH_PRESETS: { key: string; label: string; labelKey: string; dash?: number[] }[] = [
  { key: 'solid', label: 'Solid', labelKey: 'designer_dash_solid' },
  { key: 'dashed', label: 'Dashed', labelKey: 'designer_dash_dashed', dash: [10, 6] },
  { key: 'dotted', label: 'Dotted', labelKey: 'designer_dash_dotted', dash: [1, 5] },
];

const ARROW_HEADS: { value: ArrowHead; label: string; labelKey: string }[] = [
  { value: 'none', label: 'None', labelKey: 'designer_arrow_none' },
  { value: 'arrow', label: 'Arrow', labelKey: 'designer_arrow_arrow' },
  { value: 'triangle', label: 'Triangle', labelKey: 'designer_arrow_triangle' },
  { value: 'circle', label: 'Circle', labelKey: 'designer_arrow_circle' },
  { value: 'square', label: 'Square', labelKey: 'designer_arrow_square' },
  { value: 'bar', label: 'Bar', labelKey: 'designer_arrow_bar' },
];

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
  /** Stroke options merge — writing the whole object would drop the other keys. */
  const setStroke = (u: Partial<NonNullable<DesignerElement['strokeStyle']>>) =>
    set({ strokeStyle: { ...(element.strokeStyle || {}), ...u } });

  const dashKey =
    DASH_PRESETS.find(
      (d) => JSON.stringify(d.dash || []) === JSON.stringify(element.strokeStyle?.dash || [])
    )?.key || 'solid';

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

        {/* The Illustrator options. Only worth showing once there is a stroke
            to shape — a dash pattern on a zero-width line is invisible. */}
        {(element.strokeWidth || 0) > 0 && (
          <div className="space-y-2">
            <SegmentedControl
              value={dashKey}
              options={DASH_PRESETS.map((d) => ({
                value: d.key,
                label: t(d.labelKey, d.label),
              }))}
              onChange={(key) => {
                const preset = DASH_PRESETS.find((d) => d.key === key);
                setStroke({ dash: preset?.dash });
              }}
            />
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-textColor/50">{t('designer_line_cap', 'Cap')}</span>
                <select
                  value={element.strokeStyle?.lineCap || 'butt'}
                  onChange={(e) => setStroke({ lineCap: e.target.value as LineCap })}
                  className="h-[28px] px-2 rounded-md bg-newBgColor border border-studioBorder text-[12px] text-textColor outline-none"
                >
                  <option value="butt">{t('designer_cap_butt', 'Butt')}</option>
                  <option value="round">{t('designer_cap_round', 'Round')}</option>
                  <option value="square">{t('designer_cap_square', 'Square')}</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-textColor/50">{t('designer_line_join', 'Join')}</span>
                <select
                  value={element.strokeStyle?.lineJoin || 'miter'}
                  onChange={(e) => setStroke({ lineJoin: e.target.value as LineJoin })}
                  className="h-[28px] px-2 rounded-md bg-newBgColor border border-studioBorder text-[12px] text-textColor outline-none"
                >
                  <option value="miter">{t('designer_join_miter', 'Miter')}</option>
                  <option value="round">{t('designer_join_round', 'Round')}</option>
                  <option value="bevel">{t('designer_join_bevel', 'Bevel')}</option>
                </select>
              </label>
            </div>

            {/* Arrowheads only mean anything on an open stroke. */}
            {(element.shape === 'line' || element.type === 'path') && (
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-textColor/50">
                    {t('designer_arrow_start', 'Start')}
                  </span>
                  <select
                    value={element.strokeStyle?.arrowStart || 'none'}
                    onChange={(e) => setStroke({ arrowStart: e.target.value as ArrowHead })}
                    className="h-[28px] px-2 rounded-md bg-newBgColor border border-studioBorder text-[12px] text-textColor outline-none"
                  >
                    {ARROW_HEADS.map((h) => (
                      <option key={h.value} value={h.value}>{t(h.labelKey, h.label)}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-textColor/50">
                    {t('designer_arrow_end', 'End')}
                  </span>
                  <select
                    value={element.strokeStyle?.arrowEnd || 'none'}
                    onChange={(e) => setStroke({ arrowEnd: e.target.value as ArrowHead })}
                    className="h-[28px] px-2 rounded-md bg-newBgColor border border-studioBorder text-[12px] text-textColor outline-none"
                  >
                    {ARROW_HEADS.map((h) => (
                      <option key={h.value} value={h.value}>{t(h.labelKey, h.label)}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </div>
        )}
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
