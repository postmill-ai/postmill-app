'use client';

import React, { FC, useCallback } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { ColorSwatch, Slider } from '../controls';
import { CurvesEditor, type CurvePoint } from '../curves-editor';
import { Histogram } from '../histogram';
import { useBrandColors } from './use-brand-colors';
import {
  ADJUSTMENT_DESCRIPTOR_BY_TYPE,
  IDENTITY_CURVE,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/adjustment-descriptors';
import { defaultAdjustmentValues } from '@postmill-ai/nestjs-libraries/media/designer-doc/pixel-ops';
import type {
  DesignerAdjustment,
  DesignerGradient,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import type { DesignerElement } from '../designer.store';

/**
 * The settings of an adjustment layer.
 *
 * Until this existed every adjustment was frozen at the values it was created
 * with — sixteen layers you could add and never tune. The controls are
 * generated from `ADJUSTMENT_DESCRIPTORS`, so a slider's range can never
 * disagree with what `applyAdjustment` accepts.
 */

interface AdjustmentInspectorProps {
  element: DesignerElement;
  store: any;
}

export const AdjustmentInspector: FC<AdjustmentInspectorProps> = ({
  element,
  store,
}) => {
  const t = useT();
  const updateElement = store((s: any) => s.updateElement);
  const pushHistory = store((s: any) => s.pushHistory);
  const doc = store((s: any) => s.doc);
  const brandColors = useBrandColors();
  const brandEnforcement = store((s: any) => s.brandEnforcement);

  const adjustment = element.adjustment as DesignerAdjustment | undefined;

  const patch = useCallback(
    (u: Partial<DesignerAdjustment>) => {
      if (!adjustment) return;
      updateElement(element.id, { adjustment: { ...adjustment, ...u } });
    },
    [adjustment, element.id, updateElement]
  );

  if (!adjustment) return null;
  const descriptor = ADJUSTMENT_DESCRIPTOR_BY_TYPE[adjustment.type];
  if (!descriptor) return null;

  const defaults = defaultAdjustmentValues(adjustment.type);
  const values = { ...defaults, ...(adjustment.values || {}) };

  const setValue = (key: string, n: number) =>
    patch({ values: { ...values, [key]: n } });

  const gradient = adjustment.gradient || descriptor.gradient;

  const setStop = (index: number, color: string) => {
    if (!gradient) return;
    const stops = gradient.stops.map((s, i) => (i === index ? { ...s, color } : s));
    patch({ gradient: { ...gradient, stops } as DesignerGradient });
    pushHistory();
  };

  return (
    <div className="space-y-3" data-testid="adjustment-inspector">
      <div className="flex items-center justify-between">
        <div className="text-[12px] font-medium text-textColor/60 uppercase tracking-wider">
          {t(`designer_adjustment_${adjustment.type}`, descriptor.label)}
        </div>
        <button
          type="button"
          onClick={() => {
            patch({
              values: defaultAdjustmentValues(adjustment.type),
              ...(descriptor.curves ? { curves: { rgb: IDENTITY_CURVE.map((p) => ({ ...p })) } } : {}),
              ...(descriptor.color ? { color: descriptor.color } : {}),
            });
            pushHistory();
          }}
          className="px-2 h-[22px] rounded-sm text-[11px] text-textColor/60 hover:bg-boxHover"
        >
          {t('reset', 'Reset')}
        </button>
      </div>

      {/* Curves brings its own histogram, stacked behind the grid. */}
      {descriptor.histogram && !descriptor.curves && (
        <Histogram nonce={doc} />
      )}

      {descriptor.curves && (
        <CurvesEditor
          curves={adjustment.curves as Record<string, CurvePoint[]> | undefined}
          onChange={(curves) => patch({ curves })}
          onCommit={pushHistory}
          nonce={doc}
        />
      )}

      {descriptor.color && (
        <ColorSwatch
          label={t('color', 'Color')}
          value={adjustment.color || descriptor.color}
          onChange={(hex) => {
            patch({ color: hex });
            pushHistory();
          }}
          brandColors={brandColors}
          brandEnforcement={brandEnforcement}
        />
      )}

      {gradient && (
        <div className="space-y-2">
          <div className="text-[11px] text-textColor/50">
            {t('designer_gradient_map_ramp', 'Ramp')}
          </div>
          <div
            className="h-[18px] rounded-[4px] border border-studioBorder"
            style={{
              background: `linear-gradient(90deg, ${gradient.stops
                .map((s) => `${s.color} ${Math.round(s.offset * 100)}%`)
                .join(', ')})`,
            }}
          />
          <div className="flex gap-2">
            {gradient.stops.map((stop, i) => (
              <div key={`${stop.offset}-${i}`} className="flex-1">
                <ColorSwatch value={stop.color} onChange={(hex) => setStop(i, hex)} />
              </div>
            ))}
          </div>
        </div>
      )}

      {descriptor.params.map((param) =>
        param.boolean ? (
          <label
            key={param.key}
            className="flex items-center gap-2 text-[12px] text-textColor"
          >
            <input
              type="checkbox"
              checked={(values[param.key] ?? param.default) >= 0.5}
              onChange={(e) => {
                setValue(param.key, e.target.checked ? 1 : 0);
                pushHistory();
              }}
              className="accent-designerAccent w-3.5 h-3.5"
            />
            {t(`designer_adjustment_param_${param.key}`, param.label)}
          </label>
        ) : (
          <Slider
            key={param.key}
            label={t(`designer_adjustment_param_${param.key}`, param.label)}
            min={param.min}
            max={param.max}
            step={param.step}
            suffix={param.suffix}
            value={values[param.key] ?? param.default}
            onChange={(n) => setValue(param.key, n)}
            onCommit={pushHistory}
          />
        )
      )}

      {!descriptor.params.length && !descriptor.curves && !descriptor.gradient && (
        <p className="text-[11px] text-textColor/40">
          {t('designer_adjustment_no_settings', 'This adjustment has no settings.')}
        </p>
      )}
    </div>
  );
};
