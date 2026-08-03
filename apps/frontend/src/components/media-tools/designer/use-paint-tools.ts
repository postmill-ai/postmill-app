'use client';

import { useCallback, useRef, useState } from 'react';
import type Konva from 'konva';
import type { DesignerElement, DesignerOutput } from './designer.store';
import {
  ensureBuffer,
  getBuffer,
  pushUndoRegion,
  commitBuffer,
  buildRasterElement,
} from './raster-layers';
import {
  stamp,
  stampPositions,
  floodFill,
  hexToRgb,
  DEFAULT_PAINT,
  type PaintSettings,
  type PaintToolId,
} from './paint-engine';
import {
  combineMasks,
  modeFromModifiers,
  rectMask,
  ellipseMask,
  rowMask,
  columnMask,
  polygonMask,
  brushIntoMask,
  regionGrow,
  maskFromAlpha,
  edgeMagnitude,
  snapToEdge,
  type SelectionMask,
} from './selection-mask';

/**
 * Wires the paint and selection tool groups to the Konva stage.
 *
 * Kept out of `canvas.tsx` because it owns a lot of stateful machinery — the
 * active raster buffer, the per-stroke backdrop snapshot, the in-progress
 * selection — none of which the rest of the canvas needs to see.
 */

const PAINT_TOOLS = new Set<string>([
  'brush', 'pencil', 'eraser', 'clone-stamp', 'paint-bucket',
  'blur', 'sharpen', 'smudge', 'dodge', 'burn', 'sponge',
]);

const MARQUEE_TOOLS = new Set<string>([
  'marquee-rect', 'marquee-ellipse', 'marquee-row', 'marquee-column',
]);

const LASSO_TOOLS = new Set<string>([
  'lasso-polygonal', 'lasso-magnetic', 'lasso-free', 'lasso-brush',
]);

export const isPaintTool = (id: string) => PAINT_TOOLS.has(id);
export const isMarqueeTool = (id: string) => MARQUEE_TOOLS.has(id);
export const isLassoTool = (id: string) => LASSO_TOOLS.has(id);
export const isSelectionTool = (id: string) =>
  isMarqueeTool(id) || isLassoTool(id) || id === 'quick-select' || id === 'object-select';

interface UsePaintToolsArgs {
  store: any;
  stageRef: React.RefObject<Konva.Stage | null>;
  output: DesignerOutput | undefined;
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>;
}

