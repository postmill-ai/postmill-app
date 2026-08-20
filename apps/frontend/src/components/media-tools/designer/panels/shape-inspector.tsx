'use client';

import React, { FC } from 'react';
import { ColorSwatch, SegmentedControl, Slider, Stepper } from '../controls';
import type {
  ArrowHead,
  LineCap,
  LineJoin,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/stroke-style';
import { WARP_PRESETS } from '@postmill-ai/nestjs-libraries/media/designer-doc/warp';
import type { DesignerElement } from '../designer.store';
import { useBrandColors } from './use-brand-colors';
import { ShadowSection, BackdropSection } from './shadow-section';
import { FillSection } from './fill-section';
import { cornerRadii } from '@postmill-ai/nestjs-libraries/media/designer-doc/shape-geometry';

const CORNER_LABELS = [
  { key: 'tl', label: 'Top left', labelKey: 'designer_corner_top_left' },
  { key: 'tr', label: 'Top right', labelKey: 'designer_corner_top_right' },
  { key: 'br', label: 'Bottom right', labelKey: 'designer_corner_bottom_right' },
  { key: 'bl', label: 'Bottom left', labelKey: 'designer_corner_bottom_left' },
];
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


  /** Pen output shares this inspector; a few controls only mean something on a shape. */
  const isPath = element.type === 'path';
  const perCorner = Array.isArray(element.borderRadius);
  const maxRadius = Math.floor(Math.min(element.width, element.height) / 2);
  const corners = cornerRadii(element.borderRadius, element.width, element.height);
  /** An open path fills its chord, so both renderers skip the fill entirely. */
  const canFill = !isPath || !!element.closed;

  return (
    <div className="space-y-3">
      <div className="text-[12px] font-medium text-textColor/60 uppercase tracking-wider">
        {isPath ? t('designer_path_heading', 'Path') : t('designer_shape_heading', 'Shape')}
      </div>

      {canFill && (
        <FillSection
          element={element}
          set={set}
          brandColors={brandColors}
          brandEnforcement={brandEnforcement}
        />
      )}

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
                  className="h-[28px] px-2 rounded-md bg-newBgColor border border-studioBorder text-[12px] text-textColor outline-hidden"
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
                  className="h-[28px] px-2 rounded-md bg-newBgColor border border-studioBorder text-[12px] text-textColor outline-hidden"
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
                    className="h-[28px] px-2 rounded-md bg-newBgColor border border-studioBorder text-[12px] text-textColor outline-hidden"
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
                    className="h-[28px] px-2 rounded-md bg-newBgColor border border-studioBorder text-[12px] text-textColor outline-hidden"
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

      {/* Warp — the deformation is non-destructive, so the geometry above is
          untouched and dialling Bend back to 0 restores the original. */}
      <div className="space-y-2 pt-1 border-t border-studioBorder">
        <label htmlFor="shape-warp-preset" className="text-[11px] text-textColor/50">
          {t('designer_label_warp', 'Warp')}
        </label>
        <select
          id="shape-warp-preset"
          value={element.warp?.preset || ''}
          onChange={(e) =>
            set({
              warp: e.target.value
                ? {
                    ...(element.warp || {}),
                    preset: e.target.value as NonNullable<DesignerElement['warp']>['preset'],
                    // A preset with no bend is the identity, which reads as
                    // "nothing happened" — start it somewhere visible.
                    bend: element.warp?.bend ?? 30,
                  }
                : undefined,
            })
          }
          className="w-full h-[28px] px-2 rounded-md bg-newBgColor border border-studioBorder text-[12px] text-textColor outline-hidden"
        >
          <option value="">{t('designer_warp_none', 'None')}</option>
          {WARP_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {t(`designer_warp_${p.value}`, p.label)}
            </option>
          ))}
        </select>

        {element.warp?.preset && (
          <>
            <Slider
              label={t('designer_label_bend', 'Bend')}
              min={-100}
              max={100}
              value={element.warp.bend ?? 0}
              onChange={(n) => set({ warp: { ...element.warp!, bend: n } })}
            />
            <Slider
              label={t('designer_label_distort_h', 'Horizontal distortion')}
              min={-100}
              max={100}
              value={element.warp.distortH ?? 0}
              onChange={(n) => set({ warp: { ...element.warp!, distortH: n } })}
            />
            <Slider
              label={t('designer_label_distort_v', 'Vertical distortion')}
              min={-100}
              max={100}
              value={element.warp.distortV ?? 0}
              onChange={(n) => set({ warp: { ...element.warp!, distortV: n } })}
            />
          </>
        )}
      </div>

      {/* Star points and polygon sides were set once from the tool options bar
          at creation and appeared in NO inspector — draw a five-point star and
          you could never make it six. */}
      {element.shape === 'star' && (
        <>
          <Stepper
            label={t('designer_label_points', 'Points')}
            min={3}
            max={24}
            value={element.sides || 5}
            onChange={(n) => set({ sides: n })}
          />
          <Slider
            label={t('designer_label_inner_radius', 'Inner radius')}
            min={10}
            max={90}
            suffix="%"
            value={Math.round((element.innerRatio ?? 0.5) * 100)}
            onChange={(n) => set({ innerRatio: n / 100 })}
          />
        </>
      )}

      {element.shape === 'polygon' && (
        <Stepper
          label={t('designer_label_sides', 'Sides')}
          min={3}
          max={24}
          value={element.sides || 6}
          onChange={(n) => set({ sides: n })}
        />
      )}

      {/* borderRadius is a Rect prop — neither renderer reads it for a path. */}
      {!isPath && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-textColor/50">
              {t('designer_label_corner_radius', 'Corner radius')}
            </span>
            <button
              type="button"
              aria-pressed={perCorner}
              onClick={() =>
                set({
                  borderRadius: perCorner
                    ? corners[0]
                    : ([corners[0], corners[0], corners[0], corners[0]] as [
                        number,
                        number,
                        number,
                        number
                      ]),
                } as Partial<DesignerElement>)
              }
              className={`text-[11px] px-2 h-[22px] rounded-md border ${
                perCorner
                  ? 'border-designerAccent text-designerAccent'
                  : 'border-studioBorder text-textColor/60'
              }`}
            >
              {t('designer_per_corner', 'Per corner')}
            </button>
          </div>
          {perCorner ? (
            <div className="grid grid-cols-2 gap-2">
              {CORNER_LABELS.map((corner, i) => (
                <Stepper
                  key={corner.key}
                  label={t(corner.labelKey, corner.label)}
                  min={0}
                  max={maxRadius}
                  value={corners[i]}
                  onChange={(n) =>
                    set({
                      borderRadius: corners.map((c, ci) => (ci === i ? n : c)) as [
                        number,
                        number,
                        number,
                        number
                      ],
                    } as Partial<DesignerElement>)
                  }
                />
              ))}
            </div>
          ) : (
            <Stepper
              label={t('designer_label_corner_radius', 'Corner radius')}
              min={0}
              max={maxRadius}
              value={corners[0]}
              onChange={(n) => set({ borderRadius: n })}
            />
          )}
        </div>
      )}

      <BackdropSection element={element} set={set} />

      <ShadowSection
        element={element}
        set={set}
        brandColors={brandColors}
        brandEnforcement={brandEnforcement}
      />
    </div>
  );
};
