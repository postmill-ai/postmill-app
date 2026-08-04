'use client';

import React, { FC, useCallback, useRef, useEffect, useState } from 'react';
import { Stage, Layer, Transformer, Rect, Group, Line as KonvaLine, Image as KonvaImage, Shape, Text as KonvaText } from 'react-konva';
import {
  findEqualSpacing,
  type SpacingGuide,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/align-distribute';
import type Konva from 'konva';
import { CanvasElements, gradientFillProps } from './elements';
import { TextEditingOverlay } from './text-editing';
import { SafeZoneOverlay } from './safe-zones';
import { Rulers } from './rulers';
import { ContextMenu } from './context-menu';
import { fitWithin } from './panels/fit-within';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import type { DesignerElement, DesignerOutput, VideoOutput } from './designer.store';
import { composeClipsAtPlayhead } from './video-preview';
import { VideoCanvasOverlay } from './video-canvas-overlay';
import { sharedStageRef } from './stage-ref';
import { buildResizePatch } from './transform-resize';
import { getTool, resolveToolShortcut } from './tools';
import { rectFromDrag, isMeaningfulDraw, buildShapeElement, buildShapeClip } from './tool-draw';
import { addText } from './add-text';
import { CropOverlay } from './crop-overlay';
import { ensureFontsLoaded } from './fonts';
import { getImageNaturalSize } from './elements';
import {
  type PenDraft,
  emptyDraft,
  penClick,
  penDragHandle,
  curvatureFinish,
  freeformFinish,
  buildPathElement,
  refitPathElement,
  addAnchorAt,
  deleteAnchorAt,
  convertAnchorAt,
  findNodeAt,
} from './pen-tools';
import { tracePathNodes } from '@postmill-ai/nestjs-libraries/media/designer-doc/path-geometry';
import {
  usePaintTools,
  isPaintTool,
  isSelectionTool,
  isMarqueeTool,
} from './use-paint-tools';
import { maskOutline, fullMask, invertMask } from './selection-mask';

/**
 * How much of the viewport a fitted artboard fills, leaving the rest as margin.
 * Anything at 1 would butt the canvas against the chrome on every side.
 */
const FIT_PADDING = 0.85;

interface CanvasProps {
  store: ReturnType<typeof import('./designer.store').createDesignerStore>;
  showSafeZones?: boolean;
  showRulers?: boolean;
  safeZonePreset?: string;
  onAddImage?: () => void;
  sendImageAwareness?: (
    outputIndex: number,
    mouseX: number,
    mouseY: number,
    selectedIds: string[]
  ) => void;
}

const SNAP = 6;

export const DesignerCanvas: FC<CanvasProps> = ({
  store,
  showSafeZones,
  showRulers = true,
  safeZonePreset,
  onAddImage,
  sendImageAwareness,
}) => {
  const stageRef = useRef<Konva.Stage>(null);
  useEffect(() => {
    const current = stageRef.current;
    sharedStageRef.current = current;
    return () => {
      if (sharedStageRef.current === current) {
        sharedStageRef.current = null;
      }
    };
  }, [stageRef]);
  const transformerRef = useRef<Konva.Transformer>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [guides, setGuides] = useState<{ points: number[] }[]>([]);
  /** Equal-spacing guide: the two matching gaps, plus where to draw the badge. */
  const [spacingGuide, setSpacingGuide] = useState<
    (SpacingGuide & { cross: number }) | null
  >(null);
  const [hud, setHud] = useState<{ x: number; y: number; text: string } | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const marqueeStart = useRef<{ x: number; y: number } | null>(null);
  // Non-null only while a shape tool is drawing, which is what distinguishes a
  // draw-drag from the Move tool's object rubber-band (both use `marquee` to
  // render their preview).
  const drawStart = useRef<{ x: number; y: number } | null>(null);
  /** Non-null while the Gradient tool is dragging out its angle. */
  const gradientStart = useRef<{ x: number; y: number } | null>(null);
  /** Live outline while the Artboard tool resizes the frame. */
  const [artboardPreview, setArtboardPreview] = useState<{ w: number; h: number } | null>(null);
  /** In-progress Pen path, in document space, until it is finished. */
  const [penDraft, setPenDraft] = useState<PenDraft | null>(null);
  /** True between an anchor's mousedown and mouseup, while handles can be pulled. */
  const penDragging = useRef(false);
  /** Raw pointer trail for the Freeform Pen, simplified on release. */
  const freeformTrail = useRef<{ x: number; y: number }[] | null>(null);
  // Mirror of penDraft for the window key handler, which is registered once and
  // must not re-bind on every anchor.
  const penDraftRef = useRef<PenDraft | null>(null);
  /**
   * Rotate View angle. Deliberately component state rather than store state:
   * it is a property of looking at the document, not of the document, and must
   * never reach the renderer.
   */
  const viewRotation = store((s) =>
    s.activeTool === 'rotate-view'
      ? Number(s.toolOptions['rotate-view']?.angle ?? 0)
      : 0
  );
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; targetType: 'element' | 'canvas'; elementId?: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
  const [uploadingFile, setUploadingFile] = useState(false);
  const rafIdRef = useRef<number | null>(null);
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const toaster = useToaster();
  const fetch = useFetch();
  const t = useT();

  const doc = store((s) => s.doc);
  const selectedIds = store((s) => s.selectedIds);
  const currentOutput = store((s) => s.currentOutput);
  const zoom = store((s) => s.zoom);
  const viewportX = store((s) => s.viewportX);
  const viewportY = store((s) => s.viewportY);
  const pushHistory = store((s) => s.pushHistory);
  const setSelectedIds = store((s) => s.setSelectedIds);
  const updateElement = store((s) => s.updateElement);
  const duplicateElement = store((s) => s.duplicateElement);
  const addElement = store((s) => s.addElement);
  const setZoom = store((s) => s.setZoom);
  const setViewport = store((s) => s.setViewport);
  const snapEnabled = store((s) => s.snapEnabled);
  const fitNonce = store((s) => s.fitNonce);

  const output: any = doc.outputs[currentOutput];
  const paint = usePaintTools({
    store,
    stageRef,
    output: output as DesignerOutput | undefined,
    fetchFn: fetch,
  });
  const isVideo = doc.mode === 'video';
  // Tools apply to video as well as image documents: a clip is a canvas object
  // like any other, so nothing is forced to the Move tool any more.
  const effectiveTool = store((s) => s.activeTool);
  const toolCursor = getTool(effectiveTool)?.cursor || 'default';
  const selectedClip = store((s) => s.selectedClip);
  // Read here rather than at the transformer: it must re-attach when the
  // playhead moves, since a clip that scrolls out from under it is unmounted
  // and would leave the transformer on a dead node.
  const playheadMs = store((s) => s.playheadMs);
  // The Crop tool acts on the single selected element; with nothing selected it
  // simply has no target and the overlay stays hidden.
  // In video the target is the selected clip, adapted into the element shape the
  // overlay reads — geometry plus src/crop is all it touches.
  const cropClip =
    isVideo && effectiveTool === 'crop' && selectedClip
      ? (output as unknown as VideoOutput | undefined)?.tracks
          ?.find((tr) => tr.id === selectedClip.trackId)
          ?.clips.find((c) => c.id === selectedClip.clipId)
      : undefined;
  const cropTarget = isVideo
    ? cropClip
      ? ({
          id: cropClip.id,
          type: 'image',
          x: cropClip.x ?? 0,
          y: cropClip.y ?? 0,
          width: cropClip.width ?? 100,
          height: cropClip.height ?? 100,
          rotation: cropClip.rotation ?? 0,
          opacity: 1,
          locked: false,
          hidden: false,
          src: cropClip.src,
          crop: cropClip.crop,
        } as DesignerElement)
      : undefined
    : effectiveTool === 'crop' && selectedIds.length === 1
      ? ((output as DesignerOutput | undefined)?.children || []).find(
          (c) => c.id === selectedIds[0]
        )
      : undefined;
  /** The selected path, for the anchor-editing pens and Direct Selection. */
  const penEditTarget =
    selectedIds.length === 1
      ? ((output as DesignerOutput | undefined)?.children || []).find(
          (c) => c.id === selectedIds[0] && c.type === 'path'
        )
      : undefined;

  const mousePosRef = useRef({ x: 0, y: 0 });
  const awarenessThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendAwareness = useCallback(() => {
    if (!sendImageAwareness || isVideo) return;
    sendImageAwareness(
      currentOutput,
      mousePosRef.current.x,
      mousePosRef.current.y,
      selectedIds
    );
  }, [sendImageAwareness, currentOutput, selectedIds, isVideo]);

  useEffect(() => {
    sendAwareness();
  }, [selectedIds, currentOutput, sendAwareness]);

  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setStageSize({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight,
        });
      }
    };
    updateSize();
    // Observe the container so the stage tracks panel toggles / window resize,
    // not just window resize (otherwise the canvas keeps a stale fixed size).
    const ro = new ResizeObserver(updateSize);
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener('resize', updateSize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, []);

  // Load a output background image when the output uses an image fill (C4).
  useEffect(() => {
    const src = output?.bg?.type === 'image' ? output.bg.src : undefined;
    if (!src) {
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (!cancelled) setBgImage(img);
    };
    img.onerror = () => {
      if (!cancelled) setBgImage(null);
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [output?.bg]);

  // Warm every font the document uses, then redraw. Nothing else loads fonts
  // on OPEN — `ensureFontLoaded` only ran when adding or restyling text — so
  // a doc carrying a display face (every AI-composed headline) opened in a
  // fallback serif and, Konva never being invalidated, stayed there.
  useEffect(() => {
    const families = new Set<string>();
    for (const out of doc.outputs || []) {
      for (const el of (out as DesignerOutput).children || []) {
        if (el.fontFamily) families.add(el.fontFamily);
        for (const run of el.richText || []) {
          if (run.fontFamily) families.add(run.fontFamily);
        }
      }
      for (const track of (out as any).tracks || []) {
        for (const clip of track.clips || []) {
          if (clip.fontFamily) families.add(clip.fontFamily);
        }
      }
    }
    if (!families.size) return;
    let cancelled = false;
    void ensureFontsLoaded([...families]).then(() => {
      if (!cancelled) stageRef.current?.batchDraw();
    });
    return () => {
      cancelled = true;
    };
  }, [doc]);

  useEffect(() => {
    const isTypingTarget = (t: EventTarget | null) =>
      !!(t as HTMLElement)?.matches?.('input,textarea,select') ||
      !!(t as HTMLElement)?.isContentEditable;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTypingTarget(e.target)) {
        e.preventDefault();
        setIsSpacePressed(true);
        return;
      }

      // Enter finishes an open Pen path; Escape abandons it. Handled before the
      // tool shortcuts so `p` can't restart a path you were trying to close.
      if (penDraftRef.current && (e.key === 'Enter' || e.key === 'Escape')) {
        e.preventDefault();
        const draft = penDraftRef.current;
        if (e.key === 'Enter' && draft.nodes.length >= 2) {
          const finalDraft =
            store.getState().activeTool === 'pen-curvature' ? curvatureFinish(draft) : draft;
          const el = buildPathElement(
            finalDraft,
            store.getState().toolOptions[store.getState().activeTool] || {}
          );
          if (el) {
            store.getState().addElement(el);
            store.getState().pushHistory();
          }
        }
        setPenDraft(null);
        return;
      }

      // Bare-letter tool shortcuts; Shift cycles within the group. Safe because
      // every pre-existing letter binding in image mode requires ⌘/Ctrl. Video
      // mode is excluded — the timeline owns bare `s` and Space there — and
      // inline text editing must keep its letters.
      if (
        isVideo ||
        editingTextId ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        isTypingTarget(e.target)
      ) {
        return;
      }
      const next = resolveToolShortcut(
        e.key,
        e.shiftKey,
        store.getState().activeTool,
        store.getState().lastToolPerGroup
      );
      if (next) {
        e.preventDefault();
        store.getState().setActiveTool(next);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setIsSpacePressed(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
    // Read tool state through getState() so switching tools doesn't re-bind the
    // window listener on every keystroke.
  }, [isVideo, editingTextId, store]);

  // Which elements exist, as a stable key. Depending on the whole `doc` re-ran
  // the attach effect on EVERY store write — including the per-frame writes of
  // a live transform, detaching and re-binding the transformer each frame. Node
  // identity for a given id is stable, so only the membership matters.
  const childIdsKey = ((output as DesignerOutput | undefined)?.children || [])
    .map((c) => c.id)
    .join(',');

  // Keep the window key handler's view of the draft current without re-binding
  // the listener on every anchor. Writing the ref in an effect rather than
  // during render is what react-hooks/refs requires.
  useEffect(() => {
    penDraftRef.current = penDraft;
  }, [penDraft]);

  // A paint stroke mutates the raster buffer in place, so the Konva image prop
  // keeps the same object identity and React alone won't trigger a repaint.
  useEffect(() => {
    stageRef.current?.getLayers()?.forEach((l) => l.batchDraw());
  }, [paint.paintNonce]);

  // Attach transformer to the current selection. In video mode the selection is
  // a clip rather than a list of elements, but the node lookup is the same — the
  // overlay gives each clip node its clip id.
  useEffect(() => {
    if (!transformerRef.current) return;
    const stage = stageRef.current;
    if (!stage) return;
    const ids = isVideo
      ? selectedClip?.clipId
        ? [selectedClip.clipId]
        : []
      : selectedIds;
    const nodes = ids
      .map((id) => stage.findOne('#' + id))
      .filter(Boolean) as Konva.Node[];
    transformerRef.current.nodes(nodes);
    transformerRef.current.getLayer()?.batchDraw();
  }, [selectedIds, childIdsKey, currentOutput, isVideo, selectedClip, playheadMs]);

  // Resolve a click into a selection, honoring group membership and additive (shift/meta) clicks.
  const handleElementSelect = useCallback(
    (id: string, evt?: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      if (isVideo) return;
      const children = (output as DesignerOutput | undefined)?.children || [];
      const el = children.find((c) => c.id === id);
      const groupId = el?.groupId;
      const groupIds = groupId
        ? children.filter((c) => c.groupId === groupId).map((c) => c.id)
        : [id];
      const native = evt?.evt as MouseEvent | undefined;
      const additive = !!(native && (native.shiftKey || native.metaKey || native.ctrlKey));
      if (additive) {
        const set = new Set(selectedIds);
        const allSelected = groupIds.every((g) => set.has(g));
        groupIds.forEach((g) => (allSelected ? set.delete(g) : set.add(g)));
        setSelectedIds(Array.from(set));
      } else {
        setSelectedIds(groupIds);
      }
    },
    [output, selectedIds, setSelectedIds, isVideo]
  );

  const handleStageMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (isSpacePressed || effectiveTool === 'hand') {
        setIsPanning(true);
        return;
      }

      const stage = stageRef.current;
      const pos = stage?.getRelativePointerPosition();

      // Shape tools draw by dragging a box; the preview reuses the marquee rect
      // so there is only one rubber-band implementation on the stage.
      if (effectiveTool.startsWith('shape-') && pos) {
        drawStart.current = { x: pos.x, y: pos.y };
        marqueeStart.current = { x: pos.x, y: pos.y };
        setMarquee({ x: pos.x, y: pos.y, w: 0, h: 0 });
        setSelectedIds([]);
        return;
      }

      // Paint tools: brush-family strokes and the bucket.
      if (isPaintTool(effectiveTool) && pos) {
        paint.beginPaint(effectiveTool, pos, e.evt);
        return;
      }

      // Selection tools: marquee, lasso, quick/object selection.
      if (isSelectionTool(effectiveTool) && pos) {
        if (effectiveTool === 'object-select') {
          if (selectedIds.length === 1) void paint.runObjectSelection(selectedIds[0]);
          return;
        }
        paint.beginSelection(effectiveTool, pos, e.evt);
        if (isMarqueeTool(effectiveTool)) {
          marqueeStart.current = { x: pos.x, y: pos.y };
          setMarquee({ x: pos.x, y: pos.y, w: 0, h: 0 });
        }
        return;
      }

      // Pen group. The standard and curvature pens accumulate anchors across
      // clicks; the freeform pen traces a trail. Add/Delete/Convert Anchor edit
      // the selected path in place.
      if (effectiveTool.startsWith('pen') && pos) {
        const opts = store.getState().toolOptions[effectiveTool] || {};
        const target = penEditTarget;

        if (effectiveTool === 'pen-add-anchor' && target) {
          const local = { x: pos.x - target.x, y: pos.y - target.y };
          updateElement(target.id, refitPathElement(target, addAnchorAt(target.nodes || [], !!target.closed, local)));
          pushHistory();
          return;
        }
        if (effectiveTool === 'pen-delete-anchor' && target) {
          const local = { x: pos.x - target.x, y: pos.y - target.y };
          const idx = findNodeAt(target.nodes || [], local);
          if (idx >= 0) {
            updateElement(target.id, refitPathElement(target, deleteAnchorAt(target.nodes || [], idx)));
            pushHistory();
          }
          return;
        }
        if (effectiveTool === 'pen-convert-point' && target) {
          const local = { x: pos.x - target.x, y: pos.y - target.y };
          const idx = findNodeAt(target.nodes || [], local);
          if (idx >= 0) {
            updateElement(target.id, refitPathElement(target, convertAnchorAt(target.nodes || [], idx, !!target.closed)));
            pushHistory();
          }
          return;
        }

        if (effectiveTool === 'pen-freeform') {
          freeformTrail.current = [{ x: pos.x, y: pos.y }];
          return;
        }

        // Pen / Curvature Pen: add an anchor, or close onto the first one.
        // Read the draft from the ref, not the state variable: this callback is
        // memoised without `penDraft` in its deps, so the captured value would
        // be a stale null and every click would restart a one-anchor path.
        const { draft, finished } = penClick(penDraftRef.current ?? emptyDraft(), pos);
        if (finished) {
          const finalDraft =
            effectiveTool === 'pen-curvature' ? curvatureFinish(draft) : draft;
          const el = buildPathElement(finalDraft, opts);
          if (el) {
            addElement(el);
            pushHistory();
          }
          setPenDraft(null);
        } else {
          setPenDraft(draft);
          penDragging.current = true;
        }
        return;
      }

      // Gradient: drag across the selected element to set the gradient angle.
      // `fillGradient` already exists in the schema and both renderers draw it,
      // so this tool is purely a way to author the angle by dragging.
      if (effectiveTool === 'gradient' && pos) {
        if (selectedIds.length === 1) {
          gradientStart.current = { x: pos.x, y: pos.y };
        }
        return;
      }

      // Type tools place a text box at the click and go straight into editing —
      // the click-to-place path the panel presets never had. In a video document
      // this makes a text CLIP instead; `addText` owns that difference.
      if (effectiveTool.startsWith('type-') && pos) {
        const opts = store.getState().toolOptions[effectiveTool] || {};
        const fontSize = Number(opts.fontSize ?? 32);
        const created = addText(
          store as never,
          { fontSize, ...(effectiveTool === 'type-vertical' ? {} : {}) },
          { at: { x: Math.round(pos.x), y: Math.round(pos.y) } }
        );
        if (created && !isVideo) {
          store.getState().setSelectedIds([created]);
          store.getState().updateElement(created, {
            align: 'left',
            ...(effectiveTool === 'type-vertical' ? { verticalAlign: 'top' as const } : {}),
          });
          setEditingTextId(created);
        }
        store.getState().setActiveTool('move');
        return;
      }

      // Empty-canvas press starts an OBJECT rubber-band. This is Move-tool
      // behaviour and is a different thing from the Marquee tool group, which
      // selects pixels — see the selection work in a later batch.
      if (effectiveTool !== 'move') return;
      if (e.target === e.target.getStage()) {
        const stage = stageRef.current;
        const pos = stage?.getRelativePointerPosition();
        if (pos) {
          marqueeStart.current = { x: pos.x, y: pos.y };
          setMarquee({ x: pos.x, y: pos.y, w: 0, h: 0 });
        }
        setSelectedIds([]);
        setEditingTextId(null);
        // Video keeps its selection in `selectedClip`, so clearing ids alone
        // would leave the transformer attached to a clip nothing is selecting.
        if (isVideo) store.getState().setSelectedClip(null);
      }
    },
    [
      isSpacePressed,
      effectiveTool,
      setSelectedIds,
      store,
      penEditTarget,
      selectedIds,
      addElement,
      updateElement,
      pushHistory,
      paint,
    ]
  );

  const handleStageMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const stagePos = stageRef.current?.getRelativePointerPosition();

      if (stagePos && isPaintTool(effectiveTool)) {
        paint.movePaint(effectiveTool, stagePos);
        return;
      }
      if (stagePos && isSelectionTool(effectiveTool)) {
        paint.moveSelection(effectiveTool, stagePos);
        // Marquee tools still draw the rubber-band preview below.
        if (!isMarqueeTool(effectiveTool)) return;
      }

      // Freeform Pen collects a dense trail; it is simplified on release.
      if (freeformTrail.current && stagePos) {
        freeformTrail.current.push({ x: stagePos.x, y: stagePos.y });
        setPenDraft({ nodes: freeformTrail.current.map((p) => ({ ...p })), closed: false });
        return;
      }

      // Dragging just after placing an anchor pulls its bezier handles out.
      if (penDragging.current && stagePos) {
        setPenDraft((d) => (d ? penDragHandle(d, stagePos) : d));
        return;
      }

      if (!marqueeStart.current) return;
      const stage = stageRef.current;
      const pos = stage?.getRelativePointerPosition();
      if (!pos) return;
      const s = marqueeStart.current;

      // While drawing a shape the preview honours Shift/Alt so what you see is
      // what gets inserted.
      if (drawStart.current) {
        const r = rectFromDrag(drawStart.current, pos, {
          shift: e.evt?.shiftKey,
          alt: e.evt?.altKey,
        });
        setMarquee({ x: r.x, y: r.y, w: r.width, h: r.height });
        return;
      }

      setMarquee({
        x: Math.min(s.x, pos.x),
        y: Math.min(s.y, pos.y),
        w: Math.abs(pos.x - s.x),
        h: Math.abs(pos.y - s.y),
      });
    },
    // Empty deps here silently froze the handler on the first render's tool, so
    // paint strokes only ever stamped once (on mousedown) and never dragged.
    [effectiveTool, paint]
  );

  const handleStageMouseUp = useCallback((e?: Konva.KonvaEventObject<MouseEvent>) => {
    setIsPanning(false);
    penDragging.current = false;

    const stagePos = stageRef.current?.getRelativePointerPosition();
    if (isPaintTool(effectiveTool)) {
      void paint.endPaint();
      return;
    }
    if (isSelectionTool(effectiveTool) && stagePos) {
      paint.endSelection(effectiveTool, stagePos, (e?.evt || {}) as MouseEvent);
      marqueeStart.current = null;
      setMarquee(null);
      return;
    }

    // Freeform Pen: simplify the trail into anchors and commit it in one go.
    if (freeformTrail.current) {
      const trail = freeformTrail.current;
      freeformTrail.current = null;
      setPenDraft(null);
      if (trail.length > 2) {
        const el = buildPathElement(
          freeformFinish(trail),
          store.getState().toolOptions['pen-freeform'] || {}
        );
        if (el) {
          addElement(el);
          pushHistory();
        }
      }
      return;
    }

    // Commit a gradient drag: the angle of the drag becomes the gradient angle
    // on the selected element.
    if (gradientStart.current) {
      const stage = stageRef.current;
      const pos = stage?.getRelativePointerPosition();
      const s = gradientStart.current;
      gradientStart.current = null;
      if (pos && selectedIds.length === 1) {
        const dx = pos.x - s.x;
        const dy = pos.y - s.y;
        if (Math.hypot(dx, dy) >= 4) {
          const el = ((output as DesignerOutput | undefined)?.children || []).find(
            (c) => c.id === selectedIds[0]
          );
          const angle = Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
          const opts = store.getState().toolOptions['gradient'] || {};
          updateElement(selectedIds[0], {
            fillGradient: {
              type: (opts.type as 'linear' | 'radial') || 'linear',
              angle,
              // Seed from the element's own fill so the drag reads as "fade my
              // colour out" rather than replacing it with arbitrary colours.
              stops: [
                { offset: 0, color: el?.fill || '#2B5CD3' },
                { offset: 1, color: '#FFFFFF' },
              ],
            },
          });
          pushHistory();
        }
      }
      return;
    }

    // Commit a drawn shape.
    if (drawStart.current) {
      const rect = marquee
        ? { x: marquee.x, y: marquee.y, width: marquee.w, height: marquee.h }
        : null;
      if (rect && isMeaningfulDraw(rect)) {
        const opts = store.getState().toolOptions[effectiveTool] || {};
        if (isVideo) {
          // A shape drawn on a timeline is a clip on a shape track, created on
          // demand — the same shape, expressed in the other document model.
          const st = store.getState();
          const vo = st.doc.outputs[st.currentOutput] as unknown as VideoOutput;
          let track = vo.tracks?.find((tr) => tr.type === 'shape');
          if (!track) {
            st.addTrack(st.currentOutput, 'shape');
            const refreshed = store.getState().doc.outputs[st.currentOutput] as unknown as VideoOutput;
            track = refreshed.tracks.find((tr) => tr.type === 'shape');
          }
          if (track) {
            store.getState().addClip(
              st.currentOutput,
              track.id,
              buildShapeClip(effectiveTool, rect, st.playheadMs, vo.durationMs, opts)
            );
          }
        } else {
          store.getState().addElement(buildShapeElement(effectiveTool, rect, opts));
        }
        store.getState().pushHistory();
        // Photoshop keeps the shape tool active after drawing; switching to
        // Move here would fight anyone laying out several shapes in a row.
      }
      drawStart.current = null;
      marqueeStart.current = null;
      setMarquee(null);
      return;
    }

    if (marqueeStart.current && marquee && (marquee.w > 3 || marquee.h > 3)) {
      const hits = ((output as DesignerOutput | undefined)?.children || [])
        .filter((el) => !el.hidden && !el.locked)
        .filter(
          (el) =>
            el.x < marquee.x + marquee.w &&
            el.x + el.width > marquee.x &&
            el.y < marquee.y + marquee.h &&
            el.y + el.height > marquee.y
        )
        .map((el) => el.id);
      if (hits.length) setSelectedIds(hits);
    }
    marqueeStart.current = null;
    setMarquee(null);
  }, [
    marquee,
    output,
    setSelectedIds,
    effectiveTool,
    store,
    selectedIds,
    updateElement,
    pushHistory,
    addElement,
    paint,
  ]);

  // Snapping during drag: align edges/centers to other elements + output guides (B3).
  const computeSnap = useCallback(
    (node: Konva.Node) => {
      if (!output || isVideo) return;
      if (!snapEnabled) { setGuides([]); setSpacingGuide(null); return; }
      const others = ((output as DesignerOutput | undefined)?.children || []).filter((el) => !selectedIds.includes(el.id) && !el.hidden);
      const w = node.width() * node.scaleX();
      const h = node.height() * node.scaleY();
      const targetsX = [0, output.width / 2, output.width];
      const targetsY = [0, output.height / 2, output.height];
      others.forEach((el) => {
        targetsX.push(el.x, el.x + el.width / 2, el.x + el.width);
        targetsY.push(el.y, el.y + el.height / 2, el.y + el.height);
      });
      const lines: { points: number[] }[] = [];
      const edgesX = [node.x(), node.x() + w / 2, node.x() + w];
      const edgesY = [node.y(), node.y() + h / 2, node.y() + h];
      let snapDX: number | null = null;
      let snapDY: number | null = null;
      edgesX.forEach((ex) => {
        targetsX.forEach((tx) => {
          if (Math.abs(ex - tx) <= SNAP && (snapDX === null || Math.abs(tx - ex) < Math.abs(snapDX))) {
            snapDX = tx - ex;
            lines.push({ points: [tx, 0, tx, output.height] });
          }
        });
      });
      edgesY.forEach((ey) => {
        targetsY.forEach((ty) => {
          if (Math.abs(ey - ty) <= SNAP && (snapDY === null || Math.abs(ty - ey) < Math.abs(snapDY))) {
            snapDY = ty - ey;
            lines.push({ points: [0, ty, output.width, ty] });
          }
        });
      });
      if (snapDX !== null) node.x(node.x() + snapDX);
      if (snapDY !== null) node.y(node.y() + snapDY);

      // Equal-spacing detection, on top of the edge/centre snaps. This is what
      // separates a smart guide from a plain one: it can tell you three cards
      // are evenly spread, which no edge comparison can.
      const spacing = findEqualSpacing(
        { id: '__moving', x: node.x(), y: node.y(), width: w, height: h },
        others.map((el) => ({ id: el.id, x: el.x, y: el.y, width: el.width, height: el.height })),
        SNAP
      );
      setSpacingGuide(
        spacing
          ? {
              ...spacing,
              // The badge sits on the axis the gap runs along, centred in it.
              cross: spacing.axis === 'x' ? node.y() + h / 2 : node.x() + w / 2,
            }
          : null
      );

      setGuides(lines);
      setHud({ x: node.x(), y: node.y() - 22, text: `${Math.round(node.x())}, ${Math.round(node.y())}` });
    },
    [output, selectedIds, snapEnabled, isVideo]
  );

  // Element drags fire on the element node itself and bubble to the Layer (the
  // Transformer is a sibling and never sees them), so these handlers live on the
  // <Layer>. `e.target.id()` is the real dragged element there. For a
  // multi-selection the Transformer moves every attached node together, so on
  // drag-end we persist all of them.
  const handleDragMove = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      if (e.target === e.target.getStage()) return;
      computeSnap(e.target);
      if (rafIdRef.current) return;
      rafIdRef.current = requestAnimationFrame(() => {
        const node = e.target;
        const id = node.id();
        if (id) {
          updateElement(id, { x: node.x(), y: node.y() });
        }
        rafIdRef.current = null;
      });
    },
    [computeSnap, updateElement]
  );

  const handleDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      setGuides([]);
      setSpacingGuide(null);
      setHud(null);
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (e.target === e.target.getStage()) return;
      const trNodes = transformerRef.current?.nodes() || [];
      const nodes = trNodes.length > 1 ? trNodes : [e.target];
      let changed = false;
      nodes.forEach((node) => {
        const id = node.id();
        if (id) {
          updateElement(id, { x: node.x(), y: node.y() });
          changed = true;
        }
      });
      if (changed) pushHistory();
    },
    [pushHistory, updateElement]
  );

  /**
   * Bake every transforming node's live scale into absolute width/height (and,
   * for corner-dragged flat text, fontSize) and hand the numbers to the store.
   *
   * Two things here are load-bearing:
   *
   * 1. The scale reset is SYNCHRONOUS. The store write may be throttled, but
   *    the node's scale must go back to 1 in the same tick it was read, because
   *    react-konva re-applies `width` from the store and never touches `scale`
   *    — deferring the reset let the new width stack on top of the old scale
   *    and the box grew on every frame.
   * 2. Every attached node is processed. Konva fires `transformend` once, with
   *    the transformer's first node as the target, so keying off `e.target`
   *    left the rest of a multi-selection permanently scaled with stale stored
   *    geometry — corruption that persisted into saves and exports.
   */
  const bakeTransform = useCallback(
    (e: Konva.KonvaEventObject<Event>) => {
      const trNodes = transformerRef.current?.nodes() || [];
      const nodes = trNodes.length > 0 ? trNodes : [e.target];
      const anchor = transformerRef.current?.getActiveAnchor();
      const children =
        (store.getState().doc.outputs[store.getState().currentOutput] as
          | DesignerOutput
          | undefined)?.children || [];

      const patches: { id: string; patch: ReturnType<typeof buildResizePatch> }[] = [];
      nodes.forEach((node) => {
        const id = node.id();
        if (!id) return;
        const el = children.find((c) => c.id === id);
        if (!el) return;
        const patch = buildResizePatch(
          el,
          {
            x: node.x(),
            y: node.y(),
            width: node.width(),
            height: node.height(),
            scaleX: node.scaleX(),
            scaleY: node.scaleY(),
            rotation: node.rotation(),
          },
          anchor
        );
        patches.push({ id, patch });
        // Synchronous: fold the scale into the node's own size so the next
        // mousemove measures from a scale of 1 (see note 1 above).
        node.width(patch.width);
        node.height(patch.height);
        node.scaleX(1);
        node.scaleY(1);
      });
      return patches;
    },
    [store]
  );

  const handleTransform = useCallback(
    (e: Konva.KonvaEventObject<Event>) => {
      // Clips write their own geometry from the overlay, which knows the track
      // and the keyframe rule; these element patches would target a clip id.
      if (isVideo) return;
      const patches = bakeTransform(e);
      const first = patches[0];
      if (first) {
        setHud({
          x: first.patch.x,
          y: first.patch.y - 22,
          text: `${Math.round(first.patch.width)} × ${Math.round(first.patch.height)}`,
        });
      }
      // Throttle only the store write; the node attrs above are already correct.
      if (rafIdRef.current) return;
      rafIdRef.current = requestAnimationFrame(() => {
        patches.forEach(({ id, patch }) => updateElement(id, patch));
        rafIdRef.current = null;
      });
    },
    [bakeTransform, updateElement, isVideo]
  );

  const handleTransformEnd = useCallback(
    (e: Konva.KonvaEventObject<Event>) => {
      setHud(null);
      if (isVideo) return;
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      const patches = bakeTransform(e);
      if (!patches.length) return;
      patches.forEach(({ id, patch }) => updateElement(id, patch));
      pushHistory();
    },
    [bakeTransform, pushHistory, updateElement, isVideo]
  );

  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();
      const scaleBy = 1.1;
      const stage = stageRef.current;
      if (!stage) return;
      const oldScale = stage.scaleX();
      const pointer = stage.getPointerPosition();
      if (!pointer) return;
      const mousePointTo = {
        x: pointer.x / oldScale - stage.x() / oldScale,
        y: pointer.y / oldScale - stage.y() / oldScale,
      };
      const newScale = e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy;
      const clampedScale = Math.max(0.1, Math.min(5, newScale));
      stage.scale({ x: clampedScale, y: clampedScale });
      const newPos = {
        x: -(mousePointTo.x - pointer.x / clampedScale) * clampedScale,
        y: -(mousePointTo.y - pointer.y / clampedScale) * clampedScale,
      };
      stage.position(newPos);
      setZoom(clampedScale);
      setViewport(newPos.x, newPos.y);
    },
    [setZoom, setViewport]
  );

  const fitToScreen = useCallback(() => {
    if (!stageSize.width || !stageSize.height) return;
    const scaleX = stageSize.width / output.width;
    const scaleY = stageSize.height / output.height;
    const next = Math.min(scaleX, scaleY) * FIT_PADDING;
    setZoom(next);
    setViewport(
      (stageSize.width - output.width * next) / 2,
      (stageSize.height - output.height * next) / 2
    );
  }, [stageSize, output.width, output.height, setZoom, setViewport]);

  // Auto fit-to-screen once the stage is measured and whenever the doc's
  // dimensions change (preset pick, opening with an asset). Keyed
  // on doc size so it does NOT refight on panel toggles or after the user zooms
  // — only a genuine canvas-size change re-fits.
  const lastFitKey = useRef('');
  useEffect(() => {
    if (!stageSize.width || !stageSize.height) return;
    const key = `${output.width}x${output.height}`;
    if (lastFitKey.current === key) return;
    lastFitKey.current = key;
    fitToScreen();
  }, [stageSize.width, stageSize.height, output.width, output.height, fitToScreen]);

  // Explicit Fit-to-Screen requests from the View menu (D-12). The store bumps
  // fitNonce; skip the very first value so this doesn't double-fit on mount.
  const lastFitNonce = useRef(fitNonce);
  useEffect(() => {
    if (lastFitNonce.current === fitNonce) return;
    lastFitNonce.current = fitNonce;
    fitToScreen();
  }, [fitNonce, fitToScreen]);

  // Refit the canvas when the viewport changes (window/browser resize, device
  // tilt/orientation) — rescales to fit and re-centers in the gray area, which
  // reads better than a same-zoom recenter on big aspect changes. Only fires on
  // a genuine stage-size change (side panels are absolute overlays, so toggling
  // them doesn't trigger this). The first measurement is owned by the
  // fit-on-doc-size effect above, so skip it here.
  const lastStageSize = useRef({ width: 0, height: 0 });
  useEffect(() => {
    const width = stageSize.width;
    const height = stageSize.height;
    const prev = lastStageSize.current;
    lastStageSize.current = { width, height };
    if (!width || !height) return;
    if (!prev.width || !prev.height) return; // first real measurement → initial fit owns it
    if (prev.width === width && prev.height === height) return;
    fitToScreen();
  }, [stageSize.width, stageSize.height, fitToScreen]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (editingTextId) return;
      const st = store.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        st.removeElements(selectedIds);
      } else if (e.key === 'Escape') {
        setSelectedIds([]);
        if (isVideo) st.setSelectedClip(null);
      } else if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        // Photoshop: ⌘A selects PIXELS, ⌥⌘A selects layers.
        if (e.altKey) {
          setSelectedIds(((output as any)?.children || []).filter((c: any) => !c.hidden).map((c: any) => c.id));
        } else if (output) {
          st.setSelection(fullMask(output.width, output.height));
        }
      } else if (mod && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        st.copySelection();
      } else if (mod && e.key.toLowerCase() === 'x') {
        e.preventDefault();
        st.cutSelection();
      } else if (mod && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        st.paste();
      } else if (mod && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        if (e.shiftKey) st.ungroupSelection();
        else st.groupSelection();
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        // ⌘D deselects, ⇧⌘D reselects — Duplicate keeps ⌘J on the Layer menu.
        if (e.shiftKey) {
          if (!st.selection && st.lastSelection) st.setSelection(st.lastSelection);
        } else {
          st.setSelection(null);
        }
      } else if (mod && e.key.toLowerCase() === 'i' && e.shiftKey) {
        e.preventDefault();
        if (st.selection) st.setSelection(invertMask(st.selection));
      } else if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        if (selectedIds.length === 0) return;
        const delta = e.shiftKey ? 10 : 1;
        let dx = 0;
        let dy = 0;
        if (e.key === 'ArrowUp') dy = -delta;
        if (e.key === 'ArrowDown') dy = delta;
        if (e.key === 'ArrowLeft') dx = -delta;
        if (e.key === 'ArrowRight') dx = delta;
        let moved = false;
        selectedIds.forEach((id) => {
          const el = ((output as any)?.children || []).find((c: any) => c.id === id);
          if (!el || el.locked || el.hidden) return;
          updateElement(id, { x: el.x + dx, y: el.y + dy });
          moved = true;
        });
        if (moved) pushHistory();
      } else if (e.key === 'Enter') {
        if (selectedIds.length === 1) {
          const el = ((output as any)?.children || []).find((c: any) => c.id === selectedIds[0]);
          if (el?.type === 'text') setEditingTextId(el.id);
        }
      }
    },
    [editingTextId, selectedIds, setSelectedIds, updateElement, output, duplicateElement, store, pushHistory]
  );

  const handleStageDblClick = useCallback(

    (e: Konva.KonvaEventObject<any>) => {
      // The polygonal lasso's gesture spans several clicks; a double-click is
      // what closes it (the two extra vertices it adds are coincident and
      // harmless to the polygon fill).
      if (effectiveTool === 'lasso-polygonal') {
        paint.closePolygonalLasso(!!e.evt?.shiftKey, !!e.evt?.altKey);
        return;
      }
      const target = e.target;
      const id = target.id() || target.getParent()?.id();
      if (id) {
        const el = ((output as any)?.children || []).find((c: any) => c.id === id);
        if (el?.type === 'text') setEditingTextId(id);
      }
    },
    [output, effectiveTool, paint]
  );

  // Drop from panels (designer elements) and OS file drops.
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      containerRef.current?.classList.remove('designer-drop-active');

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const px = (e.clientX - rect.left - viewportX) / zoom;
      const py = (e.clientY - rect.top - viewportY) / zoom;

      const raw = e.dataTransfer.getData('application/x-designer-element');
      if (raw) {
        if (isVideo) return;
        let payload: Partial<DesignerElement>;
        try {
          payload = JSON.parse(raw);
        } catch {
          return;
        }
        const w = payload.width || 200;
        const h = payload.height || 200;
        addElement({
          id: '',
          type: payload.type || 'image',
          x: px,
          y: py,
          width: w,
          height: h,
          rotation: 0,
          opacity: 1,
          locked: false,
          hidden: false,
          ...payload,
        } as DesignerElement);
        return;
      }

      const files = e.dataTransfer.files;
      if (!files.length) return;

      const file = files[0];
      if (!file.type.startsWith('image/')) return;

      if (isVideo) return;

      setUploadingFile(true);
      const formData = new FormData();
      formData.append('file', file);

      fetch('/files/upload-simple', { method: 'POST', body: formData })
        .then(async (res) => {
          if (!res.ok) throw new Error('Upload failed');
          const data = await res.json() as { id: string; path: string };

          const img = new Image();
          img.onload = () => {
            const natW = img.naturalWidth || 400;
            const natH = img.naturalHeight || 400;
            const { width: w, height: h } = fitWithin(natW, natH, output.width * 0.8, output.height * 0.8);

            store.getState().addElement({
              id: '',
              type: 'image',
              x: px,
              y: py,
              width: w,
              height: h,
              rotation: 0,
              opacity: 1,
              locked: false,
              hidden: false,
              src: data.path,
              fileId: data.id,
              naturalWidth: natW,
              naturalHeight: natH,
              fitMode: 'cover',
              focalPoint: { x: 0.5, y: 0.5 },
            });
            setUploadingFile(false);
          };
          img.onerror = () => {
            setUploadingFile(false);
            toaster.show(t('failed_to_load_dropped_image', 'Failed to load dropped image'), 'warning');
          };
          img.src = data.path;
        })
        .catch(() => {
          setUploadingFile(false);
          toaster.show(t('failed_to_upload_file', 'Failed to upload file'), 'warning');
        });
    },
    [addElement, viewportX, viewportY, zoom, store, output, toaster, fetch, isVideo, t]
  );

  const bg = output?.bg;
  const bgGrad =
    bg?.type === 'gradient' ? gradientFillProps(bg.gradient, output.width, output.height) : {};

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      ref={containerRef}
      className="flex-1 min-w-0 relative overflow-hidden bg-[#e5e7eb] designer-canvas-container"
      // Space-to-pan always wins over the tool's own cursor, so the transient
      // Hand reads correctly no matter which tool is selected.
      style={{
        cursor: isPanning
          ? 'grabbing'
          : isSpacePressed
            ? 'grab'
            : isVideo
              ? 'default'
              : toolCursor,
      }}
      tabIndex={0} // eslint-disable-line jsx-a11y/no-noninteractive-tabindex
      role="application"
      aria-label={t('design_canvas', 'Design canvas')}
      onKeyDown={handleKeyDown}
      onMouseMove={(e) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        mousePosRef.current = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        };
        if (!sendImageAwareness || isVideo) return;
        if (awarenessThrottleRef.current) return;
        awarenessThrottleRef.current = setTimeout(() => {
          awarenessThrottleRef.current = null;
          sendAwareness();
        }, 50);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect) {
          setDragPosition({
            x: (e.clientX - rect.left - viewportX) / zoom,
            y: (e.clientY - rect.top - viewportY) / zoom,
          });
        }
        setDragOver(true);
        containerRef.current?.classList.add('designer-drop-active');
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragOver(false);
        containerRef.current?.classList.remove('designer-drop-active');
      }}
      onDrop={handleDrop}
    >
      <Stage
        ref={stageRef}
        className="konva-stage"
        width={stageSize.width}
        height={stageSize.height}
        x={viewportX}
        y={viewportY}
        scaleX={zoom}
        scaleY={zoom}
        // Rotate View turns the CANVAS, never the document — it is a viewing
        // aid, so nothing here is persisted or exported.
        rotation={viewRotation}
        onWheel={handleWheel}
        onDblClick={handleStageDblClick}
        onDblTap={handleStageDblClick}
        // The Hand tool pans the same way Space does; both route through the
        // Stage's own drag and commit via onDragEnd below.
        draggable={isSpacePressed || effectiveTool === 'hand'}
        onMouseDown={handleStageMouseDown}
        onMouseMove={handleStageMouseMove}
        onMouseUp={handleStageMouseUp}
        onMouseLeave={() => {
          setIsPanning(false);
          marqueeStart.current = null;
          setMarquee(null);
        }}
        onDragEnd={(e) => {
          if (e.target === e.target.getStage()) {
            setIsPanning(false);
            setViewport(e.target.x(), e.target.y());
          }
        }}
        onContextMenu={(e) => {
          e.evt.preventDefault();
          if (e.target === e.target.getStage()) {
            setContextMenu({ x: e.evt.clientX, y: e.evt.clientY, targetType: 'canvas' });
          }
        }}
      >
        <Layer onDragMove={handleDragMove} onDragEnd={handleDragEnd}>
          <Rect
            x={0}
            y={0}
            width={output.width}
            height={output.height}
            fill={bg?.type === 'gradient' ? undefined : bg?.color || output?.background || '#ffffff'}
            {...bgGrad}
            shadowColor="rgba(0,0,0,0.3)"
            shadowBlur={20}
            shadowOffset={{ x: 0, y: 4 }}
          />
          <CanvasElements
            elements={isVideo ? [] : (output?.children || [])}
            symbols={doc.symbols}
            // Re-cache the adjustment scopes once the bg image arrives — see
            // `backdropKey` on ElementsProps.
            backdropKey={bgImage ? 'bg-loaded' : 'bg-pending'}
            // The Rect above keeps the page drop-shadow (editor chrome, which
            // must never be filtered); this fill-only copy is what an
            // adjustment layer sees, matching the server's page readback.
            backdrop={
              <Group key="__backdrop" listening={false}>
                <Rect
                  x={0}
                  y={0}
                  width={output.width}
                  height={output.height}
                  fill={bg?.type === 'gradient' ? undefined : bg?.color || output?.background || '#ffffff'}
                  {...bgGrad}
                  listening={false}
                />
                {bg?.type === 'image' && bgImage && (
                  <KonvaImage image={bgImage} x={0} y={0} width={output.width} height={output.height} listening={false} />
                )}
              </Group>
            }
            onSelect={handleElementSelect}
            onContextMenu={(elementId, clientX, clientY) => {
              setContextMenu({ x: clientX, y: clientY, targetType: 'element', elementId });
            }}
            // Only the Move tool drags elements; every other tool needs the
            // press for itself. Space-pan also suspends dragging so a pan that
            // starts over an element doesn't move it.
            interactive={effectiveTool === 'move' && !isSpacePressed}
          />
          {isVideo && (
            <VideoCanvasOverlay
              store={store}
              width={output.width}
              height={output.height}
              interactive={effectiveTool === 'move' && !isSpacePressed}
              onEditText={setEditingTextId}
            />
          )}
          {guides.map((g) => (
            <KonvaLine key={g.points.join(',')} points={g.points} stroke="#FF3B7F" strokeWidth={1 / zoom} dash={[4, 4]} listening={false} />
          ))}
          {/* Equal-spacing measurement: a bar across each matching gap, with the
              distance stated once. Illustrator draws the same thing. */}
          {spacingGuide?.spans.map((span, i) => {
            const horizontal = spacingGuide.axis === 'x';
            const mid = (span.from + span.to) / 2;
            return (
              <React.Fragment key={`${span.from}-${span.to}-${i}`}>
                <KonvaLine
                  points={
                    horizontal
                      ? [span.from, spacingGuide.cross, span.to, spacingGuide.cross]
                      : [spacingGuide.cross, span.from, spacingGuide.cross, span.to]
                  }
                  stroke="#FF3B7F"
                  strokeWidth={1 / zoom}
                  listening={false}
                />
                <KonvaText
                  x={horizontal ? mid : spacingGuide.cross + 4 / zoom}
                  y={horizontal ? spacingGuide.cross - 14 / zoom : mid}
                  text={String(Math.round(spacingGuide.gap))}
                  fontSize={11 / zoom}
                  fill="#FF3B7F"
                  listening={false}
                />
              </React.Fragment>
            );
          })}
          {showSafeZones && safeZonePreset && (
            <SafeZoneOverlay presetId={safeZonePreset} width={output.width} height={output.height} visible={true} />
          )}
          {marquee && (
            <Rect
              x={marquee.x}
              y={marquee.y}
              width={marquee.w}
              height={marquee.h}
              fill="rgba(43,92,211,0.12)"
              stroke="#2B5CD3"
              strokeWidth={1 / zoom}
              listening={false}
            />
          )}
          {/* Marching ants for the active pixel selection. Drawn as boundary
              segments rather than a re-rasterised outline so it stays crisp at
              any zoom. */}
          {paint.selection && (
            <KonvaLine
              points={[]}
              listening={false}
              sceneFunc={(ctx: Konva.Context, shape: Konva.Shape) => {
                ctx.beginPath();
                for (const [x1, y1, x2, y2] of maskOutline(paint.selection!)) {
                  ctx.moveTo(x1, y1);
                  ctx.lineTo(x2, y2);
                }
                ctx.strokeShape(shape);
              }}
              stroke="#ffffff"
              strokeWidth={1 / zoom}
              dash={[4 / zoom, 4 / zoom]}
              shadowColor="#000000"
              shadowBlur={2 / zoom}
            />
          )}

          {/* In-progress lasso trail. */}
          {paint.lassoPoints && paint.lassoPoints.length > 1 && (
            <KonvaLine
              points={paint.lassoPoints.flatMap((p) => [p.x, p.y])}
              stroke="#2B5CD3"
              strokeWidth={1.5 / zoom}
              dash={[4 / zoom, 3 / zoom]}
              listening={false}
            />
          )}

          {/* In-progress Pen path: the curve so far plus its anchors, so the
              user can see what closing the path would produce. */}
          {penDraft && penDraft.nodes.length > 0 && (
            <>
              <Shape
                listening={false}
                sceneFunc={(ctx: Konva.Context, shape: Konva.Shape) => {
                  tracePathNodes(ctx as never, penDraft.nodes, penDraft.closed);
                  ctx.strokeShape(shape);
                }}
                stroke="#2B5CD3"
                strokeWidth={1.5 / zoom}
              />
              {penDraft.nodes.map((n, i) => (
                <Rect
                  key={`pen-anchor-${i}`}
                  x={n.x - 3 / zoom}
                  y={n.y - 3 / zoom}
                  width={6 / zoom}
                  height={6 / zoom}
                  fill={i === 0 ? '#2B5CD3' : '#ffffff'}
                  stroke="#2B5CD3"
                  strokeWidth={1 / zoom}
                  listening={false}
                />
              ))}
            </>
          )}

          {/* Direct Selection: expose the selected path's anchors for dragging. */}
          {effectiveTool === 'direct-select' && penEditTarget && (
            <>
              {(penEditTarget.nodes || []).map((n, i) => (
                <Rect
                  key={`node-${i}`}
                  x={penEditTarget.x + n.x - 4 / zoom}
                  y={penEditTarget.y + n.y - 4 / zoom}
                  width={8 / zoom}
                  height={8 / zoom}
                  fill="#ffffff"
                  stroke="#2B5CD3"
                  strokeWidth={1 / zoom}
                  draggable={true}
                  onDragEnd={(e) => {
                    const node = e.target;
                    const nodes = (penEditTarget.nodes || []).slice();
                    const dx = node.x() + 4 / zoom - (penEditTarget.x + nodes[i].x);
                    const dy = node.y() + 4 / zoom - (penEditTarget.y + nodes[i].y);
                    nodes[i] = {
                      ...nodes[i],
                      x: nodes[i].x + dx,
                      y: nodes[i].y + dy,
                      ...(typeof nodes[i].inX === 'number'
                        ? { inX: (nodes[i].inX as number) + dx, inY: (nodes[i].inY as number) + dy }
                        : {}),
                      ...(typeof nodes[i].outX === 'number'
                        ? { outX: (nodes[i].outX as number) + dx, outY: (nodes[i].outY as number) + dy }
                        : {}),
                    };
                    updateElement(penEditTarget.id, refitPathElement(penEditTarget, nodes));
                    pushHistory();
                  }}
                />
              ))}
            </>
          )}

          {/* Artboard tool: drag the frame's corner to resize the output. The
              inspector's numeric Width/Height stay the precise route; this is
              the direct-manipulation one. */}
          {effectiveTool === 'artboard' && output && (
            <Rect
              x={output.width - 14 / zoom}
              y={output.height - 14 / zoom}
              width={14 / zoom}
              height={14 / zoom}
              fill="#ffffff"
              stroke="#2B5CD3"
              strokeWidth={1.5 / zoom}
              draggable={true}
              onDragMove={(e) => {
                const node = e.target;
                const w = Math.max(16, Math.round(node.x() + 14 / zoom));
                const h = Math.max(16, Math.round(node.y() + 14 / zoom));
                setArtboardPreview({ w, h });
              }}
              onDragEnd={(e) => {
                const node = e.target;
                const w = Math.max(16, Math.round(node.x() + 14 / zoom));
                const h = Math.max(16, Math.round(node.y() + 14 / zoom));
                setArtboardPreview(null);
                store.getState().resizeOutput(currentOutput, w, h);
                pushHistory();
              }}
            />
          )}
          {artboardPreview && (
            <Rect
              x={0}
              y={0}
              width={artboardPreview.w}
              height={artboardPreview.h}
              stroke="#2B5CD3"
              strokeWidth={1.5 / zoom}
              dash={[6 / zoom, 4 / zoom]}
              listening={false}
            />
          )}

          {/* Crop tool: direct-manipulation overlay over the selected element.
              The inspector's percentage sliders remain the numeric route; both
              compose onto any existing crop through crop-geometry. */}
          {effectiveTool === 'crop' && cropTarget && (
            <CropOverlay
              key={cropTarget.id}
              element={cropTarget}
              natural={getImageNaturalSize(cropTarget.src)}
              zoom={zoom}
              ratio={String(store.getState().toolOptions['crop']?.ratio ?? 'free')}
              onCommit={(patch) => {
                if (isVideo && selectedClip) {
                  store.getState().updateClip(
                    selectedClip.outputIndex,
                    selectedClip.trackId,
                    selectedClip.clipId,
                    patch as never
                  );
                } else {
                  updateElement(cropTarget.id, patch);
                }
                pushHistory();
                store.getState().setActiveTool('move');
              }}
              onCancel={() => store.getState().setActiveTool('move')}
            />
          )}

          {/* Transform handles belong to the Move tool. Other tools keep the
              selection but hide the handles, so a stray anchor can't swallow a
              brush stroke or a marquee drag. */}
          {/* A video document selects a CLIP rather than element ids, so the
              handles have to key off whichever selection this document uses. */}
          {(isVideo ? !!selectedClip : selectedIds.length > 0) &&
            effectiveTool === 'move' && (
            <Transformer
              ref={transformerRef}
              rotateEnabled={true}
              enabledAnchors={['top-left', 'top-center', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right']}
              borderStroke="#2B5CD3"
              borderStrokeWidth={1.5}
              anchorFill="#ffffff"
              anchorStroke="#2B5CD3"
              anchorSize={10}
              anchorCornerRadius={5}
              rotateAnchorOffset={24}
              onTransform={handleTransform}
              onTransformEnd={handleTransformEnd}
            />
          )}
        </Layer>
      </Stage>

      {dragOver && !uploadingFile && (
        <div
          className="absolute pointer-events-none z-40 w-12 h-12 -translate-x-1/2 -translate-y-1/2 border-2 border-dashed border-designerAccent rounded-lg bg-designerAccent/10"
          style={{
            left: dragPosition.x * zoom + viewportX,
            top: dragPosition.y * zoom + viewportY,
          }}
        />
      )}

      {uploadingFile && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#e5e7eb]/60">
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-newBgColorInner border border-studioBorder text-[13px] text-textColor">
            <svg className={`w-4 h-4 ${reduceMotion ? '' : 'animate-spin'}`} viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" opacity="0.3" />
              <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
            {t('uploading_ellipsis', 'Uploading…')}
          </div>
        </div>
      )}

      {showRulers && (
        <Rulers
          zoom={zoom}
          viewportX={viewportX}
          viewportY={viewportY}
          width={stageSize.width}
          height={stageSize.height}
        />
      )}

      {hud && (
        <div
          className="absolute pointer-events-none z-10 px-2 py-1 rounded bg-designerAccent text-white text-[11px] font-medium"
          style={{ left: viewportX + hud.x * zoom, top: viewportY + hud.y * zoom }}
        >
          {hud.text}
        </div>
      )}

      {editingTextId && !isVideo && (() => {
        const el = ((output as any)?.children || []).find((c: any) => c.id === editingTextId);
        if (!el || el.type !== 'text') return null;
        return (
          <TextEditingOverlay
            element={el}
            stageRect={{ x: viewportX, y: viewportY, scale: zoom }}
            onUpdate={updateElement}
            onComplete={() => setEditingTextId(null)}
          />
        );
      })()}

      {/* Same editor over a text CLIP. The overlay only reads geometry and type
          fields, so a clip is adapted into that shape rather than the component
          being taught about two document models. Geometry comes from the
          COMPOSED props so the editor sits over an animated clip correctly. */}
      {editingTextId && isVideo && (() => {
        const vo = output as unknown as VideoOutput | undefined;
        if (!vo?.tracks) return null;
        const track = vo.tracks.find((tr) =>
          tr.clips.some((c) => c.id === editingTextId)
        );
        const clip = track?.clips.find((c) => c.id === editingTextId);
        if (!track || !clip) return null;
        const composed = composeClipsAtPlayhead(vo, playheadMs).find(
          (c) => c.clip.id === editingTextId
        );
        const boxProps = composed?.props;
        const pseudo = {
          id: clip.id,
          type: 'text',
          x: boxProps?.x ?? clip.x ?? 0,
          y: boxProps?.y ?? clip.y ?? 0,
          width: boxProps?.width ?? clip.width ?? 200,
          height: boxProps?.height ?? clip.height ?? 40,
          rotation: boxProps?.rotation ?? clip.rotation ?? 0,
          opacity: 1,
          locked: false,
          hidden: false,
          text: clip.text || '',
          fontFamily: clip.fontFamily,
          fontSize: clip.fontSize,
          fontWeight: clip.fontWeight,
          fill: clip.fill,
        } as DesignerElement;
        return (
          <TextEditingOverlay
            element={pseudo}
            stageRect={{ x: viewportX, y: viewportY, scale: zoom }}
            onUpdate={(id, updates) =>
              store.getState().updateClip(currentOutput, track.id, id, {
                text: updates.text,
              })
            }
            onComplete={() => setEditingTextId(null)}
          />
        );
      })()}

      <div className="absolute bottom-4 right-4 flex items-center gap-2 bg-newBgColorInner border border-studioBorder rounded-lg px-3 py-2 text-[12px] text-newTextColor/60">
        <button
          onClick={() => setZoom(zoom / 1.25)}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-studioBorder/30"
          aria-label={t('zoom_out', 'Zoom out')}
        >
          −
        </button>
        <span className="min-w-[40px] text-center">{Math.round(zoom * 100)}%</span>
        <button
          onClick={() => setZoom(zoom * 1.25)}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-studioBorder/30"
          aria-label={t('zoom_in', 'Zoom in')}
        >
          +
        </button>
        <button
          onClick={fitToScreen}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-studioBorder/30 text-[10px]"
          aria-label={t('fit_to_screen', 'Fit to screen')}
        >
          ⊞
        </button>
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          targetType={contextMenu.targetType}
          elementId={contextMenu.elementId}
          store={store}
          onClose={() => setContextMenu(null)}
          onAddImage={onAddImage}
        />
      )}
    </div>
  );
};
