'use client';

import React, { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createDesignerStore, migrateDoc, type DesignerStore, type DesignerDoc, type DesignerAttribution, type VideoOutput, type VideoClip, type DesignerOutput, type DesignerElement } from './designer.store';
import { createAutosaveSubscription, createDesignAutosave } from './designer-autosave';
import { useCollaboration } from './collaboration';
import type { TimelineAwareness, ImageAwareness } from './collaboration';
import { CollaborationCursors, type PeerTimelineState } from './collaboration-cursors';
import { DesignerCanvas } from './canvas';
import { setImageFetch, clearImageCache, probeImageNaturalSize } from './elements';
import { addImageElementFromMedia } from './insert-image';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import {
  useDecisionModal,
  useModals,
} from '@postmill-ai/frontend/components/layout/new-modal';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { useAiActive } from '@postmill-ai/frontend/components/layout/use-ai-active';
import { useMediaToolsStatus } from '@postmill-ai/frontend/components/layout/use-media-tools-status';
import { TemplatesPanel } from './panels/templates-panel';
import { MyDesignsPanel } from './panels/my-designs-panel';
import { LayersPanel } from './panels/layers-panel';
import { HistoryPanel } from './panels/history-panel';
import { VersionsPanel, SaveVersionDialog } from './panels/versions-panel';
import { TemplateFillPanel } from './panels/template-fill-panel';
import { LayersFooter } from './panels/layers-footer';
import { usePixelOps } from './use-pixel-ops';
import { FloatingPanel } from './floating-panel';
import { useFloatingPanelState } from './use-floating-panel-state';
import { ToolRail } from './tool-rail';
import { ToolOptionsBar, defaultToolOptions } from './tool-options-bar';
import { AiPanel } from './panels/ai-panel';
import { BrandPanel } from './panels/brand-panel';
import { IconsPanel } from './panels/icons-panel';
import { InspectorPanel } from './panels/inspector-panel';
import { SelectionToolbar } from './selection-toolbar';
import { OutputTabs } from './output-tabs';
import { PagesPanel } from './panels/pages-panel';
import { ShortcutsOverlay } from './shortcuts';
import { CommandPalette } from './command-palette';
import { ExportDialog, renderOutputThumbnail } from './export-dialog';
import { VideoTimeline } from './video-timeline';
import { fitWithin } from './panels/fit-within';
import { MenuBar } from './menu-bar';
import { MAX_VIDEO_DURATION_MS } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.limits';
import { pageChildren } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.pages';
import { useDesignerActions, type DesignerActionCtx } from './actions';
import { NewDesignDialog } from './new-design-dialog';
import { CanvasInspector } from './panels/canvas-inspector';
import { useMediaPicker } from '../use-media-picker';
import { StartDialog } from './start-dialog';
import { aiRemoveBackground, aiUpscale, aiDetectSubject, aiOutpaint } from './ai-image-actions';
import { OutpaintDialog } from './outpaint-dialog';
import { addImageClipToTimeline, addMediaToTimeline } from './add-media-to-timeline';
import { Logo } from '@postmill-ai/frontend/components/new-layout/logo';
import { FullscreenButton } from '@postmill-ai/frontend/components/media-tools/fullscreen-button';
import { useFullscreenSurface } from '@postmill-ai/frontend/components/media-tools/use-fullscreen';
import { getBrandViolations } from './brand-compliance';
import { useBrandColors } from './panels/use-brand-colors';
import { useBrandFonts, useCustomFonts } from './panels/use-brand-fonts';
import { useUser } from '@postmill-ai/frontend/components/layout/user.context';
import { KebabMenu } from '@postmill-ai/frontend/components/ui/kebab-menu';
import { DropdownArrowIcon } from '@postmill-ai/frontend/components/ui/icons';

// 4.4: hoisted so the memoized onPeerTimeline callback has no changing closure dep.
const PEER_COLORS = ['#f43f5e', '#8b5cf6', '#06b6d4', '#f59e0b', '#22c55e', '#ec4899'];

interface DesignerProps {
  setMedia?: (media: { id: string; path: string }[]) => void;
  closeModal?: () => void;
  width?: number;
  height?: number;
  initialAsset?: {
    url: string;
    thumbUrl?: string;
    type: 'photo' | 'video';
    author?: string;
    authorUrl?: string;
    downloadLocation?: string;
    source?: string;
    // The chosen CANVAS size (drives the doc).
    width?: number;
    height?: number;
    // The image's NATURAL pixel size — used to place it aspect-correct inside
    // the doc (same as adding a photo from a panel). Falls back to filling the
    // canvas when absent.
    naturalWidth?: number;
    naturalHeight?: number;
  };
  // Multiple assets opened together as elements (e.g. "Open all in Designer"
  // from the Files library). Each is placed as a cascaded image element.
  initialAssets?: Array<{
    url: string;
    type?: 'photo' | 'video';
    thumbUrl?: string;
    naturalWidth?: number;
    naturalHeight?: number;
    source?: string;
  }>;
  // Caption handoff (from the Deepgram studio): open a video project with this clip on
  // the timeline and a caption track pre-built from the word timings (start/end in
  // seconds), so the user never re-transcribes.
  initialCaptionVideo?: {
    url: string;
    fileId?: string;
    width?: number;
    height?: number;
    words: { word: string; start: number; end: number }[];
  };
  // Timeline handoff: land a video/audio artifact directly on the timeline.
  initialTimelineMedia?: {
    type: 'video' | 'audio';
    url: string;
    fileId?: string;
    width?: number;
    height?: number;
  };
  designId?: string;
}

// Phrase-group word timings into caption clips — mirrors the video-timeline's
// auto-caption grouping so a Deepgram handoff yields the same caption shape.
function buildCaptionClips(
  words: { word: string; start: number; end: number }[],
  width: number,
  height: number,
  durationMs: number
): VideoClip[] {
  const phrases: { word: string; start: number; end: number }[][] = [];
  let current: { word: string; start: number; end: number }[] = [];
  const maxWordsPerCaption = 6;
  for (const w of words) {
    current.push(w);
    if (/[.!?]$/.test(w.word) || current.length >= maxWordsPerCaption) {
      phrases.push(current);
      current = [];
    }
  }
  if (current.length) phrases.push(current);

  const clips: VideoClip[] = [];
  for (const phrase of phrases) {
    const startMs = Math.round(phrase[0].start * 1000);
    const endMs = Math.min(Math.round(phrase[phrase.length - 1].end * 1000), durationMs);
    if (startMs >= durationMs) break;
    clips.push({
      id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      startMs,
      endMs,
      text: phrase.map((w) => w.word).join(' '),
      words: phrase.map((w) => ({
        word: w.word,
        startMs: Math.round(w.start * 1000) - startMs,
        endMs: Math.round(w.end * 1000) - startMs,
      })),
      fontFamily: 'Arial',
      fontSize: 28,
      fontWeight: 700,
      fill: '#ffffff',
      x: (width - 300) / 2,
      y: height - 120,
      width: 300,
      height: 70,
    });
  }
  return clips;
}

// Decode a data: URL to a Blob directly. The designer's `useFetch` prefixes the
// backend baseUrl onto any URL, so `fetch(dataUrl)` there throws — the thumbnail
// upload silently died and every save shipped the full base64 in the JSON.
export const dataUrlToBlob = (dataUrl: string): Blob | null => {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(dataUrl);
  if (!match) return null;
  const mime = match[1] || 'application/octet-stream';
  const isBase64 = !!match[2];
  const data = match[3];
  if (isBase64) {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(data)], { type: mime });
};

export const getThumbnailDataUrl = (canvas: HTMLCanvasElement | null, maxDim = 400): string | undefined => {
  if (!canvas) return undefined;
  const ratio = Math.min(1, maxDim / Math.max(canvas.width, canvas.height));
  const w = Math.round(canvas.width * ratio);
  const h = Math.round(canvas.height * ratio);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return undefined;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(canvas, 0, 0, w, h);
  return c.toDataURL('image/jpeg', 0.85);
};

