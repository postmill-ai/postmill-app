'use client';

import React, { FC } from 'react';
import { ColorSwatch, SegmentedControl } from '../controls';
import { GradientEditor } from '../controls/gradient-editor';
import { useBrandColors } from './use-brand-colors';
import type { DesignerElement } from '../designer.store';
import type {
  DesignerFillStyle,
  DesignerGradient,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

/**
 * The settings of a fill layer.
 *
 * A `fill` layer could be ADDED and never edited — the inspector routed text,
 * image, shape, path, icon and adjustment layers to a panel and fill layers to
 * nothing at all, so whatever colour it was created with was the colour it kept
 * forever.
 */
export const FillLayerInspector: FC<{
  element: DesignerElement;
  ids: string[];
  store: any;
}> = ({ element, ids, store }) => {
  const t = useT();
  const brandColors = useBrandColors();
  const brandEnforcement = store((s: any) => s.brandEnforcement);
  const updateElements = store((s: any) => s.updateElements);

  const style: DesignerFillStyle = element.fillStyle || { type: 'solid', color: '#2B5CD3' };
  const set = (next: Partial<DesignerFillStyle>) =>
    updateElements(ids, { fillStyle: { ...style, ...next } } as Partial<DesignerElement>);

  return (
    <div className="space-y-3">
      <div className="text-[12px] font-medium text-textColor/60 uppercase tracking-wider">
        {t('designer_fill_heading', 'Fill')}
      </div>

      <SegmentedControl
        value={style.type}
        options={[
          { value: 'solid', label: t('designer_fill_solid', 'Solid') },
          { value: 'gradient', label: t('designer_gradient', 'Gradient') },
        ]}
        onChange={(v) => set({ type: v as DesignerFillStyle['type'] })}
      />

      {style.type === 'gradient' ? (
        <GradientEditor
          value={style.gradient as DesignerGradient}
          onChange={(g) => set({ gradient: g })}
          brandColors={brandColors}
          brandEnforcement={brandEnforcement}
        />
      ) : (
        <ColorSwatch
          label={t('color', 'Color')}
          value={style.color || '#2B5CD3'}
          onChange={(hex) => set({ color: hex })}
          brandColors={brandColors}
          brandEnforcement={brandEnforcement}
        />
      )}
    </div>
  );
};
