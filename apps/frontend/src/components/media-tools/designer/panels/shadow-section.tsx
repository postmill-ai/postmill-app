'use client';

import React, { FC } from 'react';
import { ColorSwatch, Slider } from '../controls';
import type { DesignerElement } from '../designer.store';
import type { DesignerLayerStyle } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import {
  styleOffset,
  styleFromBoxShadow,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/layer-styles';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

/**
 * The Shadow section on the image and shape inspectors.
 *
 * It writes a drop-shadow layer style — the same effect the full
 * Photoshop-style controls in the Effects panel edit — so the two are one
 * feature with two front doors: this simple x/y/blur one, and Effects.
 *
 * A stored `boxShadow` field (the pre-Effects section no renderer ever read)
 * is NOT shown or translated: v1 ships zero legacy support, so such a
 * document simply renders without the shadow.
 */
const DEFAULT_SHADOW = { color: '#000000', blur: 4, offsetX: 2, offsetY: 2 };

/**
 * Frosted glass: blur and desaturate what is behind the layer.
 *
 * Glassmorphism is most of modern social design and there was no backdrop
 * filter at all — the blocker was that Konva couldn't hand a node its backdrop,
 * which stopped being true once layers composited through their own buffers.
 */
export const BackdropSection: FC<{
  element: DesignerElement;
  set: (patch: Partial<DesignerElement>) => void;
}> = ({ element, set }) => {
  const t = useT();
  const filter = element.backdropFilter;
  const on = !!filter && ((filter.blur ?? 0) > 0 || (filter.saturate ?? 1) !== 1);

  return (
    <div className="flex flex-col gap-2 pt-1 border-t border-studioBorder">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-textColor/50">
          {t('designer_label_backdrop', 'Backdrop blur')}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          onClick={() =>
            set({
              backdropFilter: on ? undefined : { blur: 12, saturate: 1.4 },
            } as Partial<DesignerElement>)
          }
          className={`relative w-[40px] h-[22px] rounded-full transition-colors ${
            on ? 'bg-designerAccent' : 'bg-studioBorder'
          }`}
        >
          <span
            className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] rounded-full bg-white transition-transform ${
              on ? 'translate-x-[18px]' : ''
            }`}
          />
        </button>
      </div>
      {on && (
        <div className="flex flex-col gap-3">
          <Slider
            label={t('designer_label_blur', 'Blur')}
            min={0}
            max={60}
            value={filter?.blur ?? 0}
            onChange={(n) =>
              set({ backdropFilter: { ...filter, blur: n } } as Partial<DesignerElement>)
            }
          />
          <Slider
            label={t('designer_label_saturation', 'Saturation')}
            min={0}
            max={200}
            suffix="%"
            value={Math.round((filter?.saturate ?? 1) * 100)}
            onChange={(n) =>
              set({
                backdropFilter: { ...filter, saturate: n / 100 },
              } as Partial<DesignerElement>)
            }
          />
        </div>
      )}
    </div>
  );
};

export const ShadowSection: FC<{
  element: DesignerElement;
  set: (patch: Partial<DesignerElement>) => void;
  brandColors?: string[];
  brandEnforcement?: boolean;
}> = ({ element, set, brandColors, brandEnforcement }) => {
  const t = useT();
  const styles = (element.styles ?? []) as DesignerLayerStyle[];
  const index = styles.findIndex((s) => s.type === 'drop-shadow');
  const style: DesignerLayerStyle | undefined = index >= 0 ? styles[index] : undefined;
  const on = !!style && style.enabled !== false;

  const offset = style ? styleOffset(style) : { x: 0, y: 0 };
  const view = {
    color: style?.color || '#000000',
    blur: style?.size ?? 0,
    // Round-tripping through angle+distance leaves float dust that would make a
    // slider read 1.9999999; the sliders are whole pixels anyway.
    offsetX: Math.round(offset.x),
    offsetY: Math.round(offset.y),
  };

  /** Write (or clear) the drop-shadow effect. */
  const write = (next: DesignerLayerStyle | undefined) => {
    const rest = styles.filter((s) => s.type !== 'drop-shadow');
    set({
      styles: next ? [...rest, next] : rest,
    } as Partial<DesignerElement>);
  };

  const patch = (change: Partial<typeof view>) =>
    write(styleFromBoxShadow({ ...view, ...change }));

  return (
    <div className="flex flex-col gap-2 pt-1 border-t border-studioBorder">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-textColor/50">
          {t('designer_label_shadow', 'Shadow')}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          onClick={() => write(on ? undefined : styleFromBoxShadow(DEFAULT_SHADOW))}
          className={`relative w-[40px] h-[22px] rounded-full transition-colors ${
            on ? 'bg-designerAccent' : 'bg-studioBorder'
          }`}
        >
          <span
            className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] rounded-full bg-white transition-transform ${
              on ? 'translate-x-[18px]' : ''
            }`}
          />
        </button>
      </div>
      {on && (
        <div className="flex flex-col gap-3">
          <ColorSwatch
            label={t('designer_label_shadow_color', 'Shadow color')}
            value={view.color}
            onChange={(hex) => patch({ color: hex })}
            brandColors={brandColors}
            brandEnforcement={brandEnforcement}
          />
          <Slider
            label={t('designer_label_blur', 'Blur')}
            min={0}
            max={40}
            value={view.blur}
            onChange={(n) => patch({ blur: n })}
          />
          <Slider
            label={t('designer_label_offset_x', 'Offset X')}
            min={-40}
            max={40}
            value={view.offsetX}
            onChange={(n) => patch({ offsetX: n })}
          />
          <Slider
            label={t('designer_label_offset_y', 'Offset Y')}
            min={-40}
            max={40}
            value={view.offsetY}
            onChange={(n) => patch({ offsetY: n })}
          />
        </div>
      )}
    </div>
  );
};