export const Designer: FC<DesignerProps> = ({
  setMedia,
  closeModal,
  width,
  height,
  initialAsset,
  initialAssets,
  initialCaptionVideo,
  initialTimelineMedia,
  designId,
}) => {
  const fetch = useFetch();
  const toaster = useToaster();
  const translate = useT();
  const modals = useModals();
  const decision = useDecisionModal();
  const [showSafeZones, setShowSafeZones] = useState(false);
  const [showRulers, setShowRulers] = useState(true);
  // Pages-bar visibility override: null = never toggled (auto — hidden for
  // single-page designs, shown for multi-page), true/false = the user's
  // explicit choice, persisted per org and adopted in the effect below.
  const [pagesBarOverride, setPagesBarOverride] = useState<boolean | null>(null);
  // Default the inspector collapsed on mobile so it doesn't cover the canvas
  // (≤1025px = the repo `mobile` breakpoint). Desktop stays expanded.
  const [inspectorCollapsed, setInspectorCollapsed] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= 1025
  );
  // Required startup picker on a fresh editor (no deep-linked asset/design and
  // no caller-supplied size) — forces an explicit format choice instead of the
  // silent 1080² "Instagram Post" default.
  const [showStart, setShowStart] = useState(
    () =>
      !initialAsset &&
      !initialAssets?.length &&
      !initialCaptionVideo &&
      !initialTimelineMedia &&
      !designId &&
      !(width && height)
  );
  const aiActive = useAiActive();
  // Per-operation media-tool availability gates the AI generation actions (remove-bg,
  // upscale, inpaint, generate). `status` is a stable SWR ref so the accessor (and the
  // action ctx) stay memo-stable; optimistic while loading, fail-open on error.
  const { status: mediaToolsStatus } = useMediaToolsStatus();
  const mediaOperationAvailable = useCallback(
    (operation: string): boolean =>
      mediaToolsStatus ? !!mediaToolsStatus.operations?.[operation]?.available : true,
    [mediaToolsStatus]
  );
  // Video/audio generation is described under `tools`, not `operations` — the
  // two halves of the payload are keyed differently.
  const mediaToolAvailable = useCallback(
    (category: string): boolean =>
      mediaToolsStatus ? !!mediaToolsStatus.tools?.[category]?.available : true,
    [mediaToolsStatus]
  );
  const user = useUser();
  // Layers floats instead of docking in the rail; its position and open state
  // persist per org.
  const layersPanel = useFloatingPanelState('layers', user?.orgId, {
    x: 72,
    y: 16,
    height: 360,
    open: false,
  });
  // Brand floats too — it is a reference surface you keep open while working,
  // not a one-shot picker.
  const brandPanel = useFloatingPanelState('brand', user?.orgId, {
    x: 360,
    y: 16,
    height: 420,
    open: false,
  });
  // History floats as well: it is a navigation surface you keep open while
  // experimenting, and it needs the room a rail cannot give it.
  const historyPanel = useFloatingPanelState('history', user?.orgId, {
    x: 360,
    y: 16,
    height: 360,
    open: false,
  });
  // Versions (server-side snapshots) floats like History — same "keep open
  // while experimenting" surface, backed by the DB rather than the undo stack.
  const versionsPanel = useFloatingPanelState('versions', user?.orgId, {
    x: 660,
    y: 16,
    height: 400,
    open: false,
  });
  // The fill-in-the-blanks form for a slotted template. Floats like the rest,
  // and stays closed until a template actually has slots.
  const templatePanel = useFloatingPanelState('template', user?.orgId, {
    x: 660,
    y: 16,
    height: 320,
    open: false,
  });
  const brandColors = useBrandColors();
  const brandFonts = useBrandFonts();
  // Mounted at the Designer root (not just in the panels that list fonts) so
  // reopening a saved design paints its custom-font glyphs immediately, before
  // any panel is visited. The hook's FontFaceSet guard makes the panels' own
  // mounts of it no-ops, and its effect re-runs when the font list changes.
  useCustomFonts();
  const storeRef = useRef<ReturnType<typeof createDesignerStore> | null>(null);

  // Destructure to keep dependency arrays primitive and avoid stale closures
  // when the parent passes a new object reference for the same asset.
  const {
    url: initialAssetUrl,
    source: initialAssetSource,
    downloadLocation: initialAssetDownloadLocation,
    author: initialAssetAuthor,
    authorUrl: initialAssetAuthorUrl,
    width: initialAssetWidth,
    height: initialAssetHeight,
  } = initialAsset || {};
  const {
    width: captionWidth,
    height: captionHeight,
  } = initialCaptionVideo || {};

  const store = useMemo(() => {
    let w = width || 1080;
    let h = height || 1080;
    if (initialAssetWidth && initialAssetHeight) {
      w = initialAssetWidth;
      h = initialAssetHeight;
    }
    if (captionWidth && captionHeight) {
      w = captionWidth;
      h = captionHeight;
    }
    const attribution: DesignerAttribution | undefined = initialAssetUrl
      ? {
          source: initialAssetSource,
          url: initialAssetUrl,
          downloadLocation: initialAssetDownloadLocation,
          author: initialAssetAuthor,
          authorUrl: initialAssetAuthorUrl,
        }
      : undefined;
    const s = createDesignerStore(w, h, attribution, fetch);
    storeRef.current = s;
    return s;
  }, [
    width,
    height,
    initialAssetUrl,
    initialAssetSource,
    initialAssetDownloadLocation,
    initialAssetAuthor,
    initialAssetAuthorUrl,
    initialAssetWidth,
    initialAssetHeight,
    captionWidth,
    captionHeight,
    fetch,
  ]);

  // Select / Fill / Stroke / Filter — they need the stage and the modals, which
  // the action layer can't reach, so they are built here and passed in.
  const pixelOps = usePixelOps({ store, fetchFn: fetch });

  const designName = store((s) => s.designName);
  const currentDesignId = store((s) => s.designId);
  const isDirty = store((s) => s.isDirty);
  const isSaving = store((s) => s.isSaving);
  const saveFailed = store((s) => s.saveFailed);
  const saveRetryPaused = store((s) => s.saveRetryPaused);
  // Narrow slices instead of the whole doc: a root-level `doc` subscription
  // re-rendered the entire app chrome on every edit. Anything that needs the
  // full doc reads it imperatively (store.getState()) or subscribes outside
  // React below.
  const docMode = store((s) => s.doc.mode);
  // Best-matching channel preset for safe-zone overlays (E7).
  const safeZonePreset = store(
    (s) => (s.doc.outputs[s.currentOutput] as any)?.formatId || null
  );
  const currentOutputDurationMs = store((s) =>
    s.doc.mode === 'video'
      ? (s.doc.outputs[s.currentOutput] as any)?.durationMs
      : undefined
  );
  const currentOutputSizeKey = store((s) => {
    const o = s.doc.outputs[s.currentOutput] as any;
    return o ? `${o.width}x${o.height}` : '';
  });
  const activeTool = store((s) => s.activeTool);
  const lastToolPerGroup = store((s) => s.lastToolPerGroup);
  const toolOptions = store((s) => s.toolOptions);
  const setActiveTool = store((s) => s.setActiveTool);
  const setToolOption = store((s) => s.setToolOption);
  const currentOutput = store((s) => s.currentOutput);
  // Extra pages on the active image output drive the Pages bar's auto-visibility.
  const activeOutputPageCount = store((s) => {
    const out = s.doc.outputs[s.currentOutput] as any;
    return out && 'children' in out ? (out.pages?.length ?? 0) : 0;
  });

  // Adopt the stored per-org Pages-bar override after mount — reading
  // localStorage during render would hydrate-mismatch. Guarded like
  // use-floating-panel-state: a malformed value falls back to auto (null).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`designer-pages-bar-${user?.orgId}`);
      const parsed = raw === null ? null : JSON.parse(raw);
      setPagesBarOverride(typeof parsed === 'boolean' ? parsed : null);
    } catch {
      setPagesBarOverride(null);
    }
  }, [user?.orgId]);

  // Effective Pages-bar visibility (image mode only): the explicit override
  // wins; otherwise auto-visible only for multi-page designs.
  const showPagesBar = docMode === 'image' && (pagesBarOverride ?? activeOutputPageCount > 0);
  const onTogglePagesBar = useCallback(() => {
    setPagesBarOverride(() => {
      const next = !showPagesBar;
      try {
        localStorage.setItem(`designer-pages-bar-${user?.orgId}`, JSON.stringify(next));
      } catch {
        // Private mode / quota exceeded — the toggle still works this session.
      }
      return next;
    });
  }, [showPagesBar, user?.orgId]);
  const selectedIds = store((s) => s.selectedIds);
  const selectedClip = store((s) => s.selectedClip);
  const brandEnforcement = store((s) => s.brandEnforcement);
  const brandAdminOverride = store((s) => s.brandAdminOverride);
  const undo = store((s) => s.undo);
  const redo = store((s) => s.redo);

  // Memoized so the memo'd ToolOptionsBar re-renders only when the tool or
  // its options actually change.
  const activeToolOptions = useMemo(
    () => ({
      ...defaultToolOptions(activeTool),
      ...(toolOptions[activeTool] || {}),
    }),
    [activeTool, toolOptions]
  );
  const onToolOptionChange = useCallback(
    (key: string, value: unknown) => setToolOption(activeTool, key, value),
    [activeTool, setToolOption]
  );

  const [collabEnabled, setCollabEnabled] = useState(false);
  const [connectedCount, setConnectedCount] = useState(0);
  const [peerTimelines, setPeerTimelines] = useState<PeerTimelineState[]>([]);
  const [peerImages, setPeerImages] = useState<ImageAwareness[]>([]);

  // 4.4: memoize the four collaboration callbacks so `useCollaboration`'s effect
  // deps are stable. Inline arrows here got a new identity on every doc/selection
  // render, tearing down and rebuilding the socket + Y.Doc on every keystroke/drag.
  const onRemoteDoc = useCallback((remoteDoc: any) => {
    store.getState().setDoc(migrateDoc(remoteDoc));
  }, [store]);
  const onConnectedChange = useCallback((count: number) => {
    setConnectedCount(count);
  }, []);
  const onPeerTimeline = useCallback((peers: TimelineAwareness[]) => {
    setPeerTimelines(
      peers.map((p, i) => ({
        playheadMs: p.playheadMs,
        selectedClipId: p.selectedClipId,
        color: PEER_COLORS[i % PEER_COLORS.length],
      })),
    );
  }, []);
  const onPeerImage = useCallback((peers: ImageAwareness[]) => {
    setPeerImages(peers);
  }, []);

  const collabData = useCollaboration({
    designId: currentDesignId,
    enabled: collabEnabled,
    onRemoteDoc,
    onConnectedChange,
    onPeerTimeline,
    onPeerImage,
  });
  const { sendUpdate } = collabData;

  useEffect(() => {
    if (!collabEnabled || !currentDesignId) return;
    sendUpdate(store.getState().doc);
    let prev = store.getState().doc;
    return store.subscribe((state) => {
      if (state.doc === prev) return;
      prev = state.doc;
      sendUpdate(state.doc);
    });
  }, [collabEnabled, currentDesignId, sendUpdate, store]);

  // Let the canvas image loader use the authenticated proxy for cross-origin
  // hosts (stock images) that don't send CORS headers (otherwise blank canvas).
  useEffect(() => {
    setImageFetch(fetch);
    return () => setImageFetch(null);
  }, [fetch]);

  // Brand violations are read only by the save/export flows, so compute them
  // on demand against the live doc rather than subscribing the root to it.
  const getBrandViolationsNow = useCallback(
    () =>
      getBrandViolations(store.getState().doc, {
        enforcement: brandEnforcement,
        adminOverride: brandAdminOverride,
        brandColors,
        brandFonts,
      }),
    [store, brandEnforcement, brandAdminOverride, brandColors, brandFonts]
  );
  const canAdminOverride = user?.role === 'owner' || user?.role === 'admin';

  // Warn on tab-close while there are unsaved changes. Re-subscribes when
  // `isDirty` changes — but must NOT reset the doc here (that cleanup would run
  // on every isDirty change and wipe the canvas the moment anything is added).
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  // Reset the store ONLY on real unmount (store is stable from useMemo, so this
  // cleanup runs once when the Designer closes — never on edits).
  useEffect(() => {
    return () => {
      store.getState().reset();
      clearImageCache();
    };
  }, [store]);

  useEffect(() => {
    if (designId) {
      fetch(`/media/designs/${designId}`)
        .then((res) => res.json())
        .then((design) => {
          if (design) {
            store.getState().loadDesign(design.doc as DesignerDoc, design.id, design.name);
          }
        })
        .catch(() => {});
    }
  }, [designId, fetch, store]);

  // Snapshot the stage canvas to a small JPEG and upload it as a File. Falls
  // back to the raw data URL when the upload fails so a preview is never lost.
  // ANY failure here (incl. a SecurityError from a tainted cross-origin canvas)
  // must degrade to "no preview" — the doc save is never gated on a thumbnail.
  const uploadPreview = useCallback(async (): Promise<{
    previewFileId?: string;
    previewDataUrl?: string;
  }> => {
    try {
      // The design thumbnail is ALWAYS page 1 of output 0 (multi-page docs,
      // doc v8) — not whatever page/output the stage happens to be showing.
      // Render it off-stage for image docs; video keeps the live stage frame.
      const state = store.getState();
      const first = state.doc.outputs[0] as DesignerOutput | undefined;
      const previewDataUrl =
        state.doc.mode === 'image' && first && 'children' in first
          ? await renderOutputThumbnail(
              { ...first, children: pageChildren(first, 0) },
              state.doc.symbols as never
            )
          : getThumbnailDataUrl(
              document.querySelector('.konva-stage canvas') as HTMLCanvasElement
            );
      const previewBlob = previewDataUrl ? dataUrlToBlob(previewDataUrl) : null;
      if (previewBlob) {
        try {
          const form = new FormData();
          form.append('file', previewBlob, 'thumbnail.jpg');
          // System artifact: the design references the row by FK, but it must
          // not appear in the user's Files library.
          form.append('internal', 'design-preview');
          const uploadRes = await fetch('/files/upload-simple', { method: 'POST', body: form });
          if (uploadRes.ok) {
            const uploadData = await uploadRes.json();
            return { previewFileId: uploadData.id };
          }
        } catch {
          // Fall back to the data URL below.
        }
      }
      return previewDataUrl ? { previewDataUrl } : {};
    } catch {
      return {};
    }
  }, [fetch, store]);

  // Autosave pipeline (create-on-first-edit, then PUT) — hoisted so both the
  // debounced-doc effect and manual Save share the same in-flight create guard.
  const designAutosave = useMemo(
    () => createDesignAutosave({ store, fetchFn: fetch, uploadPreview }),
    [store, fetch, uploadPreview]
  );

  // Autosave runs on a store subscription, not on render (see
  // createAutosaveSubscription): moving it out of React is what lets the root
  // stop subscribing to `doc`.
  useEffect(
    () => createAutosaveSubscription(store, designAutosave),
    [store, designAutosave]
  );

  const openExportDialog = useCallback(
    (initialAction?: 'save' | 'create-post') => {
      const s = store.getState();
      if (s.brandEnforcement && !s.brandAdminOverride && getBrandViolationsNow().length > 0) {
        toaster.show(translate('export_blocked_off_brand', 'Export blocked: off-brand elements detected. Fix them or use admin override.'), 'warning');
        return;
      }
      modals.openModal({
        children: <ExportDialog store={store} initialAction={initialAction} onClose={() => modals.closeAll()} />,
      });
    },
    [modals, store, getBrandViolationsNow, toaster, translate]
  );

  // Legacy entry (composer-embedded "Use in post"): current output, opt-in
  // export-all. The dropdown actions always export every variant.
  const handleExport = useCallback(() => openExportDialog(), [openExportDialog]);
  const handleSaveToFiles = useCallback(() => openExportDialog('save'), [openExportDialog]);
  const handleCreatePost = useCallback(() => openExportDialog('create-post'), [openExportDialog]);

  const handleSave = useCallback(async () => {
    const s = store.getState();
    if (s.brandEnforcement && !s.brandAdminOverride && getBrandViolationsNow().length > 0) {
      toaster.show(translate('save_blocked_off_brand', 'Save blocked: off-brand elements detected. Fix them or use admin override.'), 'warning');
      return;
    }
    s.setSaving(true);
    try {
      // A first save goes through the autosave create guard, so a create
      // already in flight (or a rapid Cmd+S repeat) can never POST a duplicate
      // design. The brand-compliance check above stays manual-save-only.
      if (!store.getState().designId) {
        await designAutosave.ensureCreated();
      }
      const cur = store.getState();
      // ensureCreated already persisted the current doc + preview; only PUT
      // when edits landed while it was in flight (or a pre-existing design
      // still has unsaved work).
      if (cur.designId && cur.isDirty) {
        const { previewFileId, previewDataUrl } = await uploadPreview();
        const payload: Record<string, unknown> = {
          name: cur.designName,
          doc: cur.doc,
          width: cur.doc.outputs[0]?.width,
          height: cur.doc.outputs[0]?.height,
        };
        if (previewFileId) payload.previewFileId = previewFileId;
        // Only ship the base64 preview as a fallback when the upload failed, to keep
        // the save JSON small.
        else if (previewDataUrl) payload.previewDataUrl = previewDataUrl;
        const res = await fetch(`/media/designs/${cur.designId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Save failed');
        cur.markSaved();
      }
      toaster.show(translate('design_saved', 'Design saved'), 'success');
    } catch {
      toaster.show(translate('save_failed', 'Failed to save'), 'warning');
    } finally {
      store.getState().setSaving(false);
    }
  }, [fetch, toaster, store, getBrandViolationsNow, translate, uploadPreview, designAutosave]);

  const handleSaveAsTemplate = useCallback(async () => {
    const s = store.getState();
    if (s.brandEnforcement && !s.brandAdminOverride && getBrandViolationsNow().length > 0) {
      toaster.show(translate('save_blocked_off_brand', 'Save blocked: off-brand elements detected. Fix them or use admin override.'), 'warning');
      return;
    }
    s.setSaving(true);
    try {
      const stageEl = document.querySelector('.konva-stage canvas') as HTMLCanvasElement;
      const previewDataUrl = getThumbnailDataUrl(stageEl);
      let thumbnailFileId: string | undefined;
      const previewBlob = previewDataUrl ? dataUrlToBlob(previewDataUrl) : null;
      if (previewBlob) {
        try {
          const form = new FormData();
          form.append('file', previewBlob, 'thumbnail.jpg');
          form.append('internal', 'design-preview');
          const uploadRes = await fetch('/files/upload-simple', { method: 'POST', body: form });
          if (uploadRes.ok) {
            const uploadData = await uploadRes.json();
            thumbnailFileId = uploadData.id;
          }
        } catch {}
      }
      const payload: Record<string, unknown> = {
        name: s.designName,
        category: s.doc.mode === 'video' ? 'Video' : s.doc.outputs[0]?.formatId || 'custom',
        doc: s.doc,
      };
      if (thumbnailFileId) payload.thumbnailFileId = thumbnailFileId;
      if (s.templateId) {
        const res = await fetch(`/media/design-templates/${s.templateId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Save as template failed');
      } else {
        const res = await fetch('/media/design-templates', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Save as template failed');
        const data = await res.json();
        s.setTemplateId(data.id);
      }
      toaster.show(translate('saved_as_template', 'Saved as template'), 'success');
    } catch {
      toaster.show(translate('failed_to_save_as_template', 'Failed to save as template'), 'warning');
    } finally {
      s.setSaving(false);
    }
  }, [fetch, toaster, store, getBrandViolationsNow, translate]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave]);

  useEffect(() => {
    if (initialAssets && initialAssets.length) {
      const state = store.getState();
      const active = state.doc.outputs[state.currentOutput];
      initialAssets.forEach((asset, i) => {
        if (!asset.url) return;
        const imgUrl = asset.type === 'video' ? (asset.thumbUrl || asset.url) : asset.url;
        const place = (natW?: number, natH?: number) => {
          const { width: w, height: h } = fitWithin(
            natW || active.width * 0.5,
            natH || active.height * 0.5,
            active.width,
            active.height
          );
          // Cascade each element from the top-left so they don't fully overlap.
          const off = i * 32;
          store.getState().addElement({
            id: '',
            type: 'image',
            x: Math.min(40 + off, Math.max(0, active.width - w)),
            y: Math.min(40 + off, Math.max(0, active.height - h)),
            width: w,
            height: h,
            rotation: 0,
            opacity: 1,
            locked: false,
            hidden: false,
            src: imgUrl,
            naturalWidth: natW,
            naturalHeight: natH,
          });
        };
        if (asset.naturalWidth && asset.naturalHeight) {
          place(asset.naturalWidth, asset.naturalHeight);
        } else {
          // The half-canvas guess distorted anything whose aspect differed.
          probeImageNaturalSize(imgUrl).then((dims) =>
            place(dims?.width, dims?.height)
          );
        }
      });
      return;
    }
    if (initialAsset && initialAsset.url) {
      const imgUrl = initialAsset.type === 'video'
        ? (initialAsset.thumbUrl || initialAsset.url)
        : initialAsset.url;
      const state = store.getState();
      const active = state.doc.outputs[state.currentOutput];
      // Place the asset aspect-correct and centred — identical to adding a
      // photo from a panel. Only fills the canvas when natural dims are unknown
      // or the image already matches the canvas (e.g. "Original size").
      const { width: w, height: h } = fitWithin(
        initialAsset.naturalWidth || active.width,
        initialAsset.naturalHeight || active.height,
        active.width,
        active.height
      );
      store.getState().addElement({
        id: '',
        type: 'image',
        x: (active.width - w) / 2,
        y: (active.height - h) / 2,
        width: w,
        height: h,
        rotation: 0,
        opacity: 1,
        locked: false,
        hidden: false,
        src: imgUrl,
      });
    }
  }, [initialAssets, initialAsset, store]);

  // Caption handoff (Deepgram studio): open a video project — the source clip on a video
  // track + a caption track pre-built from the word timings. Loads the video's metadata
  // for duration/natural size; falls back to 10s if metadata can't load (e.g. CORS).
  const captionInitRef = useRef(false);
  useEffect(() => {
    if (!initialCaptionVideo || captionInitRef.current) return;
    captionInitRef.current = true;
    const { url, fileId, words } = initialCaptionVideo;

    const build = (rawDurationMs: number) => {
      store.getState().setMode('video');
      const out = store.getState().currentOutput;
      // Cap + extend the output duration BEFORE adding the clip: addClip silently
      // drops any clip whose endMs exceeds the current (seeded ~10 s) duration, and
      // setVideoDuration hard-clamps to MAX_VIDEO_DURATION_MS — so the clip's endMs must be capped too.
      const durationMs = Math.min(rawDurationMs, MAX_VIDEO_DURATION_MS);
      store.getState().setVideoDuration(out, durationMs);
      let s = store.getState();
      const vo = () => s.doc.outputs[out] as VideoOutput;
      const videoTrack = vo().tracks.find((t) => t.type === 'video');
      if (videoTrack) {
        s.addClip(out, videoTrack.id, {
          id: `clip-${Date.now()}-v`,
          startMs: 0,
          endMs: durationMs,
          src: url,
          fileId,
          // Known video (caption handoff) — pin it so an extensionless src is
          // never mis-sniffed as an image by the canvas overlay.
          mediaType: 'video',
        });
      }

      if (words?.length) {
        store.getState().addTrack(out, 'caption');
        s = store.getState();
        const v = s.doc.outputs[out] as VideoOutput;
        const captionTrack = v.tracks.find((t) => t.type === 'caption');
        if (captionTrack) {
          for (const clip of buildCaptionClips(words, v.width, v.height, durationMs)) {
            store.getState().addClip(out, captionTrack.id, clip);
          }
        }
      }
      store.getState().pushHistory();
    };

    // Build once, from whichever fires first: metadata (real duration), error (10s
    // fallback), or a timeout guard so a hanging/slow source can't block the project.
    let built = false;
    const finish = (durationMs: number) => {
      if (built) return;
      built = true;
      build(durationMs);
    };
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => finish(Math.max(1000, Math.round((probe.duration || 10) * 1000)));
    probe.onerror = () => finish(10000);
    probe.src = url;
    const guard = window.setTimeout(() => finish(10000), 5000);
    return () => {
      window.clearTimeout(guard);
      // Detach handlers and release the probe so a slow metadata load can't fire
      // after unmount (and the element can be GC'd).
      probe.onloadedmetadata = null;
      probe.onerror = null;
      probe.removeAttribute('src');
      probe.load();
    };
  }, [initialCaptionVideo, store]);

  // Timeline handoff: land a video/audio artifact directly on the timeline.
  const timelineInitRef = useRef(false);
  useEffect(() => {
    if (!initialTimelineMedia || timelineInitRef.current) return;
    timelineInitRef.current = true;
    addMediaToTimeline(store, initialTimelineMedia)
      .then((landed) => {
        if (landed?.probeFailed) {
          toaster.show(
            translate('couldnt_read_video_metadata', "Couldn't read the video's metadata — placed with a default duration"),
            'warning'
          );
        }
      })
      .catch(() => {
        toaster.show(translate('could_not_add_media_to_timeline', 'Could not add media to timeline'), 'warning');
      });
  }, [initialTimelineMedia, store, toaster, translate]);

  // --- Unsaved-changes guard shared by New / Open / Templates (D-7b) ---
  const confirmDiscardIfDirty = useCallback(async () => {
    if (store.getState().isDirty) {
      // Title/labels are left at the decision modal's defaults so the copy the
      // user sees is exactly what the native confirm() showed (message only).
      return decision.open({
        description: translate('discard_unsaved_changes_confirm', 'Discard unsaved changes? Your current design will be replaced.'),
      });
    }
    return true;
  }, [store, translate, decision]);

  // --- .pdesign import/export (stage 2: bundled interchange file) ---
  const importInputRef = useRef<HTMLInputElement>(null);
  const [pdesignExporting, setPdesignExporting] = useState(false);

  // Export is an async job bundling the SAVED design + all its assets (the
  // server zips the stored doc), so an unsaved canvas has nothing to export —
  // point the user at Save first.
  const handleExportPostmill = useCallback(async () => {
    const s = store.getState();
    if (!s.designId) {
      toaster.show(
        translate('designer_export_pdesign_save_first', 'Save the design first, then export it as .pdesign'),
        'warning'
      );
      return;
    }
    if (pdesignExporting) return;
    setPdesignExporting(true);
    try {
      const startRes = await fetch(`/media/designs/${s.designId}/export`, { method: 'POST' });
      const startData = await startRes.json().catch(() => null);
      if (!startRes.ok) {
        throw new Error(startData?.message || translate('designer_export_pdesign_failed', 'Failed to export the design file'));
      }
      const jobId = startData.id;

      // Poll the job every 2s (the render-video polling idiom) until the
      // artifact lands or the job reports its own failure.
      const deadline = Date.now() + 10 * 60 * 1000;
      let artifactUrl: string | undefined;
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const res = await fetch(`/media/designs/export/${jobId}`);
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(data?.message || translate('designer_export_pdesign_failed', 'Failed to export the design file'));
        }
        if (data.status === 'completed') {
          artifactUrl = data.artifactUrl;
          break;
        }
        if (data.status === 'failed') {
          throw new Error(data.errorMessage || translate('designer_export_pdesign_failed', 'Failed to export the design file'));
        }
        if (Date.now() > deadline) {
          throw new Error(translate('designer_export_pdesign_timeout', 'Export is taking too long — try again'));
        }
      }
      if (!artifactUrl) {
        throw new Error(translate('designer_export_pdesign_failed', 'Failed to export the design file'));
      }

      // artifactUrl is an absolute same-origin storage URL — use the native
      // fetch (the useFetch wrapper would prefix the backend base onto it).
      const blobRes = await window.fetch(artifactUrl);
      if (!blobRes.ok) throw new Error('Download failed');
      const blob = await blobRes.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(s.designName || 'design').replace(/[\\/"]/g, ' ').replace(/[^\w\- ]+/g, '').trim() || 'design'}.pdesign`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toaster.show(translate('designer_export_pdesign_ready', 'Design file downloaded'), 'success');
    } catch (err) {
      toaster.show(
        (err as Error)?.message || translate('designer_export_pdesign_failed', 'Failed to export the design file'),
        'warning'
      );
    } finally {
      setPdesignExporting(false);
    }
  }, [store, fetch, toaster, translate, pdesignExporting]);

  const handleImportDesignFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Reset so picking the SAME file twice still fires onChange.
      e.target.value = '';
      if (!file) return;
      if (file.size > 1024 * 1024 * 1024) {
        toaster.show(
          translate('designer_import_too_large', 'Design file is too large (max 1 GB)'),
          'warning'
        );
        return;
      }
      if (!(await confirmDiscardIfDirty())) return;
      try {
        const form = new FormData();
        form.append('file', file, file.name);
        const res = await fetch('/media/designs/import', { method: 'POST', body: form });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(data?.message || translate('designer_import_failed', 'Failed to import the design file'));
        }
        store.getState().loadDesign(data.doc, data.id, data.name, null);
        toaster.show(translate('designer_import_success', 'Design imported'), 'success');
      } catch (err) {
        toaster.show(
          (err as Error)?.message || translate('designer_import_failed', 'Failed to import the design file'),
          'warning'
        );
      }
    },
    [confirmDiscardIfDirty, fetch, store, toaster, translate]
  );

  // Reusable image-from-media placement (centered + aspect-correct) — shared by
  // the Insert/Import media modal and the canvas "Add Image" (D-8).
  /**
   * Insert > Stock Icon.
   *
   * An Iconify pick used to go through `addImageFromMedia`, which stored the
   * API URL as a raster `src` at the icon's own 24x24 — `fitWithin` never
   * upscales, so it landed as a tiny black square with no fill control. The
   * Designer already has the right element for this: `icon` holds SVG markup
   * and paints in `fill`, which is what the icons panel and the AI composer
   * both emit. The markup comes from the server resolver, the same one the
   * composer uses.
   */
  const addStockIcon = useCallback(
    async (item: { url: string }) => {
      const name = /\/([a-z0-9-]+)\/([a-z0-9-]+)\.svg/.exec(item.url);
      const resolved = name
        ? await fetch(
            `/media/icons/resolve?name=${encodeURIComponent(`${name[1]}:${name[2]}`)}`
          )
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null)
        : null;
      if (!resolved?.body) {
        toaster.show(
          translate('couldnt_add_icon', "Couldn't add that icon"),
          'warning'
        );
        return;
      }
      const state = store.getState();
      const active = state.doc.outputs[state.currentOutput];
      const size = Math.round(Math.min(active.width, active.height) * 0.2);
      state.addElement({
        id: '',
        type: 'icon',
        x: (active.width - size) / 2,
        y: (active.height - size) / 2,
        width: size,
        height: size,
        rotation: 0,
        opacity: 1,
        locked: false,
        hidden: false,
        src: resolved.body,
        viewBox: resolved.viewBox,
        fill: '#2B5CD3',
      } as never);
    },
    [store, fetch, toaster, translate]
  );

  /**
   * Convert the selected text layer to `path` outlines.
   *
   * Server-side: glyph contours live in the font file, which no canvas API
   * exposes. The text layer is replaced, so this is a one-way conversion — the
   * same as every vector editor, and undo still puts it back.
   */
  const onTextToOutlines = useCallback(async () => {
    const state = store.getState();
    const out = state.doc.outputs[state.currentOutput] as DesignerOutput | undefined;
    const el = (out ? pageChildren(out, state.currentPage) : []).find(
      (c: DesignerElement) => state.selectedIds.includes(c.id) && c.type === 'text'
    );
    if (!el) return;

    const res = await fetch('/designs/text-outlines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ element: el, perGlyph: true }),
    }).catch(() => null);

    const data = res?.ok ? ((await res.json()) as { elements?: DesignerElement[]; reason?: string }) : null;
    if (!data?.elements?.length) {
      toaster.show(
        data?.reason === 'font-unavailable'
          ? translate('outlines_font_unavailable', "That font isn't available for outlining")
          : translate('couldnt_convert_to_outlines', "Couldn't convert that to outlines"),
        'warning'
      );
      return;
    }

    for (const outline of data.elements) {
      store.getState().addElement({ id: '', ...outline } as DesignerElement);
    }
    store.getState().removeElements([el.id]);
  }, [store, fetch, toaster, translate]);

  // Placement is instant even when the intrinsic size is unknown — the helper
  // drops the element at the canvas fit and corrects the box when the (cache-
  // shared) probe resolves.
  const addImageFromMedia = useCallback(
    (item: { url: string; fileId?: string; width?: number; height?: number }) => {
      addImageElementFromMedia(store, item);
    },
    [store]
  );

  // The picker owns its own dialog; wrapping it in `openModal` stacked a titled
  // modal around an untitled one.
  const mediaPicker = useMediaPicker({
    title: translate('add_media', 'Add media'),
    onSelect: (item) => addImageFromMedia(item as any),
  });
  const onOpenMedia = mediaPicker.open;

  /**
   * Insert ▸ Image / Sticker / Vector / Video / Audio.
   *
   * One picker instance, narrowed per call through `openWith` — which is what
   * that API exists for. In an image document, image-kind picks become elements;
   * in a video document they become image clips at the playhead via
   * `addImageClipToTimeline`; video and audio go to `addMediaToTimeline`, which
   * finds or creates the track and probes the clip's real duration.
   */
  const onInsertMedia = useCallback(
    (kind: 'image' | 'sticker' | 'vector' | 'icon' | 'video' | 'audio') => {
      const TABS = {
        image: ['My Files', 'Stock Photos'],
        sticker: ['Stock Stickers'],
        vector: ['Stock Vectors'],
        // Iconify was reachable from Replace image but not from Insert, so the
        // whole catalog was one indirection away and simply unwired.
        icon: ['Stock Icons'],
        video: ['My Files', 'Stock Videos'],
        audio: ['My Files', 'Stock Audio'],
      } as const;
      const TITLES = {
        image: translate('insert_image', 'Insert image'),
        sticker: translate('insert_sticker', 'Insert sticker'),
        vector: translate('insert_vector', 'Insert vector'),
        icon: translate('insert_stock_icon', 'Insert icon'),
        video: translate('insert_video', 'Insert video'),
        audio: translate('insert_audio', 'Insert audio'),
      };
      const isTimelineMedia = kind === 'video' || kind === 'audio';
      // In a video document an image/sticker/icon pick becomes an image CLIP on
      // the timeline (schema track types `image`/`sticker` and both renderers
      // already support it), not an element — image-mode behaviour is unchanged.
      const isTimelineImage =
        !isTimelineMedia && store.getState().doc.mode === 'video';

      mediaPicker.openWith({
        title: TITLES[kind],
        tabs: TABS[kind],
        onSelect: (item) => {
          if (isTimelineMedia) {
            void addMediaToTimeline(store, {
              type: kind,
              url: item.url,
              fileId: item.fileId,
              width: item.width,
              height: item.height,
            })
              .then((landed) => {
                if (landed?.probeFailed) {
                  toaster.show(
                    translate('couldnt_read_video_metadata', "Couldn't read the video's metadata — placed with a default duration"),
                    'warning'
                  );
                }
              })
              .catch(() => {
                toaster.show(
                  translate('couldnt_add_to_timeline', "Couldn't add that to the timeline"),
                  'warning'
                );
              });
            return;
          }
          if (isTimelineImage) {
            // Iconify picks have no useful intrinsic size (24×24 SVGs), so they
            // take a square badge box instead of the aspect probe.
            addImageClipToTimeline(store, {
              url: item.url,
              fileId: item.fileId,
              width: item.width,
              height: item.height,
              square: kind === 'icon',
            });
            return;
          }
          if (kind === 'icon') {
            void addStockIcon(item as never);
            return;
          }
          addImageFromMedia(item as never);
        },
      });
    },
    [mediaPicker, translate, addImageFromMedia, addStockIcon, store, toaster]
  );

  const selectedImageId = useCallback(() => {
    const st = store.getState();
    const out = st.doc.outputs[st.currentOutput] as any;
    const els = (out && 'children' in out ? pageChildren(out, st.currentPage) : []).filter((c: any) => st.selectedIds.includes(c.id));
    return els.length === 1 && els[0].type === 'image' ? (els[0].id as string) : null;
  }, [store]);

  const runAi = useCallback(
    async (fn: (id: string) => Promise<void>, failMsg: string) => {
      const id = selectedImageId();
      if (!id) return;
      try {
        await fn(id);
      } catch (err) {
        // The shared AI actions throw the server's error message (502/409 envelope);
        // show it so an upstream failure isn't reported as a bare "failed".
        toaster.show((err as Error)?.message || failMsg, 'warning');
      }
    },
    [selectedImageId, toaster]
  );

  const ctx: DesignerActionCtx = useMemo(
    () => ({
      showSafeZones,
      showRulers,
      showPagesBar,
      aiActive,
      mediaOperationAvailable,
      mediaToolAvailable,
      canShare: !!currentDesignId,
      collabEnabled,
      inModal: !!(setMedia || closeModal),
      onNew: async (mode) => {
        if (!(await confirmDiscardIfDirty())) return;
        const st = store.getState();
        st.reset(1080, 1080);
        if (mode === 'video') st.setMode('video');
      },
      onNewCustom: () =>
        modals.openModal({
          title: translate('new_design_dialog_title', 'New design'),
          children: (close: () => void) => (
            <NewDesignDialog store={store} onClose={close} guard={confirmDiscardIfDirty} />
          ),
        }),
      onOpenDesigns: () =>
        modals.openModal({
          title: translate('open_design', 'Open design'),
          children: (close: () => void) => (
            <MyDesignsPanel
              onOpen={async (d) => {
                if (!(await confirmDiscardIfDirty())) return;
                const res = await fetch(`/media/designs/${d.id}`);
                if (!res.ok) return;
                const full = await res.json();
                store.getState().loadDesign(full.doc, full.id, full.name, null);
                close();
              }}
            />
          ),
        }),
      onBrowseTemplates: () =>
        modals.openModal({
          title: translate('browse_templates', 'Browse templates'),
          children: (close: () => void) => (
            <TemplatesPanel store={store as any} onClose={close} guard={confirmDiscardIfDirty} />
          ),
        }),
      onSave: handleSave,
      onSaveVersion: () =>
        modals.openModal({
          title: translate('designer_save_version', 'Save Version'),
          children: (close: () => void) => (
            <SaveVersionDialog store={store} onClose={close} saveDesign={handleSave} />
          ),
        }),
      onSaveAsTemplate: handleSaveAsTemplate,
      onOpenMedia,
      onInsertMedia,
      onExport: handleSaveToFiles,
      onExportPostmill: handleExportPostmill,
      pdesignExporting,
      onImportDesign: () => importInputRef.current?.click(),
      onUseInPost: setMedia ? handleExport : undefined,
      onClose: closeModal,
      onCanvasProperties: () => {
        store.getState().setSelectedIds([]);
        setInspectorCollapsed(false);
      },
      onTogglePanel: (id) => {
        // Persistent surfaces float; one-shot pickers are modals. Both are still
        // reached through the same Window-menu / ⌘K action ids.
        if (id === 'layers') {
          layersPanel.toggle();
          return;
        }
        if (id === 'history') {
          historyPanel.toggle();
          return;
        }
        if (id === 'versions') {
          versionsPanel.toggle();
          return;
        }
        if (id === 'template') {
          templatePanel.toggle();
          return;
        }
        if (id === 'brand') {
          brandPanel.toggle();
          return;
        }
        if (id === 'icons') {
          modals.openModal({
            title: translate('panel_icons', 'Icons'),
            children: (close: () => void) => (
              <IconsPanel store={store as any} onClose={close} />
            ),
          });
          return;
        }
        if (id === 'ai') {
          modals.openModal({
            title: translate('ai', 'AI'),
            children: (close: () => void) => (
              <AiPanel store={store as any} onClose={close} />
            ),
          });
          return;
        }
      },
      onToggleInspector: () => setInspectorCollapsed((c) => !c),
      onToggleSafeZones: () => setShowSafeZones((v) => !v),
      onToggleRulers: () => setShowRulers((v) => !v),
      onTogglePagesBar,
      onToggleSnap: () => {
        const st = store.getState();
        st.setSnapEnabled(!st.snapEnabled);
      },
      onFitToScreen: () => store.getState().requestFit(),
      onActualSize: () => store.getState().setZoom(1),
      onShortcuts: () =>
        modals.openModal({
          children: (close: () => void) => (
            <ShortcutsOverlay onClose={close} videoMode={store.getState().doc.mode === 'video'} />
          ),
        }),
      onTextToOutlines,
      onConvertMode: async () => {
        const st = store.getState();
        const cur = st.doc.mode;
        const target = cur === 'image' ? 'video' : 'image';
        const msg =
          cur === 'image'
            ? translate('convert_to_video_mode_confirm', 'Convert to video mode? All image elements will be lost.')
            : translate('convert_to_image_mode_confirm', 'Convert to image mode? All video tracks and clips will be lost.');
        if (await decision.open({ description: msg })) st.setMode(target);
      },
      onToggleShare: () => setCollabEnabled((v) => !v),
      onSelectAll: pixelOps.onSelectAll,
      onSelectInverse: pixelOps.onSelectInverse,
      canEditPixels: pixelOps.canEditPixels,
      onFill: pixelOps.onFill,
      onStroke: pixelOps.onStroke,
      onFilter: pixelOps.onFilter,
      onLastFilter: pixelOps.onLastFilter,
      hasLastFilter: pixelOps.hasLastFilter,
      lastFilterLabel: pixelOps.lastFilterLabel,
      onFlattenFilters: pixelOps.onFlattenFilters,
      hasSmartFilters: pixelOps.hasSmartFilters,
      onAiGenerate: () =>
        modals.openModal({
          title: translate('ai', 'AI'),
          children: (close: () => void) => (
            <AiPanel store={store as any} onClose={close} />
          ),
        }),
      onAiRemoveBg: () =>
        runAi((id) => aiRemoveBackground({ fetch, store, elementId: id }), translate('background_removal_failed', 'Background removal failed')),
      onAiUpscale: (scale) =>
        runAi((id) => aiUpscale({ fetch, store, elementId: id }, scale), translate('upscale_failed', 'Upscale failed')),
      onAiInpaint: () => {
        const id = selectedImageId();
        if (!id) return;
        setInspectorCollapsed(false);
        toaster.show(translate('draw_mask_ai_tools_inpaint', 'Draw a mask in the inspector’s AI Tools, then Inpaint'), 'success');
      },
      onAiOutpaint: () => {
        const id = selectedImageId();
        if (!id) return;
        modals.openModal({
          title: translate('designer_expand_image_ai', 'Expand Image (AI)'),
          children: (close: () => void) => (
            <OutpaintDialog
              onCancel={close}
              onApply={(mode, prompt) => {
                close();
                runAi(
                  (elId) => aiOutpaint({ fetch, store, elementId: elId }, mode, prompt),
                  translate('image_expansion_failed', 'Image expansion failed')
                );
              }}
            />
          ),
        });
      },
      onAiDetectSubject: () =>
        runAi((id) => aiDetectSubject({ fetch, store, elementId: id }), translate('subject_detection_failed', 'Subject detection failed')),
    }),
    [
      showSafeZones,
      showRulers,
      showPagesBar,
      onTogglePagesBar,
      aiActive,
      mediaOperationAvailable,
      mediaToolAvailable,
      currentDesignId,
      collabEnabled,
      setMedia,
      closeModal,
      store,
      modals,
      decision,
      layersPanel,
      historyPanel,
      versionsPanel,
      templatePanel,
      brandPanel,
      pixelOps,
      fetch,
      toaster,
      handleSave,
      handleSaveAsTemplate,
      handleExport,
      handleSaveToFiles,
      handleExportPostmill,
      handleImportDesignFile,
      pdesignExporting,
      onOpenMedia,
      onInsertMedia,
      confirmDiscardIfDirty,
      selectedImageId,
      runAi,
      translate,
    ]
  );

  const actions = useDesignerActions(store, ctx);

  const hasInspectorTarget =
    selectedIds.length >= 1 || (docMode === 'video' && !!selectedClip);

  // Global ⌘E → Export and ? → Keyboard Shortcuts (⌘S/⌘K already handled
  // elsewhere; the rest of the shortcut map is canvas-focus-scoped). Ignore
  // while typing in a field.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
        if (typing) return;
        e.preventDefault();
        handleSaveToFiles();
        return;
      }
      // `?` was advertised in the Help menu but never bound.
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey && !typing) {
        e.preventDefault();
        modals.openModal({
          children: (close: () => void) => (
            <ShortcutsOverlay onClose={close} videoMode={store.getState().doc.mode === 'video'} />
          ),
        });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSaveToFiles, modals, store]);

  // Full screen fills the browser window, not the display: the root goes immersive
  // (fixed inset-0) to cover the app chrome. Modals/dialogs mount at the app root
  // (z 200+) and stay above this z-100 layer.
  const surface = useFullscreenSurface('relative mobile:h-[calc(100vh-200px)]');

  return (
    <div className={`flex flex-col h-full w-full overflow-hidden bg-newBgColorInner ${surface}`}>
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-studioBorder bg-newBgColorInner shrink-0">
        <div className="flex items-center gap-2 shrink-0">
          <Logo size={26} className="" />
          <input
            value={designName}
            onChange={(e) => store.getState().setDesignName(e.target.value)}
            aria-label={translate('design_name_label', 'Design name')}
            className="mobile:hidden bg-transparent border-none text-textColor text-[14px] font-medium outline-hidden focus:border-b focus:border-designerAccent px-1 py-0.5 w-[150px]"
          />
        </div>

        <MenuBar actions={actions} />

        <div className="mobile:hidden flex items-center text-[11px] min-w-0 shrink-0">
          {/* A smart-filter re-bake replays the whole stack and uploads; on a
              large layer that is seconds of apparently nothing happening. */}
          {pixelOps.baking && (
            <span className="text-btnPrimaryAccent">
              {translate('designer_applying_filters', 'Applying filters…')}
            </span>
          )}
          {!pixelOps.baking && saveFailed && (
            <span className="px-2 py-0.5 rounded-full bg-red-500/10 text-dangerText">
              {saveRetryPaused
                ? translate('designer_save_failed_paused', 'Save failed — will retry on next edit')
                : translate('designer_save_failed_retrying', 'Save failed — retrying')}
            </span>
          )}
          {!pixelOps.baking && !saveFailed && isSaving && <span className="text-newTextColor/60">{translate('saving_ellipsis', 'Saving…')}</span>}
          {!pixelOps.baking && !saveFailed && !isSaving && !isDirty && currentDesignId && (
            <span className="text-green-500">{translate('saved_status', 'Saved')}</span>
          )}
          {!pixelOps.baking && !saveFailed && !isSaving && isDirty && <span className="text-amber-600">{translate('unsaved_status', 'Unsaved')}</span>}
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-1 shrink-0 min-w-0">
          {/* Secondary quick actions collapse on mobile (all reachable via the
              menus / ⌘ shortcuts); only Export + contextual actions stay. */}
          <div className="contents mobile:hidden">
          <button
            onClick={() => undo()}
            className="w-8 h-8 flex items-center justify-center rounded-sm text-textColor hover:bg-studioBorder/30 text-[13px] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-designerAccent"
            title={translate('undo_ctrl_z', 'Undo (Ctrl+Z)')}
            aria-label={translate('undo_ctrl_z', 'Undo (Ctrl+Z)')}
          >
            ↩
          </button>
          <button
            onClick={() => redo()}
            className="w-8 h-8 flex items-center justify-center rounded-sm text-textColor hover:bg-studioBorder/30 text-[13px] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-designerAccent"
            title={translate('redo_ctrl_shift_z', 'Redo (Ctrl+Shift+Z)')}
            aria-label={translate('redo_ctrl_shift_z', 'Redo (Ctrl+Shift+Z)')}
          >
            ↪
          </button>
          {currentDesignId && (
            <button
              className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                collabEnabled
                  ? 'bg-green-500/20 border-green-500/30 text-green-700 dark:text-green-400'
                  : 'border-studioBorder text-textColor/70 hover:text-textColor'
              }`}
              onClick={() => setCollabEnabled(!collabEnabled)}
              title={collabEnabled ? translate('peers_connected_count', '{{count}} connected', { count: connectedCount }) : translate('enable_realtime_collaboration', 'Enable real-time collaboration')}
            >
              {collabEnabled ? `👥 ${connectedCount}` : translate('share', 'Share')}
            </button>
          )}
          <div className="w-px h-6 bg-studioBorder mx-1" />
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-3 py-1.5 rounded-md text-[12px] border border-studioBorder text-textColor hover:bg-boxHover disabled:opacity-50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-designerAccent"
            aria-label={translate('save_ctrl_s', 'Save (Ctrl+S)')}
          >
            {translate('save', 'Save')}
          </button>
          </div>
          <FullscreenButton className="w-8 h-8 flex items-center justify-center rounded-sm text-textColor hover:bg-studioBorder/30 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-designerAccent shrink-0" />
          <KebabMenu
            ariaLabel={translate('export', 'Export')}
            align="right"
            triggerClassName={`px-4 py-1.5 rounded-md text-[12px] bg-designerAccent text-white hover:bg-designerAccent/80 font-medium focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-white gap-1 ${
              isSaving ? 'opacity-50 pointer-events-none' : ''
            }`}
            trigger={
              <>
                {translate('export', 'Export')}
                <DropdownArrowIcon size={12} className="text-white" />
              </>
            }
            items={[
              {
                label: translate('designer_save_to_files', 'Save to Files'),
                onClick: handleSaveToFiles,
              },
              {
                label: translate('designer_create_post', 'Create Post'),
                onClick: handleCreatePost,
              },
            ]}
          />
          {setMedia && (
            <button
              onClick={handleExport}
              disabled={isSaving}
              className="px-4 py-1.5 rounded-md text-[12px] bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 font-medium focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-white"
              aria-label={translate('use_in_post', 'Use in post')}
            >
              {translate('use_in_post', 'Use in post')}
            </button>
          )}
          {closeModal && (
            <>
              <div className="w-px h-6 bg-studioBorder mx-1" />
              <button
                onClick={closeModal}
                className="w-8 h-8 flex items-center justify-center rounded-sm text-textColor hover:bg-studioBorder/30 text-[15px] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-designerAccent"
                title={translate('close', 'Close')}
                aria-label={translate('close_designer', 'Close designer')}
              >
                ✕
              </button>
            </>
          )}
        </div>
      </div>

      {/* Tool options for the active tool — Photoshop's options bar. Image mode
          only: video mode drives the timeline, which owns its own bindings. */}
      <ToolOptionsBar
        activeTool={activeTool}
        options={activeToolOptions}
        onChange={onToolOptionChange}
      />

      <div className="relative flex flex-1 min-h-0 w-full overflow-hidden">
        {/* The tools apply to video as much as to images — a clip is a canvas
            object like any other. */}
        <ToolRail
          activeTool={activeTool}
          lastToolPerGroup={lastToolPerGroup}
          onSelect={setActiveTool}
          aiAvailable={aiActive}
        />
        {brandPanel.state.open && (
          <FloatingPanel
            title={translate('brand_label', 'Brand')}
            onClose={() => brandPanel.setOpen(false)}
            position={brandPanel.state}
            onPositionChange={brandPanel.setPosition}
            width={300}
          >
            <BrandPanel store={store as any} />
          </FloatingPanel>
        )}

        {templatePanel.state.open && (
          <FloatingPanel
            title={translate('designer_template_fields', 'Template fields')}
            onClose={() => templatePanel.setOpen(false)}
            position={templatePanel.state}
            onPositionChange={templatePanel.setPosition}
            width={280}
          >
            <TemplateFillPanel store={store as any} />
          </FloatingPanel>
        )}

        {historyPanel.state.open && (
          <FloatingPanel
            title={translate('designer_history', 'History')}
            onClose={() => historyPanel.setOpen(false)}
            position={historyPanel.state}
            onPositionChange={historyPanel.setPosition}
            width={260}
          >
            <HistoryPanel store={store as any} />
          </FloatingPanel>
        )}

        {versionsPanel.state.open && (
          <FloatingPanel
            title={translate('designer_versions', 'Versions')}
            onClose={() => versionsPanel.setOpen(false)}
            position={versionsPanel.state}
            onPositionChange={versionsPanel.setPosition}
            width={320}
          >
            <VersionsPanel store={store as any} />
          </FloatingPanel>
        )}

        {layersPanel.state.open && (
          <FloatingPanel
            title={translate('panel_layers', 'Layers')}
            onClose={() => layersPanel.setOpen(false)}
            position={layersPanel.state}
            onPositionChange={layersPanel.setPosition}
            footer={<LayersFooter store={store as any} />}
          >
            <LayersPanel
              store={store as any}
              onClose={() => layersPanel.setOpen(false)}
            />
          </FloatingPanel>
        )}

        <div className="flex-1 flex flex-col min-w-0">
          <div className="relative flex-1 flex min-h-0 min-w-0">
            <DesignerCanvas
              store={store}
              showSafeZones={showSafeZones}
              showRulers={showRulers}
              safeZonePreset={safeZonePreset}
              onAddImage={onOpenMedia}
              sendImageAwareness={collabEnabled ? collabData.sendImageAwareness : undefined}
            />
            <SelectionToolbar
              store={store}
              aiActive={aiActive}
              onAiRemoveBg={ctx.onAiRemoveBg}
              onAiUpscale={ctx.onAiUpscale}
              onAiInpaint={ctx.onAiInpaint}
            />
            <CollaborationCursors
              connectedCount={connectedCount}
              peers={docMode === 'video' ? peerTimelines : undefined}
              peerImages={docMode === 'image' ? peerImages : undefined}
              mode={docMode}
              durationMs={currentOutputDurationMs}
              store={store}
            />

            {/* Inspector overlays the canvas area ONLY (bounded by this
                relative parent), so it never covers the timeline/format tabs
                that sit below the canvas. */}
            {!inspectorCollapsed && (
              <div className="absolute right-0 top-0 bottom-0 w-[280px] z-20 border-l border-studioBorder bg-newBgColorInner overflow-y-auto p-3 shadow-xl">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[12px] font-medium text-textColor/60 uppercase tracking-wider">
                    {hasInspectorTarget ? translate('inspector_panel_label', 'Inspector') : translate('canvas_panel_label', 'Canvas')}
                  </div>
                  <button
                    onClick={() => setInspectorCollapsed(true)}
                    className="w-6 h-6 flex items-center justify-center rounded-sm text-textColor/60 hover:bg-studioBorder/30 hover:text-textColor text-[14px] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-designerAccent"
                    title={translate('collapse_panel', 'Collapse panel')}
                    aria-label={translate('collapse_properties_panel', 'Collapse properties panel')}
                  >
                    ›
                  </button>
                </div>
                {hasInspectorTarget ? (
                  <InspectorPanel store={store} />
                ) : (
                  <CanvasInspector
                    key={`canvas-${currentOutput}-${currentOutputSizeKey}`}
                    store={store}
                  />
                )}
              </div>
            )}

            {inspectorCollapsed && (
              <button
                onClick={() => setInspectorCollapsed(false)}
                className="absolute right-0 top-2 z-20 px-1.5 py-3 rounded-l-md border border-r-0 border-studioBorder bg-newBgColorInner text-textColor/60 hover:text-textColor shadow-xl text-[14px] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-designerAccent focus-visible:ring-inset"
                title={translate('show_properties', 'Show properties')}
                aria-label={translate('expand_properties_panel', 'Expand properties panel')}
              >
                ‹
              </button>
            )}
          </div>
          {docMode === 'video' && <VideoTimeline store={store} sendTimelineAwareness={collabData.sendTimelineAwareness} />}
          <PagesPanel store={store} visible={showPagesBar} />
          <OutputTabs store={store} />
        </div>
      </div>
      <CommandPalette actions={actions} />
      {showStart && (
        <StartDialog store={store} fetchFn={fetch} onDone={() => setShowStart(false)} />
      )}
      {mediaPicker.element}
      <input
        ref={importInputRef}
        type="file"
        accept=".pdesign,.json,application/zip,application/json"
        className="hidden"
        aria-hidden="true"
        onChange={handleImportDesignFile}
      />
    </div>
  );
};

export default Designer;
