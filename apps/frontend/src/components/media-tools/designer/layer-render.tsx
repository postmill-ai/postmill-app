'use client';

import React, { FC, ReactNode, useEffect, useRef } from 'react';
import { Group, Shape } from 'react-konva';
import type Konva from 'konva';
import type {
  DesignerAdjustment,
  DesignerBlendMode,
  DesignerElement,
} from './designer.store';
import {
  applyAdjustment,
  canvasCompositeFor,
  isNativeBlend,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/pixel-ops';
import {
  splitStyles,
  styleOffset,
  styleBlur,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/layer-styles';

/**
 * Konva-side layer compositing: group containers and adjustment scopes.
 *
 * Both mirror what `design-render.service.ts` does with offscreen canvases, and
 * both run the SAME shared `pixel-ops` functions, which is what keeps the
 * client PNG export and the server PDF export identical.
 */

/**
 * A group: its members draw into a cached Konva Group so the group's own
 * opacity and blend mode apply to the composite rather than to each member.
 *
 * Caching is what makes that true — without it Konva composites each child
 * independently and a 50% group reads as 50% per layer.
 */
export const LayerGroup: FC<{
  element: DesignerElement;
  children: ReactNode;
  /** Bumped by callers when contents change, to re-cache. */
  cacheKey?: string | number;
}> = ({ element, children, cacheKey }) => {
  const ref = useRef<Konva.Group>(null);
  const needsBuffer =
    (element.opacity ?? 1) < 1 || !isNativeBlend(element.blendMode);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (needsBuffer) {
      try {
        node.cache();
      } catch {
        // A zero-size group can't be cached; harmless.
        node.clearCache();
      }
    } else {
      node.clearCache();
    }
    node.getLayer()?.batchDraw();
  }, [needsBuffer, cacheKey, element.opacity, element.blendMode]);

  return (
    <Group
      ref={ref}
      id={element.id}
      opacity={element.opacity ?? 1}
      globalCompositeOperation={
        isNativeBlend(element.blendMode)
          ? (canvasCompositeFor(element.blendMode) as never)
          : undefined
      }
      listening={!element.locked}
    >
      {children}
    </Group>
  );
};

/**
 * Everything an adjustment layer affects, wrapped in a cached Group carrying
 * the adjustment as a Konva filter.
 *
 * Konva filters are `(imageData) => void`, the exact signature of
 * `applyAdjustment` — so the client runs the server's own code rather than a
 * lookalike.
 */
export const AdjustmentScope: FC<{
  adjustment: DesignerAdjustment;
  children: ReactNode;
  cacheKey?: string | number;
}> = ({ adjustment, children, cacheKey }) => {
  const ref = useRef<Konva.Group>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.filters([(imageData: ImageData) => applyAdjustment(imageData, adjustment)]);
    try {
      node.cache();
    } catch {
      node.clearCache();
    }
    node.getLayer()?.batchDraw();
    // Serialised so a value tweak re-caches without re-running on every render.
  }, [JSON.stringify(adjustment), cacheKey]);

  return <Group ref={ref}>{children}</Group>;
};

/** The composite op for a leaf element, or undefined for the custom modes. */
export const blendPropFor = (
  mode: DesignerBlendMode | undefined
): string | undefined =>
  isNativeBlend(mode) ? canvasCompositeFor(mode) : undefined;

/**
 * Konva props for the layer styles a single node can express directly.
 *
 * Drop Shadow, Stroke and Color Overlay map onto Konva's own shadow/stroke/fill
 * props, so the common cases cost nothing. The buffer-based effects (inner
 * shadow/glow, satin, bevel, gradient/pattern overlay) are drawn by
 * `LayerStyleOverlay` instead.
 */
export const layerStyleProps = (
  el: DesignerElement
): Record<string, unknown> => {
  const { over, under } = splitStyles(el.styles);
  const props: Record<string, unknown> = {};

  const shadow = under.find((s) => s.type === 'drop-shadow');
  if (shadow) {
    const offset = styleOffset(shadow);
    props.shadowColor = shadow.color || '#000000';
    props.shadowBlur = styleBlur(shadow);
    props.shadowOffset = { x: offset.x, y: offset.y };
    props.shadowOpacity = shadow.opacity ?? 0.75;
    props.shadowEnabled = true;
  }

  const stroke = over.find((s) => s.type === 'stroke');
  if (stroke) {
    props.stroke = stroke.color || '#000000';
    props.strokeWidth = stroke.size ?? 1;
  }

  const colorOverlay = over.find((s) => s.type === 'color-overlay');
  if (colorOverlay?.color) {
    props.fill = colorOverlay.color;
  }

  return props;
};

/**
 * A layer with a painted mask over it.
 *
 * The mask is a greyscale bitmap composited `destination-in`, which is the same
 * stencil trick the text/shape mask already uses — the difference is that this
 * one wraps the WHOLE layer, so it works for text, shapes and paths and not
 * just images.
 *
 * The group must be cached: `globalCompositeOperation` composites against
 * whatever is beneath it in the Konva layer, so without a buffer of its own the
 * mask would erase everything painted under it too.
 */
export const MaskedLayer: FC<{
  element: DesignerElement;
  mask: HTMLImageElement | HTMLCanvasElement;
  children: ReactNode;
  cacheKey?: string | number;
}> = ({ element, mask, children, cacheKey }) => {
  const ref = useRef<Konva.Group>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    try {
      node.cache();
    } catch {
      node.clearCache();
    }
    node.getLayer()?.batchDraw();
  }, [cacheKey, mask, element.width, element.height]);

  return (
    <Group ref={ref} listening={!element.locked}>
      {children}
      <Shape
        x={element.x}
        y={element.y}
        width={element.width}
        height={element.height}
        listening={false}
        sceneFunc={(ctx) => {
          ctx.save();
          ctx.globalCompositeOperation = 'destination-in';
          // Drawn at the layer's box, so a mask painted at layer resolution
          // lines up whatever the element's own transform is.
          ctx.drawImage(
            mask as CanvasImageSource,
            element.x,
            element.y,
            element.width,
            element.height
          );
          ctx.restore();
        }}
      />
    </Group>
  );
};
