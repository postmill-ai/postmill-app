'use client';

import React, { FC } from 'react';
import { ColorSwatch, SegmentedControl } from '../controls';
import { GradientEditor } from '../controls/gradient-editor';
import type { DesignerElement } from '../designer.store';
import type { DesignerGradient } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

/**
 * Solid-or-gradient fill, for any element type that has a fill.
 *
 * `fillGradient` was in the schema and honoured by both renderers for shapes
 * and paths, but the only thing that could ever WRITE it was the Gradient tool
 * — which hardcoded two stops — so the inspector offered a flat colour and
 * nothing else. Text ignored the field entirely until this round.
 */
export const FillSection: FC<{
  element: DesignerElement;
  set: (patch: Partial<DesignerElement>) => void;
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
            // Switching back to solid clears the ramp rather than hiding it, so
            // what the inspector shows is what the renderers read.
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
          } as Partial<DesignerElement>)
        }
      />

      {isGradient ? (
        <GradientEditor
          value={element.fillGradient as DesignerGradient}
          onChange={(g) => set({ fillGradient: g } as Partial<DesignerElement>)}
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
