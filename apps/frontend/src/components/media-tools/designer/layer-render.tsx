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
  blendPixels,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/pixel-ops';
import {
  splitStyles,
  elementStyles,
  stylePadding,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/layer-styles';
import {
  drawOverStyle,
  drawUnderStyle,
  paintBackdropFilter,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/layer-style-render';
import type { DesignerLayerStyle } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import { warpPadding } from '@postmill-ai/nestjs-libraries/media/designer-doc/warp';
import { cornerRadii } from '@postmill-ai/nestjs-libraries/media/designer-doc/shape-geometry';
import { patternTile } from './patterns';

/**
 * Cap on how finely effects rasterise when zoomed in. Each style allocates a
 * buffer of the padded layer rect, so this bounds the memory a deep zoom costs.
 */
const MAX_STYLE_RATIO = 2;

const createCanvas = (width: number, height: number): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  return canvas;
};

/** Pattern tiles come from the shared generator, cached by `patterns.ts`. */
const styleTile = (style: DesignerLayerStyle) =>
  style.pattern ? patternTile(style.pattern) : null;

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

/** True when a layer carries at least one effect that is switched on. */
export const hasLayerStyles = (el: DesignerElement): boolean => {
  const { under, over } = splitStyles(elementStyles(el));
  return under.length > 0 || over.length > 0;
};

/**
 * A layer drawn with its effects.
 *
 * The order is the server's: under-styles, the layer itself, over-styles — then
 * the whole stack composites through the element's own blend mode, which is why
 * the outer group carries the blend and the leaf inside is drawn plainly. It
 * mirrors `drawElementWithStyles`'s `ignoreBlend`, for the same reason: inside
 * an empty buffer a `multiply` layer would blend against transparent black and
 * vanish.
 *
 * The effects themselves are the SHARED painter both renderers call, so a glow
 * on the canvas is the glow in the PNG and in the PDF. All this component does
 * is give it a buffer and the layer's pixels.
 */
export const StyledLayer: FC<{
  element: DesignerElement;
  children: ReactNode;
  cacheKey?: string | number;
}> = ({ element, children, cacheKey }) => {
  const outerRef = useRef<Konva.Group>(null);
  const innerRef = useRef<Konva.Group>(null);
  const { under, over } = splitStyles(elementStyles(element));
  // The warp slack is part of the buffer, or an arched banner's drop shadow is
  // clipped at the element box — see `warpPadding`.
  const pad = stylePadding(elementStyles(element)) + warpPadding(element);

  // The blend applies to the finished stack, so the group needs a buffer of its
  // own — the same reason LayerGroup caches.
  useEffect(() => {
    const node = outerRef.current;
    if (!node) return;
    try {
      node.cache();
    } catch {
      node.clearCache();
    }
    node.getLayer()?.batchDraw();
  }, [cacheKey, element.opacity, element.blendMode, JSON.stringify(element.styles), JSON.stringify(element.boxShadow)]);

  /**
   * Paint one half of the stack.
   *
   * The layer's own pixels come from re-rendering the inner group offscreen at
   * the padded element rect. `toCanvas` bakes the stage transform in, so the
   * device ratio folds the zoom in and the surface stays in design units.
   */
  const paint = (styles: typeof under, kind: 'under' | 'over') => (ctx: Konva.Context) => {
    const node = innerRef.current;
    const stage = node?.getStage();
    if (!node || !stage || !styles.length) return;

    const surface = {
      x: element.x - pad,
      y: element.y - pad,
      width: element.width + pad * 2,
      height: element.height + pad * 2,
    };
    if (surface.width <= 0 || surface.height <= 0) return;

    const zoom = stage.scaleX() || 1;
    const ratio = Math.min(MAX_STYLE_RATIO, Math.max(1, zoom));
    const device = {
      w: Math.ceil(surface.width * ratio),
      h: Math.ceil(surface.height * ratio),
    };
    if (device.w <= 0 || device.h <= 0) return;

    let layer: HTMLCanvasElement;
    try {
      layer = node.toCanvas({
        x: surface.x * zoom + stage.x(),
        y: surface.y * zoom + stage.y(),
        width: surface.width * zoom,
        height: surface.height * zoom,
        pixelRatio: ratio / zoom,
      });
    } catch {
      // A zero-size or not-yet-laid-out node; nothing to key off.
      return;
    }

    const buf = createCanvas(device.w, device.h);
    const bctx = buf.getContext('2d');
    if (!bctx) return;
    // Work in design units with the surface origin at (0,0) so the shared
    // painter's absolute coordinates land in the buffer.
    bctx.scale(ratio, ratio);
    bctx.translate(-surface.x, -surface.y);

    const deps = { createCanvas, patternTile: styleTile };
    for (const style of styles) {
      if (kind === 'under') drawUnderStyle(bctx, layer, style, ratio, surface, deps);
      else drawOverStyle(bctx, layer, element, style, ratio, surface, deps);
    }

    ctx.drawImage(buf, surface.x, surface.y, surface.width, surface.height);
  };

  return (
    <Group
      ref={outerRef}
      opacity={element.opacity ?? 1}
      globalCompositeOperation={
        isNativeBlend(element.blendMode)
          ? (canvasCompositeFor(element.blendMode) as never)
          : undefined
      }
      listening={!element.locked}
    >
      <Shape listening={false} sceneFunc={paint(under, 'under')} />
      <Group ref={innerRef}>{children}</Group>
      <Shape listening={false} sceneFunc={paint(over, 'over')} />
    </Group>
  );
};

/**
 * Frosted glass behind one layer.
 *
 * The stated blocker for backdrop filters — "Konva can't give a node its
 * backdrop", which is also why eleven blend modes were unselectable — is not
 * true inside a `sceneFunc`: `ctx.canvas` is the Konva LAYER's canvas, and at
 * the moment this shape paints it already holds everything drawn beneath. That
 * is the backdrop, and it is the same pixels the server reads page-wise.
 *
 * Rendered as a sibling BEFORE the element, so the element draws over its own
 * frosted region.
 */
export const BackdropFilterShape: FC<{ element: DesignerElement }> = ({ element }) => {
  const filter = element.backdropFilter;

  const paint = (ctx: Konva.Context) => {
    if (!filter || (!(filter.blur ?? 0) && (filter.saturate ?? 1) === 1)) return;
    const native = (ctx as unknown as { _context: CanvasRenderingContext2D })._context;
    if (!native?.canvas) return;

    // The layer canvas is in DEVICE pixels with the stage transform baked in,
    // so the element's document rect has to be mapped through zoom and pan —
    // the same trap `applyBlend` documents on the server.
    const transform = native.getTransform?.();
    const scale = transform ? transform.a : 1;
    const pad = Math.ceil((filter.blur ?? 0) * scale * 2);
    const region = {
      x: (transform ? transform.e : 0) + element.x * scale - pad,
      y: (transform ? transform.f : 0) + element.y * scale - pad,
      width: element.width * scale + pad * 2,
      height: element.height * scale + pad * 2,
    };
    if (region.width <= 0 || region.height <= 0) return;

    const [tl, tr, br, bl] = cornerRadii(element.borderRadius, element.width, element.height);
    paintBackdropFilter(native, filter, region, scale, createCanvas, {
      x: pad,
      y: pad,
      width: element.width * scale,
      height: element.height * scale,
      radii: [tl * scale, tr * scale, br * scale, bl * scale],
    });
  };

  if (!filter) return null;
  return <Shape listening={false} sceneFunc={paint} />;
};

/**
 * The eleven blend modes canvas has no `globalCompositeOperation` for.
 *
 * They were unselectable because the canvas "has no backdrop to hand a node",
 * so the editor would have shown `normal` while the PDF and video showed the
 * real blend. The backdrop is reachable after all — but not from a filter,
 * which only ever sees the node's own pixels. It takes a sandwich:
 *
 *  1. a Shape BEFORE the layer copies the region it is about to cover;
 *  2. the layer draws normally;
 *  3. a Shape AFTER it takes the layer's own bitmap, blends it against the
 *     saved copy with the SAME `blendPixels` the server uses, and writes the
 *     result back.
 *
 * Both shapes are already in the tree — `StyledLayer` paints its under- and
 * over-effects in exactly these two slots.
 */
export const CustomBlendLayer: FC<{
  element: DesignerElement;
  children: ReactNode;
}> = ({ element, children }) => {
  const innerRef = useRef<Konva.Group>(null);
  // The backdrop copy, handed from the first shape to the second within one
  // draw. A ref, not state: it must not survive the frame or trigger a render.
  const saved = useRef<{ canvas: HTMLCanvasElement; x: number; y: number } | null>(null);

  const regionFor = (native: CanvasRenderingContext2D) => {
    const transform = native.getTransform?.();
    const scale = transform ? transform.a : 1;
    const x = Math.max(0, Math.floor((transform ? transform.e : 0) + element.x * scale));
    const y = Math.max(0, Math.floor((transform ? transform.f : 0) + element.y * scale));
    return {
      x,
      y,
      width: Math.min(native.canvas.width - x, Math.ceil(element.width * scale)),
      height: Math.min(native.canvas.height - y, Math.ceil(element.height * scale)),
      scale,
    };
  };

  const capture = (ctx: Konva.Context) => {
    saved.current = null;
    const native = (ctx as unknown as { _context: CanvasRenderingContext2D })._context;
    if (!native?.canvas) return;
    const region = regionFor(native);
    if (region.width <= 0 || region.height <= 0) return;

    const copy = createCanvas(region.width, region.height);
    const cctx = copy.getContext('2d');
    if (!cctx) return;
    cctx.putImageData(
      native.getImageData(region.x, region.y, region.width, region.height),
      0,
      0
    );
    saved.current = { canvas: copy, x: region.x, y: region.y };
  };

  const blend = (ctx: Konva.Context) => {
    const backdropCopy = saved.current;
    saved.current = null;
    const native = (ctx as unknown as { _context: CanvasRenderingContext2D })._context;
    const node = innerRef.current;
    const stage = node?.getStage();
    if (!backdropCopy || !native?.canvas || !node || !stage) return;

    const region = regionFor(native);
    if (region.width <= 0 || region.height <= 0) return;

    let layer: HTMLCanvasElement;
    try {
      const zoom = stage.scaleX() || 1;
      layer = node.toCanvas({
        x: element.x * zoom + stage.x(),
        y: element.y * zoom + stage.y(),
        width: element.width * zoom,
        height: element.height * zoom,
        pixelRatio: region.scale / zoom,
      });
    } catch {
      return;
    }

    const backdropCtx = backdropCopy.canvas.getContext('2d');
    const layerCtx = layer.getContext('2d');
    if (!backdropCtx || !layerCtx) return;

    const width = Math.min(region.width, layer.width);
    const height = Math.min(region.height, layer.height);
    if (width <= 0 || height <= 0) return;

    const backdropData = backdropCtx.getImageData(0, 0, width, height);
    const layerData = layerCtx.getImageData(0, 0, width, height);
    // The shared evaluator — the same call the server makes, which is what
    // keeps the canvas and the PDF identical for these eleven.
    blendPixels(backdropData, layerData, element.blendMode!, element.opacity ?? 1);
    backdropCtx.putImageData(backdropData, 0, 0);

    // Write back in device space; the layer transform is already baked into the
    // region coordinates.
    native.save();
    native.setTransform(1, 0, 0, 1, 0, 0);
    native.clearRect(region.x, region.y, width, height);
    native.drawImage(backdropCopy.canvas, region.x, region.y);
    native.restore();
  };

  return (
    <Group listening={!element.locked}>
      <Shape listening={false} sceneFunc={capture} />
      <Group ref={innerRef}>{children}</Group>
      <Shape listening={false} sceneFunc={blend} />
    </Group>
  );
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
