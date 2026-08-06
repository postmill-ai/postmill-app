'use client';

import React, { FC } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import {
  EyeIcon,
  EyeOffIcon,
} from '@postmill-ai/frontend/components/ui/icons/designer-tools';
import {
  LAYER_STYLE_DESCRIPTORS,
  layerStyleDescriptor,
  type LayerStyleParam,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/layer-style-descriptors';
import type { DesignerLayerStyle } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import { ColorSwatch, SegmentedControl, Slider } from '../controls';
import { GradientEditor } from '../controls/gradient-editor';
import { defaultStyle } from '../layer-actions';
import { useBrandColors } from './use-brand-colors';
import type { DesignerElement } from '../designer.store';

/**
 * A layer's effects, editable.
 *
 * The Layer Style menu could only ever *add* an effect at its defaults — every
 * parameter was stored and none was reachable, so a glow was whatever colour
 * `defaultStyle` happened to pick. This is the panel that was missing.
 *
 * The controls are generated from `LAYER_STYLE_DESCRIPTORS` rather than
 * hand-built ten times, which is also what keeps every range inside what the
 * schema will accept on save.
 */

interface EffectsListProps {
  element: DesignerElement;
  ids: string[];
  store: any;
}

const POSITIONS: { value: NonNullable<DesignerLayerStyle['position']>; label: string }[] = [
  { value: 'outside', label: 'Outside' },
  { value: 'center', label: 'Center' },
  { value: 'inside', label: 'Inside' },
];

export const EffectsList: FC<EffectsListProps> = ({ element, ids, store }) => {
  const t = useT();
  const brandColors = useBrandColors();
  const brandEnforcement = store((s: any) => s.brandEnforcement);
  const updateElements = store((s: any) => s.updateElements);

  const styles = element.styles || [];

  const write = (next: DesignerLayerStyle[], commit = true) => {
    updateElements(ids, { styles: next.length ? next : undefined });
    if (commit) store.getState().pushHistory();
  };

  const patch = (index: number, u: Partial<DesignerLayerStyle>, commit = true) =>
    write(
      styles.map((s, i) => (i === index ? { ...s, ...u } : s)),
      commit
    );

  const add = (type: DesignerLayerStyle['type']) => {
    // One of each: adding an effect a layer already has retunes it rather than
    // stacking a second invisible copy, which is what the Layer menu does too.
    write([...styles.filter((s) => s.type !== type), defaultStyle(type)]);
  };

  const remove = (index: number) => write(styles.filter((_, i) => i !== index));

  const value = (style: DesignerLayerStyle, param: LayerStyleParam): number => {
    const raw = style[param.key];
    return typeof raw === 'number' ? raw : param.min;
  };

  return (
    <div data-testid="effects-list" className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[12px] font-medium text-textColor/60 uppercase tracking-wider">
          {t('designer_effects_heading', 'Effects')}
        </div>
        <select
          aria-label={t('designer_add_effect', 'Add effect')}
          value=""
          onChange={(e) => {
            if (e.target.value) add(e.target.value as DesignerLayerStyle['type']);
          }}
          className="h-[26px] px-2 rounded-md bg-newBgColor border border-studioBorder text-[12px] text-textColor outline-none"
        >
          <option value="">{t('designer_add_effect', 'Add effect')}</option>
          {LAYER_STYLE_DESCRIPTORS.map((d) => (
            <option key={d.type} value={d.type}>
              {t(`designer_style_${d.type}`, d.label)}
            </option>
          ))}
        </select>
      </div>

      {!styles.length && (
        <div className="text-[11px] text-textColor/40">
          {t('designer_no_effects', 'No effects on this layer.')}
        </div>
      )}

      {styles.map((style, index) => {
        const descriptor = layerStyleDescriptor(style.type);
        if (!descriptor) return null;
        const on = style.enabled !== false;
        const label = t(`designer_style_${style.type}`, descriptor.label);

        return (
          <div
            key={`${style.type}-${index}`}
            className="rounded-[8px] border border-studioBorder p-2 space-y-2"
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label={on ? t('designer_hide_effect', 'Hide effect') : t('designer_show_effect', 'Show effect')}
                aria-pressed={on}
                onClick={() => patch(index, { enabled: !on })}
                className="text-textColor/60 hover:text-textColor"
              >
                {on ? <EyeIcon size={14} /> : <EyeOffIcon size={14} />}
              </button>
              <span className="flex-1 text-[12px] text-textColor">{label}</span>
              <button
                type="button"
                aria-label={t('designer_remove_effect', 'Remove {{name}}', { name: label })}
                onClick={() => remove(index)}
                className="text-textColor/40 hover:text-textColor text-[13px] leading-none"
              >
                ✕
              </button>
            </div>

            {on && (
              <div className="space-y-2">
                {descriptor.color && (
                  <ColorSwatch
                    label={t('color', 'Color')}
                    value={style.color || '#000000'}
                    onChange={(hex) => patch(index, { color: hex })}
                    brandColors={brandColors}
                    brandEnforcement={brandEnforcement}
                  />
                )}

                {descriptor.highlight && (
                  <ColorSwatch
                    label={t('designer_style_highlight', 'Highlight')}
                    value={style.highlightColor || '#ffffff'}
                    onChange={(hex) => patch(index, { highlightColor: hex })}
                    brandColors={brandColors}
                    brandEnforcement={brandEnforcement}
                  />
                )}

                {descriptor.gradient ? (
                  <GradientEditor
                    value={style.gradient}
                    onChange={(g) => patch(index, { gradient: g }, false)}
                    onCommit={() => store.getState().pushHistory()}
                    brandColors={brandColors}
                    brandEnforcement={brandEnforcement}
                  />
                ) : null}

                {descriptor.pattern && style.pattern && (
                  <ColorSwatch
                    label={t('color', 'Color')}
                    value={style.pattern.color || '#000000'}
                    onChange={(hex) =>
                      patch(index, { pattern: { ...style.pattern!, color: hex } })
                    }
                    brandColors={brandColors}
                    brandEnforcement={brandEnforcement}
                  />
                )}

                {descriptor.position && (
                  <SegmentedControl
                    value={style.position || 'outside'}
                    options={POSITIONS.map((p) => ({
                      value: p.value,
                      label: t(`designer_stroke_${p.value}`, p.label),
                    }))}
                    onChange={(v) =>
                      patch(index, { position: v as DesignerLayerStyle['position'] })
                    }
                  />
                )}

                {descriptor.params.map((param) => (
                  <Slider
                    key={param.key}
                    label={t(`designer_style_param_${param.key}`, param.label)}
                    min={param.min}
                    max={param.max}
                    step={param.step}
                    suffix={param.suffix}
                    value={value(style, param)}
                    // Continuous: one history entry on release, not one per pixel.
                    onChange={(n) => patch(index, { [param.key]: n }, false)}
                    onCommit={() => store.getState().pushHistory()}
                  />
                ))}

                {descriptor.globalLight && (
                  <label className="flex items-center gap-2 text-[11px] text-textColor/60">
                    <input
                      type="checkbox"
                      checked={style.useGlobalLight !== false}
                      onChange={(e) => patch(index, { useGlobalLight: e.target.checked })}
                      className="w-3.5 h-3.5 accent-designerAccent"
                    />
                    {t('designer_use_global_light', 'Use global light')}
                  </label>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