export const usePaintTools = ({ store, stageRef, output, fetchFn }: UsePaintToolsArgs) => {
  const [selection, setSelection] = useState<SelectionMask | null>(null);
  const [lassoPoints, setLassoPoints] = useState<{ x: number; y: number }[] | null>(null);

  const painting = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  /** Layer being painted into for the current stroke. */
  const activeRasterId = useRef<string | null>(null);
  /** Flattened pixels beneath the active layer, snapshotted once per stroke. */
  const backdrop = useRef<HTMLCanvasElement | null>(null);
  /** Clone Stamp anchor, set with Alt-click. */
  const cloneAnchor = useRef<{ x: number; y: number } | null>(null);
  const selectionStart = useRef<{ x: number; y: number } | null>(null);
  const edgeField = useRef<{ edges: Uint8ClampedArray; w: number; h: number } | null>(null);
  /** Bumped after every stroke so the Konva image re-reads the buffer. */
  const [paintNonce, setPaintNonce] = useState(0);

  const settingsFor = useCallback(
    (toolId: string): PaintSettings => {
      const o = store.getState().toolOptions[toolId] || {};
      return {
        ...DEFAULT_PAINT,
        size: Number(o.size ?? DEFAULT_PAINT.size),
        hardness: Number(o.hardness ?? 80) / 100,
        opacity: Number(o.opacity ?? 100) / 100,
        color: String(o.color ?? DEFAULT_PAINT.color),
        desaturate: o.mode === 'desaturate',
        cloneOffset: cloneAnchor.current ?? undefined,
      };
    },
    [store]
  );

  /**
   * Flatten everything under the active layer. Effect tools sample this rather
   * than the layer itself, which is empty until you paint on it — the cost of
   * keeping painting non-destructive.
   */
  const snapshotBackdrop = useCallback(
    (excludeId: string | null): HTMLCanvasElement | null => {
      const stage = stageRef.current;
      if (!stage) return null;
      const hidden: Konva.Node[] = [];
      if (excludeId) {
        const node = stage.findOne('#' + excludeId);
        if (node) {
          node.hide();
          hidden.push(node);
        }
      }
      let canvas: HTMLCanvasElement | null = null;
      try {
        canvas = stage.toCanvas({
          x: 0,
          y: 0,
          width: output?.width ?? stage.width(),
          height: output?.height ?? stage.height(),
          pixelRatio: 1,
        } as never);
      } catch {
        canvas = null;
      }
      hidden.forEach((n) => n.show());
      return canvas;
    },
    [stageRef, output]
  );

  /** The raster layer to paint into, creating one above the selection if needed. */
  const resolveRasterTarget = useCallback((): DesignerElement | null => {
    const state = store.getState();
    const children = (state.doc.outputs[state.currentOutput] as DesignerOutput)?.children || [];
    const selected = children.find(
      (c: DesignerElement) => c.id === state.selectedIds[0] && c.type === 'raster'
    );
    if (selected) return selected;

    const before = new Set(children.map((c: DesignerElement) => c.id));
    state.addElement(
      buildRasterElement(output?.width ?? 1080, output?.height ?? 1080)
    );
    const after =
      (store.getState().doc.outputs[state.currentOutput] as DesignerOutput)?.children || [];
    const created = after.find((c: DesignerElement) => !before.has(c.id));
    if (created) store.getState().setSelectedIds([created.id]);
    return created || null;
  }, [store, output]);

  const beginPaint = useCallback(
    (toolId: string, point: { x: number; y: number }, evt: MouseEvent) => {
      // Alt-click sets the Clone Stamp source instead of painting.
      if (toolId === 'clone-stamp' && evt.altKey) {
        cloneAnchor.current = { x: point.x, y: point.y };
        return;
      }

      const target = resolveRasterTarget();
      if (!target) return;
      activeRasterId.current = target.id;
      const canvas = ensureBuffer(target);
      backdrop.current = snapshotBackdrop(target.id);

      const local = { x: point.x - target.x, y: point.y - target.y };
      const settings = settingsFor(toolId);

      if (toolId === 'paint-bucket') {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        pushUndoRegion(target.id, 0, 0, canvas.width, canvas.height);
        // Fill against the visible composite, not the empty layer.
        const compose = document.createElement('canvas');
        compose.width = canvas.width;
        compose.height = canvas.height;
        const cctx = compose.getContext('2d');
        if (backdrop.current && cctx) cctx.drawImage(backdrop.current, -target.x, -target.y);
        cctx?.drawImage(canvas, 0, 0);
        let data: ImageData | null = null;
        try {
          data = cctx?.getImageData(0, 0, compose.width, compose.height) ?? null;
        } catch {
          data = null;
        }
        if (data) {
          const o = store.getState().toolOptions['paint-bucket'] || {};
          floodFill(
            data,
            local.x,
            local.y,
            hexToRgb(settings.color),
            Number(o.tolerance ?? 32),
            selection?.data
          );
          // Write back only the filled pixels by using the result as the layer.
          ctx.putImageData(data, 0, 0);
          setPaintNonce((n) => n + 1);
        }
        return;
      }

      painting.current = true;
      lastPoint.current = local;
      const r = settings.size;
      pushUndoRegion(target.id, local.x - r, local.y - r, r * 2, r * 2);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        applyClip(ctx, canvas, selection, target);
        stamp(toolId as PaintToolId, { ctx, backdrop: backdrop.current, settings }, local.x, local.y);
        ctx.restore();
        setPaintNonce((n) => n + 1);
      }
    },
    [resolveRasterTarget, snapshotBackdrop, settingsFor, selection, store]
  );

  const movePaint = useCallback(
    (toolId: string, point: { x: number; y: number }) => {
      if (!painting.current || !activeRasterId.current) return;
      const state = store.getState();
      const target = ((state.doc.outputs[state.currentOutput] as DesignerOutput)?.children || [])
        .find((c: DesignerElement) => c.id === activeRasterId.current);
      const canvas = getBuffer(activeRasterId.current);
      const ctx = canvas?.getContext('2d');
      if (!target || !canvas || !ctx) return;

      const local = { x: point.x - target.x, y: point.y - target.y };
      const settings = settingsFor(toolId);
      const from = lastPoint.current || local;

      applyClip(ctx, canvas, selection, target);
      for (const p of stampPositions(from, local, settings.size)) {
        stamp(toolId as PaintToolId, { ctx, backdrop: backdrop.current, settings }, p.x, p.y);
      }
      ctx.restore();
      lastPoint.current = local;
      setPaintNonce((n) => n + 1);
    },
    [settingsFor, selection, store]
  );

  /** Flush the painted buffer to storage so it survives reload and export. */
  const endPaint = useCallback(async () => {
    if (!painting.current || !activeRasterId.current) {
      painting.current = false;
      return;
    }
    painting.current = false;
    lastPoint.current = null;
    const id = activeRasterId.current;
    backdrop.current = null;

    const result = await commitBuffer(id, fetchFn);
    if (result) {
      store.getState().updateElement(id, { src: result.src, fileId: result.fileId });
      store.getState().pushHistory();
    }
  }, [fetchFn, store]);

  // ── Selection tools ──────────────────────────────────────────────────────

  const docSize = useCallback(
    () => ({ w: output?.width ?? 1080, h: output?.height ?? 1080 }),
    [output]
  );

  const beginSelection = useCallback(
    (toolId: string, point: { x: number; y: number }, evt: MouseEvent) => {
      const { w, h } = docSize();
      const mode = modeFromModifiers(evt.shiftKey, evt.altKey);

      if (toolId === 'marquee-row') {
        setSelection((prev) => combineMasks(prev, rowMask(w, h, point.y), mode));
        return;
      }
      if (toolId === 'marquee-column') {
        setSelection((prev) => combineMasks(prev, columnMask(w, h, point.x), mode));
        return;
      }
      if (isMarqueeTool(toolId)) {
        selectionStart.current = point;
        return;
      }

      if (toolId === 'lasso-polygonal') {
        // Click-to-place vertices; the canvas closes it on double-click.
        setLassoPoints((prev) => [...(prev || []), point]);
        return;
      }
      if (toolId === 'lasso-free' || toolId === 'lasso-brush' || toolId === 'lasso-magnetic') {
        setLassoPoints([point]);
        if (toolId === 'lasso-magnetic') {
          const snap = snapshotBackdrop(null);
          const sctx = snap?.getContext('2d');
          try {
            const img = sctx?.getImageData(0, 0, snap!.width, snap!.height);
            if (img) edgeField.current = { edges: edgeMagnitude(img), w: img.width, h: img.height };
          } catch {
            edgeField.current = null;
          }
        }
        return;
      }

      if (toolId === 'quick-select') {
        const snap = snapshotBackdrop(null);
        const sctx = snap?.getContext('2d');
        try {
          const img = sctx?.getImageData(0, 0, snap!.width, snap!.height);
          if (img) {
            const o = store.getState().toolOptions['quick-select'] || {};
            const grown = regionGrow(img, point.x, point.y, Number(o.tolerance ?? 32));
            setSelection((prev) => combineMasks(prev, grown, mode));
          }
        } catch {
          /* tainted canvas — nothing to grow from */
        }
      }
    },
    [docSize, snapshotBackdrop, store]
  );

  const moveSelection = useCallback(
    (toolId: string, point: { x: number; y: number }) => {
      if (isMarqueeTool(toolId) && selectionStart.current) {
        setLassoPoints(null);
        return;
      }
      if (toolId === 'lasso-free' || toolId === 'lasso-brush') {
        setLassoPoints((prev) => (prev ? [...prev, point] : prev));
        return;
      }
      if (toolId === 'lasso-magnetic' && edgeField.current) {
        const f = edgeField.current;
        const snapped = snapToEdge(f.edges, f.w, f.h, point.x, point.y);
        setLassoPoints((prev) => (prev ? [...prev, snapped] : prev));
      }
    },
    []
  );

  const endSelection = useCallback(
    (toolId: string, point: { x: number; y: number }, evt: MouseEvent) => {
      const { w, h } = docSize();
      const mode = modeFromModifiers(evt.shiftKey, evt.altKey);

      if (isMarqueeTool(toolId) && selectionStart.current) {
        const s = selectionStart.current;
        selectionStart.current = null;
        const rect = {
          x: Math.min(s.x, point.x),
          y: Math.min(s.y, point.y),
          width: Math.abs(point.x - s.x),
          height: Math.abs(point.y - s.y),
        };
        if (rect.width < 1 || rect.height < 1) return;
        const made = toolId === 'marquee-ellipse' ? ellipseMask(w, h, rect) : rectMask(w, h, rect);
        setSelection((prev) => combineMasks(prev, made, mode));
        return;
      }

      if (toolId === 'lasso-brush' && lassoPoints) {
        const o = store.getState().toolOptions['lasso-brush'] || {};
        const radius = Number(o.size ?? 24) / 2;
        const made = { width: w, height: h, data: new Uint8ClampedArray(w * h) };
        for (const p of lassoPoints) brushIntoMask(made, p.x, p.y, radius);
        setSelection((prev) => combineMasks(prev, made, mode));
        setLassoPoints(null);
        return;
      }

      if ((toolId === 'lasso-free' || toolId === 'lasso-magnetic') && lassoPoints) {
        if (lassoPoints.length >= 3) {
          setSelection((prev) => combineMasks(prev, polygonMask(w, h, lassoPoints), mode));
        }
        setLassoPoints(null);
        edgeField.current = null;
      }
    },
    [docSize, lassoPoints, store]
  );

  /** Close an in-progress polygonal lasso (double-click or Enter). */
  const closePolygonalLasso = useCallback(
    (shift = false, alt = false) => {
      const { w, h } = docSize();
      if (lassoPoints && lassoPoints.length >= 3) {
        setSelection((prev) =>
          combineMasks(prev, polygonMask(w, h, lassoPoints), modeFromModifiers(shift, alt))
        );
      }
      setLassoPoints(null);
    },
    [docSize, lassoPoints]
  );

  /** Object Selection: derive a mask from the AI cutout's alpha. */
  const runObjectSelection = useCallback(
    async (elementId: string) => {
      const state = store.getState();
      const el = ((state.doc.outputs[state.currentOutput] as DesignerOutput)?.children || [])
        .find((c: DesignerElement) => c.id === elementId);
      if (!el?.src) return;
      const res = await fetchFn('/media/remove-background', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: el.src }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.url) return;

      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = data.url;
      }).catch(() => null);

      const { w, h } = docSize();
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const cctx = c.getContext('2d');
      cctx?.drawImage(img, el.x, el.y, el.width, el.height);
      try {
        const imageData = cctx?.getImageData(0, 0, w, h);
        if (imageData) setSelection(maskFromAlpha(imageData));
      } catch {
        /* tainted canvas */
      }
    },
    [store, fetchFn, docSize]
  );

  const clearSelection = useCallback(() => {
    setSelection(null);
    setLassoPoints(null);
  }, []);

  return {
    selection,
    lassoPoints,
    paintNonce,
    beginPaint,
    movePaint,
    endPaint,
    beginSelection,
    moveSelection,
    endSelection,
    closePolygonalLasso,
    runObjectSelection,
    clearSelection,
  };
};

/**
 * Clip subsequent drawing to the active selection. Leaves the context saved —
 * callers restore. This is what makes "paint only inside the marching ants"
 * work for every brush-family tool at once.
 */
const applyClip = (
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  selection: SelectionMask | null,
  target: DesignerElement
): void => {
  ctx.save();
  if (!selection) return;

  const clip = document.createElement('canvas');
  clip.width = canvas.width;
  clip.height = canvas.height;
  const cctx = clip.getContext('2d');
  if (!cctx) return;

  const img = cctx.createImageData(clip.width, clip.height);
  for (let y = 0; y < clip.height; y++) {
    for (let x = 0; x < clip.width; x++) {
      const docX = Math.round(x + target.x);
      const docY = Math.round(y + target.y);
      const inside =
        docX >= 0 && docY >= 0 && docX < selection.width && docY < selection.height
          ? selection.data[docY * selection.width + docX]
          : 0;
      const p = (y * clip.width + x) * 4;
      img.data[p + 3] = inside;
    }
  }
  cctx.putImageData(img, 0, 0);
  // Everything drawn from here is masked by the selection's alpha.
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(clip, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
};
