'use client';

import React, { FC } from 'react';
import { ColorSwatch, Stepper } from '../controls';
import type { DesignerElement } from '../designer.store';
import { useBrandColors } from './use-brand-colors';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface IconInspectorProps {
  element: DesignerElement;
  ids: string[];
  store: any;
}

export const IconInspector: FC<IconInspectorProps> = ({
  element,
  ids,
  store,
}) => {
  const t = useT();
  const updateElements = store((s: any) => s.updateElements);
  const brandColors = useBrandColors();
  const brandEnforcement = store((s: any) => s.brandEnforcement);

  const set = (u: Partial<DesignerElement>) => updateElements(ids, u);

  return (
    <div className="space-y-3">
      <div className="text-[12px] font-medium text-textColor/60 uppercase tracking-wider">
        {t('designer_icon_heading', 'Icon')}
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

      <div className="grid grid-cols-2 gap-2">
        <Stepper
          label={t('designer_label_w', 'W')}
          min={1}
          value={Math.round(element.width)}
          onChange={(n) => set({ width: n, height: n })}
        />
        <Stepper
          label={t('designer_label_h', 'H')}
          min={1}
          value={Math.round(element.height)}
          onChange={(n) => set({ width: n, height: n })}
        />
      </div>
    </div>
  );
};
