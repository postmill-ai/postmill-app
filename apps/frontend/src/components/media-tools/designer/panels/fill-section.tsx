'use client';

import React, { FC } from 'react';
import { ColorSwatch, SegmentedControl, Stepper } from '../controls';
import { GradientEditor } from '../controls/gradient-editor';
import type {
  DesignerGradient,
  DesignerTextStroke,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

type FillFields = {
  fill?: string;
  fillGradient?: DesignerGradient;
};

export const FillSection: FC<{
  element: FillFields;
  set: (patch: Partial<FillFields>) => void;
  label?: string;
  brandColors?: string[];
  brandEnforcement?: boolean;
}> = ({ element, set, label, brandColors, brandEnforcement }) => {
  const t = useT();
  const isGradient = !!element.fillGradient?.stops?.length;

  return (
    <div className="space-y-2">
      <SegmentedControl
        value={isGradient ? 'gradient' : 'solid'}
        options={[
          { value: 'solid', label: t('designer_fill_solid', 'Solid') },
          { value: 'gradient', label: t('designer_gradient', 'Gradient') },
        ]}
        onChange={(v) =>
          set({
            fillGradient:
              v === 'gradient'
                ? {
                    type: 'linear',
                    angle: 0,
                    stops: [
                      { offset: 0, color: element.fill || '#2B5CD3' },
                      { offset: 1, color: '#FFFFFF' },
                    ],
                  }
                : undefined,
          })
        }
      />

      {isGradient ? (
        <GradientEditor
          value={element.fillGradient as DesignerGradient}
          onChange={(fillGradient) => set({ fillGradient })}
          brandColors={brandColors}
          brandEnforcement={brandEnforcement}
        />
      ) : (
        <ColorSwatch
          label={label || t('fill_button', 'Fill')}
          value={element.fill || '#2B5CD3'}
          onChange={(hex) => set({ fill: hex })}
          brandColors={brandColors}
          brandEnforcement={brandEnforcement}
        />
      )}
    </div>
  );
};

export const TextStrokeSection: FC<{
  element: { textStroke?: DesignerTextStroke };
  set: (patch: { textStroke?: DesignerTextStroke }) => void;
  brandColors?: string[];
  brandEnforcement?: boolean;
}> = ({ element, set, brandColors, brandEnforcement }) => {
  const t = useT();
  const outline = element.textStroke;
  return (
    <div className="flex flex-col gap-2 pt-1 border-t border-studioBorder">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-textColor/60 uppercase tracking-wider">
          {t('designer_label_outline', 'Outline')}
        </span>
        <button
          type="button"
          role="switch"
          aria-label={t('designer_label_outline', 'Outline')}
          aria-checked={!!outline}
          onClick={() =>
            set({ textStroke: outline ? undefined : { color: '#000000', width: 2 } })
          }
          className={`relative w-[40px] h-[22px] rounded-full transition-colors ${
            outline ? 'bg-designerAccent' : 'bg-studioBorder'
          }`}
        >
          <span
            className={`absolute top-[2px] start-[2px] w-[18px] h-[18px] rounded-full bg-white transition-transform ${
              outline ? 'translate-x-[18px]' : ''
            }`}
          />
        </button>
      </div>
      {outline && (
        <div className="flex flex-col gap-3">
          <ColorSwatch
            label={t('designer_label_outline_color', 'Outline color')}
            value={outline.color || '#000000'}
            onChange={(color) => set({ textStroke: { ...outline, color } })}
            brandColors={brandColors}
            brandEnforcement={brandEnforcement}
          />
          <Stepper
            label={t('designer_label_width', 'Width')}
            min={0}
            max={20}
            step={1}
            value={outline.width}
            onChange={(width) => set({ textStroke: { ...outline, width } })}
          />
        </div>
      )}
    </div>
  );
};
