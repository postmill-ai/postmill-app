'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import type Konva from 'konva';
import type { DesignerElement, DesignerOutput, VideoOutput } from './designer.store';
import {
  ensureBuffer,
  getBuffer,
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

/** How long a painted clip lasts when the stroke creates one. */
const RASTER_CLIP_MS = 4000;

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
  // The mask lives in the store so the Select menu and the filter runner can
  // reach it; this hook is just one of its writers now.
  const selection = store((s: { selection: SelectionMask | null }) => s.selection);
  const setSelection = useCallback(
    (next: SelectionMask | null | ((prev: SelectionMask | null) => SelectionMask | null)) => {
      const state = store.getState();
      state.setSelection(
        typeof next === 'function' ? next(state.selection) : next
      );
    },
    [store]
  );
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
  /** Per-stroke selection stencil, in layer space, built once at stroke start. */
  const strokeMask = useRef<HTMLCanvasElement | null>(null);
  /** Pre-stroke layer content outside the selection, restored after each batch. */
  const strokeBase = useRef<HTMLCanvasElement | null>(null);
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

  /**
   * Where a painted clip lives, so the stroke can be committed back to it.
   * Null for image documents, which paint into elements.
   */
  const rasterClipTrack = useRef<string | null>(null);
  /** Set when the active stroke is going into a layer mask, not a layer. */
  const maskOwnerId = useRef<string | null>(null);

  /**
   * The raster layer to paint into, creating one above the selection if needed.
   *
   * A video document has no elements, so the target is a raster CLIP on a raster
   * track instead. It is adapted into the element shape the paint engine works
   * with — id and box are all it reads — which keeps one implementation of the
   * brush maths for both document kinds.
   */
  const resolveRasterTarget = useCallback((): DesignerElement | null => {
    const state = store.getState();
    const w = output?.width ?? 1080;
    const h = output?.height ?? 1080;

    // A layer's MASK is armed: paint into it instead of the layer's pixels.
    // Returned as a pseudo-element keyed `${id}:mask` so the whole brush engine
    // — buffers, undo, clipping — works on it unchanged.
    if (state.maskTargetId) {
      const children = (state.doc.outputs[state.currentOutput] as DesignerOutput)?.children || [];
      const owner = children.find((c) => c.id === state.maskTargetId);
      if (owner) {
        maskOwnerId.current = owner.id;
        return {
          ...owner,
          id: `${owner.id}:mask`,
          type: 'raster',
        } as DesignerElement;
      }
    }
    maskOwnerId.current = null;

    if (state.doc.mode === 'video') {
      const vo = state.doc.outputs[state.currentOutput] as unknown as VideoOutput;
      let track = vo.tracks?.find((tr) => tr.type === 'raster');
      if (!track) {
        state.addTrack(state.currentOutput, 'raster');
        const refreshed = store.getState().doc.outputs[state.currentOutput] as unknown as VideoOutput;
        track = refreshed.tracks.find((tr) => tr.type === 'raster');
      }
      if (!track) return null;
      rasterClipTrack.current = track.id;

      // Paint into the clip under the playhead when there is one, so successive
      // strokes build up on the same layer rather than stacking new clips.
      const playheadMs = state.playheadMs;
      const existing = track.clips.find(
        (c) => playheadMs >= c.startMs && playheadMs <= c.endMs
      );
      if (existing) {
        return {
          id: existing.id,
          type: 'raster',
          x: existing.x ?? 0,
          y: existing.y ?? 0,
          width: existing.width ?? w,
          height: existing.height ?? h,
          rotation: 0,
          opacity: 1,
          locked: false,
          hidden: false,
        } as DesignerElement;
      }

      const startMs = Math.max(0, Math.min(playheadMs, Math.max(0, (vo.durationMs || 10000) - 1000)));
      const before = new Set(track.clips.map((c) => c.id));
      store.getState().addClip(state.currentOutput, track.id, {
        id: '',
        startMs,
        endMs: Math.min(startMs + RASTER_CLIP_MS, vo.durationMs || startMs + RASTER_CLIP_MS),
        x: 0,
        y: 0,
        width: w,
        height: h,
        opacity: 1,
      });
      const after = (store.getState().doc.outputs[state.currentOutput] as unknown as VideoOutput)
        .tracks.find((tr) => tr.id === track!.id);
      const created = after?.clips.find((c) => !before.has(c.id));
      if (!created) return null;
      store.getState().setSelectedClip({
        outputIndex: state.currentOutput,
        trackId: track.id,
        clipId: created.id,
      });
      return {
        id: created.id,
        type: 'raster',
        x: 0,
        y: 0,
        width: w,
        height: h,
        rotation: 0,
        opacity: 1,
        locked: false,
        hidden: false,
      } as DesignerElement;
    }

    rasterClipTrack.current = null;
    const children = (state.doc.outputs[state.currentOutput] as DesignerOutput)?.children || [];
    const selected = children.find(
      (c: DesignerElement) => c.id === state.selectedIds[0] && c.type === 'raster'
    );
    if (selected) return selected;

    const before = new Set(children.map((c: DesignerElement) => c.id));
    state.addElement(buildRasterElement(w, h));
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
          const rgb = hexToRgb(settings.color);
          const filledMask = new Uint8Array(canvas.width * canvas.height);
          const filled = floodFill(
            data,
            local.x,
            local.y,
            rgb,
            Number(o.tolerance ?? 32),
            selection?.data,
            filledMask
          );
          if (filled > 0) {
            // Write back ONLY the filled pixels: the composite the fill matched
            // against contains the backdrop, and committing that would bake a
            // copy of every layer beneath into this one.
            const base = ctx.getImageData(0, 0, canvas.width, canvas.height);
            for (let p = 0; p < filledMask.length; p++) {
              if (!filledMask[p]) continue;
              const off = p * 4;
              base.data[off] = rgb[0];
              base.data[off + 1] = rgb[1];
              base.data[off + 2] = rgb[2];
              base.data[off + 3] = 255;
            }
            ctx.putImageData(base, 0, 0);
            // The bucket is a click, not a stroke — but it still commits
            // through the stroke path (upload + history) on mouseup.
            painting.current = true;
            setPaintNonce((n) => n + 1);
          }
        }
        return;
      }

      painting.current = true;
      lastPoint.current = local;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        beginStrokeClip(canvas, selection, target, strokeMask, strokeBase);
        stamp(toolId as PaintToolId, { ctx, backdrop: backdrop.current, settings }, local.x, local.y);
        applyStrokeClip(ctx, strokeMask, strokeBase);
        setPaintNonce((n) => n + 1);
      }
    },
    [resolveRasterTarget, snapshotBackdrop, settingsFor, selection, store]
  );

  const movePaint = useCallback(
    (toolId: string, point: { x: number; y: number }) => {
      if (!painting.current || !activeRasterId.current) return;
      const state = store.getState();
      const out = state.doc.outputs[state.currentOutput];
      const children = (out as DesignerOutput)?.children || [];
      // Only the target's position is read, and three kinds of paint target
      // exist: an element, a layer mask (keyed `${owner.id}:mask`, so the
      // owner's box), or a raster CLIP in a video document (no children at
      // all). Looking only at elements left the last two stamping once and
      // never dragging.
      let origin: { x: number; y: number } | undefined = children.find(
        (c: DesignerElement) => c.id === activeRasterId.current
      );
      if (!origin && maskOwnerId.current) {
        origin = children.find((c: DesignerElement) => c.id === maskOwnerId.current);
      }
      if (!origin) {
        const tracks = (out as unknown as VideoOutput)?.tracks || [];
        for (const track of tracks) {
          const clip = track.clips.find((c) => c.id === activeRasterId.current);
          if (clip) {
            origin = { x: clip.x ?? 0, y: clip.y ?? 0 };
            break;
          }
        }
      }
      const canvas = getBuffer(activeRasterId.current);
      const ctx = canvas?.getContext('2d');
      if (!origin || !canvas || !ctx) return;

      const local = { x: point.x - origin.x, y: point.y - origin.y };
      const settings = settingsFor(toolId);
      const from = lastPoint.current || local;

      for (const p of stampPositions(from, local, settings.size)) {
        stamp(toolId as PaintToolId, { ctx, backdrop: backdrop.current, settings }, p.x, p.y);
      }
      applyStrokeClip(ctx, strokeMask, strokeBase);
      lastPoint.current = local;
      setPaintNonce((n) => n + 1);
    },
    [settingsFor, store]
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
    strokeMask.current = null;
    strokeBase.current = null;

    const result = await commitBuffer(id, fetchFn);
    if (result) {
      const owner = maskOwnerId.current;
      if (owner) {
        store.getState().updateElement(owner, {
          maskSrc: result.src,
          maskFileId: result.fileId,
          maskEnabled: true,
        });
        store.getState().pushHistory();
        return;
      }
      const trackId = rasterClipTrack.current;
      if (trackId) {
        store.getState().updateClip(store.getState().currentOutput, trackId, id, {
          src: result.src,
          fileId: result.fileId,
        });
      } else {
        store.getState().updateElement(id, { src: result.src, fileId: result.fileId });
      }
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

  // One stable object: canvas.tsx memoizes handlers on `paint`, and a fresh
  // literal every render defeated that memoization.
  return useMemo(
    () => ({
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
    }),
    [
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
    ]
  );
};

/**
 * Snapshot the selection constraint for a stroke.
 *
 * The previous approach painted the stencil INTO the layer and relied on
 * `source-atop` for the stamps — but the stencil itself stayed in the layer
 * (the whole selection ended up painted black), and the eraser's own
 * `destination-out` overwrote the composite op, so it ignored the selection
 * entirely. Instead the constraint is kept as two canvases: the selection
 * resampled into the layer's pixel space, and the layer's pre-stroke content
 * with the selected region knocked out.
 */
const beginStrokeClip = (
  canvas: HTMLCanvasElement,
  selection: SelectionMask | null,
  target: DesignerElement,
  strokeMask: { current: HTMLCanvasElement | null },
  strokeBase: { current: HTMLCanvasElement | null }
): void => {
  strokeMask.current = null;
  strokeBase.current = null;
  if (!selection) return;

  const mask = document.createElement('canvas');
  mask.width = canvas.width;
  mask.height = canvas.height;
  const mctx = mask.getContext('2d');
  if (!mctx) return;

  const img = mctx.createImageData(mask.width, mask.height);
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      const docX = Math.round(x + target.x);
      const docY = Math.round(y + target.y);
      const inside =
        docX >= 0 && docY >= 0 && docX < selection.width && docY < selection.height
          ? selection.data[docY * selection.width + docX]
          : 0;
      // Binary on purpose: `destination-in` multiplies alpha, so a feathered
      // stencil would decay a little more on every batch it is re-applied.
      img.data[(y * mask.width + x) * 4 + 3] = inside ? 255 : 0;
    }
  }
  mctx.putImageData(img, 0, 0);

  const base = document.createElement('canvas');
  base.width = canvas.width;
  base.height = canvas.height;
  const bctx = base.getContext('2d');
  if (!bctx) return;
  bctx.drawImage(canvas, 0, 0);
  bctx.globalCompositeOperation = 'destination-out';
  bctx.drawImage(mask, 0, 0);

  strokeMask.current = mask;
  strokeBase.current = base;
};

/**
 * Re-impose the selection after a stamp batch: keep what the stroke painted
 * inside the ants, put back what was there outside them. Idempotent, so it
 * can run after every pointer move of the stroke.
 */
const applyStrokeClip = (
  ctx: CanvasRenderingContext2D,
  strokeMask: { current: HTMLCanvasElement | null },
  strokeBase: { current: HTMLCanvasElement | null }
): void => {
  const mask = strokeMask.current;
  const base = strokeBase.current;
  if (!mask || !base) return;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, 0, 0);
  ctx.globalCompositeOperation = 'destination-over';
  ctx.drawImage(base, 0, 0);
  ctx.restore();
};
