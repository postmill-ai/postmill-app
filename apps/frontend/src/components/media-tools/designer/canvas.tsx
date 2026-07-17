'use client';

import React, { FC, useCallback, useRef, useEffect, useState } from 'react';
import { Stage, Layer, Transformer, Rect, Line as KonvaLine, Image as KonvaImage } from 'react-konva';
import type Konva from 'konva';
import { CanvasElements, gradientFillProps } from './elements';
import { TextEditingOverlay } from './text-editing';
import { SafeZoneOverlay } from './safe-zones';
import { Rulers } from './rulers';
import { ContextMenu } from './context-menu';
import { fitWithin } from './panels/fit-within';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import type { DesignerElement, DesignerOutput } from './designer.store';
import { VideoCanvasOverlay } from './video-canvas-overlay';
import { sharedStageRef } from './stage-ref';

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
  const [hud, setHud] = useState<{ x: number; y: number; text: string } | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const marqueeStart = useRef<{ x: number; y: number } | null>(null);
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
  const isVideo = doc.mode === 'video';

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.code === 'Space' &&
        !(e.target as HTMLElement)?.matches?.('input,textarea') &&
        !(e.target as HTMLElement)?.isContentEditable
      ) {
        e.preventDefault();
        setIsSpacePressed(true);
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
  }, []);

  // Attach transformer to the current selection.
  useEffect(() => {
    if (!transformerRef.current) return;
    const stage = stageRef.current;
    if (!stage) return;
    const nodes = selectedIds
      .map((id) => stage.findOne('#' + id))
      .filter(Boolean) as Konva.Node[];
    transformerRef.current.nodes(nodes);
    transformerRef.current.getLayer()?.batchDraw();
  }, [selectedIds, doc, currentOutput]);

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
      if (isSpacePressed) {
        setIsPanning(true);
        return;
      }
      // Empty-canvas press starts a marquee selection.
      if (e.target === e.target.getStage()) {
        const stage = stageRef.current;
        const pos = stage?.getRelativePointerPosition();
        if (pos) {
          marqueeStart.current = { x: pos.x, y: pos.y };
          setMarquee({ x: pos.x, y: pos.y, w: 0, h: 0 });
        }
        setSelectedIds([]);
        setEditingTextId(null);
      }
    },
    [isSpacePressed, setSelectedIds]
  );

  const handleStageMouseMove = useCallback(() => {
    if (!marqueeStart.current) return;
    const stage = stageRef.current;
    const pos = stage?.getRelativePointerPosition();
    if (!pos) return;
    const s = marqueeStart.current;
    setMarquee({
      x: Math.min(s.x, pos.x),
      y: Math.min(s.y, pos.y),
      w: Math.abs(pos.x - s.x),
      h: Math.abs(pos.y - s.y),
    });
  }, []);

  const handleStageMouseUp = useCallback(() => {
    setIsPanning(false);
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
  }, [marquee, output, setSelectedIds]);

  // Snapping during drag: align edges/centers to other elements + output guides (B3).
  const computeSnap = useCallback(
    (node: Konva.Node) => {
      if (!output || isVideo) return;
      if (!snapEnabled) { setGuides([]); return; }
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

  const handleTransform = useCallback((e: Konva.KonvaEventObject<Event>) => {
    const node = e.target;
    const w = Math.round(node.width() * node.scaleX());
    const h = Math.round(node.height() * node.scaleY());
    setHud({ x: node.x(), y: node.y() - 22, text: `${w} × ${h}` });
    if (rafIdRef.current) return;
    rafIdRef.current = requestAnimationFrame(() => {
      const id = node.id();
      if (id) {
        updateElement(id, {
          x: node.x(),
          y: node.y(),
          width: Math.max(node.width() * node.scaleX(), 10),
          height: Math.max(node.height() * node.scaleY(), 10),
          rotation: node.rotation(),
        });
      }
      rafIdRef.current = null;
    });
  }, [updateElement]);

  const handleTransformEnd = useCallback(
    (e: Konva.KonvaEventObject<Event>) => {
      setHud(null);
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      const node = e.target;
      const id = node.id();
      if (id) {
        updateElement(id, {
          x: node.x(),
          y: node.y(),
          width: Math.max(node.width() * node.scaleX(), 10),
          height: Math.max(node.height() * node.scaleY(), 10),
          rotation: node.rotation(),
        });
        pushHistory();
        node.scaleX(1);
        node.scaleY(1);
      }
    },
    [pushHistory, updateElement]
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
    const next = Math.min(scaleX, scaleY) * 0.9;
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
      } else if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelectedIds(((output as any)?.children || []).filter((c: any) => !c.hidden).map((c: any) => c.id));
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
        selectedIds.forEach((id) => duplicateElement(id));
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
      const target = e.target;
      const id = target.id() || target.getParent()?.id();
      if (id) {
        const el = ((output as any)?.children || []).find((c: any) => c.id === id);
        if (el?.type === 'text') setEditingTextId(id);
      }
    },
    [output]
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
      className={`flex-1 min-w-0 relative overflow-hidden bg-[#e5e7eb] designer-canvas-container ${
        isPanning ? 'cursor-grabbing' : isSpacePressed ? 'cursor-grab' : 'cursor-default'
      }`}
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
        onWheel={handleWheel}
        onDblClick={handleStageDblClick}
        onDblTap={handleStageDblClick}
        draggable={isSpacePressed}
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
          {bg?.type === 'image' && bgImage && (
            <KonvaImage image={bgImage} x={0} y={0} width={output.width} height={output.height} listening={false} />
          )}
          <CanvasElements
            elements={isVideo ? [] : (output?.children || [])}
            onSelect={handleElementSelect}
            onContextMenu={(elementId, clientX, clientY) => {
              setContextMenu({ x: clientX, y: clientY, targetType: 'element', elementId });
            }}
          />
          {isVideo && (
            <VideoCanvasOverlay
              store={store}
              width={output.width}
              height={output.height}
            />
          )}
          {guides.map((g) => (
            <KonvaLine key={g.points.join(',')} points={g.points} stroke="#FF3B7F" strokeWidth={1 / zoom} dash={[4, 4]} listening={false} />
          ))}
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
          {selectedIds.length > 0 && (
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

      {editingTextId && (() => {
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
