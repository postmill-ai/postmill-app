'use client';

import React, { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createDesignerStore, migrateDoc, type DesignerStore, type DesignerDoc, type DesignerAttribution, type VideoOutput, type VideoClip } from './designer.store';
import { useCollaboration } from './collaboration';
import type { TimelineAwareness, ImageAwareness } from './collaboration';
import { CollaborationCursors, type PeerTimelineState } from './collaboration-cursors';
import { DesignerCanvas } from './canvas';
import { setImageFetch, clearImageCache } from './elements';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useDebounce } from 'use-debounce';
import { useAiActive } from '@gitroom/frontend/components/layout/use-ai-active';
import { useMediaToolsStatus } from '@gitroom/frontend/components/layout/use-media-tools-status';
import { TemplatesPanel } from './panels/templates-panel';
import { MyDesignsPanel } from './panels/my-designs-panel';
import { TextPanel } from './panels/text-panel';
import { ElementsPanel } from './panels/elements-panel';
import { PhotosPanel } from './panels/photos-panel';
import { UploadsPanel } from './panels/uploads-panel';
import { BackgroundPanel } from './panels/background-panel';
import { LayersPanel } from './panels/layers-panel';
import { AiPanel } from './panels/ai-panel';
import { BrandPanel } from './panels/brand-panel';
import { IconsPanel } from './panels/icons-panel';
import { InspectorPanel } from './panels/inspector-panel';
import { SelectionToolbar } from './selection-toolbar';
import { OutputTabs } from './output-tabs';
import { ShortcutsOverlay } from './shortcuts';
import { CommandPalette } from './command-palette';
import { ExportDialog } from './export-dialog';
import { VideoTimeline } from './video-timeline';
import { fitWithin } from './panels/fit-within';
import { MenuBar } from './menu-bar';
import { useDesignerActions, type DesignerActionCtx } from './actions';
import { NewDesignDialog } from './new-design-dialog';
import { CanvasInspector } from './panels/canvas-inspector';
import { MediaSelectorModal } from '../media-selector-modal';
import { StartDialog } from './start-dialog';
import { aiRemoveBackground, aiUpscale, aiDetectSubject } from './ai-image-actions';
import { addMediaToTimeline } from './add-media-to-timeline';
import { Logo } from '@gitroom/frontend/components/new-layout/logo';
import { FullscreenButton } from '@gitroom/frontend/components/media-tools/fullscreen-button';
import { useFullscreen } from '@gitroom/frontend/components/media-tools/use-fullscreen';
import { getBrandViolations } from './brand-compliance';
import { useBrandColors } from './panels/use-brand-colors';
import { useBrandFonts } from './panels/use-brand-fonts';
import { useUser } from '@gitroom/frontend/components/layout/user.context';

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
  const [activePanel, setActivePanel] = useState<string | null>(null);
  const [showSafeZones, setShowSafeZones] = useState(false);
  const [showRulers, setShowRulers] = useState(true);
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
  const user = useUser();
  const brandColors = useBrandColors();
  const brandFonts = useBrandFonts();
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

  const designName = store((s) => s.designName);
  const currentDesignId = store((s) => s.designId);
  const isDirty = store((s) => s.isDirty);
  const isSaving = store((s) => s.isSaving);
  const doc = store((s) => s.doc);
  const currentOutput = store((s) => s.currentOutput);
  const selectedIds = store((s) => s.selectedIds);
  const selectedClip = store((s) => s.selectedClip);
  const brandEnforcement = store((s) => s.brandEnforcement);
  const brandAdminOverride = store((s) => s.brandAdminOverride);
  const undo = store((s) => s.undo);
  const redo = store((s) => s.redo);

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
    sendUpdate(doc);
  }, [doc, collabEnabled, currentDesignId, sendUpdate]);

  // Let the canvas image loader use the authenticated proxy for cross-origin
  // hosts (stock images) that don't send CORS headers (otherwise blank canvas).
  useEffect(() => {
    setImageFetch(fetch);
    return () => setImageFetch(null);
  }, [fetch]);

  // Best-matching channel preset for safe-zone overlays (E7).
  const safeZonePreset = useMemo(
    () => doc.outputs[currentOutput]?.formatId || null,
    [doc.outputs, currentOutput]
  );

  const brandViolations = useMemo(
    () =>
      getBrandViolations(doc, {
        enforcement: brandEnforcement,
        adminOverride: brandAdminOverride,
        brandColors,
        brandFonts,
      }),
    [doc, brandEnforcement, brandAdminOverride, brandColors, brandFonts]
  );
  const canAdminOverride = user?.role === 'owner' || user?.role === 'admin';
  const isBrandCompliant = brandViolations.length === 0 || brandAdminOverride;

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

  const [debouncedDoc] = useDebounce(doc, 2000);

  useEffect(() => {
    if (!debouncedDoc || !currentDesignId || !isDirty) return;
    const sentDoc = debouncedDoc;
    store.getState().setSaving(true);
    fetch(`/media/designs/${currentDesignId}`, {
      method: 'PUT',
      body: JSON.stringify({ doc: sentDoc }),
    })
      .then((res) => res.json())
      .then(() => {
        // Only clear isDirty if no edit landed while the PUT was in flight —
        // zustand replaces the doc object on every edit, so a reference mismatch
        // means unsaved changes exist and must not be marked "Saved".
        if (store.getState().doc === sentDoc) {
          store.getState().markSaved();
        } else {
          store.getState().setSaving(false);
        }
      })
      .catch(() => {
        store.getState().setSaving(false);
      });
  }, [debouncedDoc, currentDesignId, isDirty, fetch, store]);

  const handleExport = useCallback(() => {
    const s = store.getState();
    if (s.brandEnforcement && !s.brandAdminOverride && brandViolations.length > 0) {
      toaster.show(translate('export_blocked_off_brand', 'Export blocked: off-brand elements detected. Fix them or use admin override.'), 'warning');
      return;
    }
    modals.openModal({
      children: <ExportDialog store={store} onClose={() => modals.closeAll()} />,
    });
  }, [modals, store, brandViolations, toaster, translate]);

  const handleSave = useCallback(async () => {
    const s = store.getState();
    if (s.brandEnforcement && !s.brandAdminOverride && brandViolations.length > 0) {
      toaster.show(translate('save_blocked_off_brand', 'Save blocked: off-brand elements detected. Fix them or use admin override.'), 'warning');
      return;
    }
    s.setSaving(true);
    try {
      const stageEl = document.querySelector('.konva-stage canvas') as HTMLCanvasElement;
      const previewDataUrl = getThumbnailDataUrl(stageEl);
      let previewFileId: string | undefined;
      const previewBlob = previewDataUrl ? dataUrlToBlob(previewDataUrl) : null;
      if (previewBlob) {
        try {
          const form = new FormData();
          form.append('file', previewBlob, 'thumbnail.jpg');
          const uploadRes = await fetch('/files/upload-simple', { method: 'POST', body: form });
          if (uploadRes.ok) {
            const uploadData = await uploadRes.json();
            previewFileId = uploadData.id;
          }
        } catch {
          // Fall back to storing the data URL below.
        }
      }
      const payload: Record<string, unknown> = {
        name: s.designName,
        doc: s.doc,
        width: s.doc.outputs[0]?.width,
        height: s.doc.outputs[0]?.height,
      };
      if (previewFileId) payload.previewFileId = previewFileId;
      // Only ship the base64 preview as a fallback when the upload failed, to keep
      // the save JSON small.
      else if (previewDataUrl) payload.previewDataUrl = previewDataUrl;
      if (s.designId) {
        const res = await fetch(`/media/designs/${s.designId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Save failed');
      } else {
        const res = await fetch('/media/designs', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Save failed');
        const data = await res.json();
        s.setDesignId(data.id);
      }
      s.markSaved();
      toaster.show(translate('design_saved', 'Design saved'), 'success');
    } catch {
      toaster.show(translate('save_failed', 'Failed to save'), 'warning');
    } finally {
      s.setSaving(false);
    }
  }, [fetch, toaster, store, brandViolations, translate]);

  const handleSaveAsTemplate = useCallback(async () => {
    const s = store.getState();
    if (s.brandEnforcement && !s.brandAdminOverride && brandViolations.length > 0) {
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
          const uploadRes = await fetch('/files/upload-simple', { method: 'POST', body: form });
          if (uploadRes.ok) {
            const uploadData = await uploadRes.json();
            thumbnailFileId = uploadData.id;
          }
        } catch {}
      }
      const payload: Record<string, unknown> = {
        name: s.designName,
        category: s.doc.outputs[0]?.formatId || 'custom',
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
  }, [fetch, toaster, store, brandViolations, translate]);

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
        const { width: w, height: h } = fitWithin(
          asset.naturalWidth || active.width * 0.5,
          asset.naturalHeight || active.height * 0.5,
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
        });
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
      // setVideoDuration hard-clamps to 60 s — so the clip's endMs must be capped too.
      const durationMs = Math.min(rawDurationMs, 60000);
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
    addMediaToTimeline(store, initialTimelineMedia).catch(() => {
      toaster.show(translate('could_not_add_media_to_timeline', 'Could not add media to timeline'), 'warning');
    });
  }, [initialTimelineMedia, store, toaster, translate]);

  // --- Unsaved-changes guard shared by New / Open / Templates (D-7b) ---
  const confirmDiscardIfDirty = useCallback(() => {
    if (store.getState().isDirty) {
      return window.confirm(translate('discard_unsaved_changes_confirm', 'Discard unsaved changes? Your current design will be replaced.'));
    }
    return true;
  }, [store, translate]);

  // Reusable image-from-media placement (centered + aspect-correct) — shared by
  // the Insert/Import media modal and the canvas "Add Image" (D-8).
  const addImageFromMedia = useCallback(
    (item: { url: string; fileId?: string; width?: number; height?: number }) => {
      const state = store.getState();
      const active = state.doc.outputs[state.currentOutput];
      const { width: w, height: h } = fitWithin(
        item.width || active.width,
        item.height || active.height,
        active.width,
        active.height
      );
      state.addElement({
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
        src: item.url,
        fileId: item.fileId,
        naturalWidth: item.width || undefined,
        naturalHeight: item.height || undefined,
      });
    },
    [store]
  );

  const onOpenMedia = useCallback(() => {
    modals.openModal({
      title: translate('add_media', 'Add media'),
      children: (close: () => void) => (
        <MediaSelectorModal
          open
          onClose={close}
          onSelect={(item) => {
            addImageFromMedia(item as any);
            close();
          }}
        />
      ),
    });
  }, [modals, addImageFromMedia, translate]);

  const selectedImageId = useCallback(() => {
    const st = store.getState();
    const out = st.doc.outputs[st.currentOutput] as any;
    const els = (out?.children || []).filter((c: any) => st.selectedIds.includes(c.id));
    return els.length === 1 && els[0].type === 'image' ? (els[0].id as string) : null;
  }, [store]);

  const runAi = useCallback(
    async (fn: (id: string) => Promise<void>, failMsg: string) => {
      const id = selectedImageId();
      if (!id) return;
      try {
        await fn(id);
      } catch {
        toaster.show(failMsg, 'warning');
      }
    },
    [selectedImageId, toaster]
  );

  const ctx: DesignerActionCtx = useMemo(
    () => ({
      showSafeZones,
      showRulers,
      aiActive,
      mediaOperationAvailable,
      canShare: !!currentDesignId,
      collabEnabled,
      inModal: !!(setMedia || closeModal),
      onNew: (mode) => {
        if (!confirmDiscardIfDirty()) return;
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
                if (!confirmDiscardIfDirty()) return;
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
      onSaveAsTemplate: handleSaveAsTemplate,
      onOpenMedia,
      onExport: handleExport,
      onUseInPost: setMedia ? handleExport : undefined,
      onClose: closeModal,
      onCanvasProperties: () => {
        store.getState().setSelectedIds([]);
        setInspectorCollapsed(false);
      },
      onTogglePanel: (id) => setActivePanel((p) => (p === id ? null : id)),
      onToggleInspector: () => setInspectorCollapsed((c) => !c),
      onToggleSafeZones: () => setShowSafeZones((v) => !v),
      onToggleRulers: () => setShowRulers((v) => !v),
      onToggleSnap: () => {
        const st = store.getState();
        st.setSnapEnabled(!st.snapEnabled);
      },
      onFitToScreen: () => store.getState().requestFit(),
      onActualSize: () => store.getState().setZoom(1),
      onShortcuts: () =>
        modals.openModal({
          children: (close: () => void) => <ShortcutsOverlay onClose={close} />,
        }),
      onConvertMode: () => {
        const st = store.getState();
        const cur = st.doc.mode;
        const target = cur === 'image' ? 'video' : 'image';
        const msg =
          cur === 'image'
            ? translate('convert_to_video_mode_confirm', 'Convert to video mode? All image elements will be lost.')
            : translate('convert_to_image_mode_confirm', 'Convert to image mode? All video tracks and clips will be lost.');
        if (window.confirm(msg)) st.setMode(target);
      },
      onToggleShare: () => setCollabEnabled((v) => !v),
      onAiGenerate: () => setActivePanel('ai'),
      onAiRemoveBg: () =>
        runAi((id) => aiRemoveBackground({ fetch, store, elementId: id }), translate('background_removal_failed', 'Background removal failed')),
      onAiUpscale: (scale) =>
        runAi((id) => aiUpscale({ fetch, store, elementId: id }, scale), translate('upscale_failed', 'Upscale failed')),
      onAiInpaint: () => {
        const id = selectedImageId();
        if (!id) return;
        setActivePanel(null);
        setInspectorCollapsed(false);
        toaster.show(translate('draw_mask_ai_tools_inpaint', 'Draw a mask in the inspector’s AI Tools, then Inpaint'), 'success');
      },
      onAiDetectSubject: () =>
        runAi((id) => aiDetectSubject({ fetch, store, elementId: id }), translate('subject_detection_failed', 'Subject detection failed')),
    }),
    [
      showSafeZones,
      showRulers,
      aiActive,
      mediaOperationAvailable,
      currentDesignId,
      collabEnabled,
      setMedia,
      closeModal,
      store,
      modals,
      fetch,
      toaster,
      handleSave,
      handleSaveAsTemplate,
      handleExport,
      onOpenMedia,
      confirmDiscardIfDirty,
      selectedImageId,
      runAi,
      translate,
    ]
  );

  const actions = useDesignerActions(store, ctx);

  const hasInspectorTarget =
    selectedIds.length >= 1 || (doc.mode === 'video' && !!selectedClip);

  const onSetBackgroundImage = useCallback(() => {
    modals.openModal({
      title: translate('background_image', 'Background image'),
      children: (close: () => void) => (
        <MediaSelectorModal
          open
          onClose={close}
          onSelect={(item) => {
            store.getState().setOutputBackground({
              type: 'image',
              src: (item as any).url,
              fileId: (item as any).fileId,
            });
            close();
          }}
        />
      ),
    });
  }, [modals, store, translate]);

  const panels = [
    { id: 'text', icon: 'T', label: translate('provider_chip_text', 'Text') },
    { id: 'elements', icon: '◇', label: translate('panel_elements', 'Elements') },
    { id: 'icons', icon: '★', label: translate('panel_icons', 'Icons') },
    { id: 'photos', icon: '▣', label: translate('panel_photos', 'Photos') },
    { id: 'uploads', icon: '☰', label: translate('panel_uploads', 'Uploads') },
    { id: 'background', icon: '◨', label: translate('panel_background', 'Background') },
    { id: 'layers', icon: '≡', label: translate('panel_layers', 'Layers') },
    // AI panel only when the org has an active AI provider (E4).
    ...(aiActive ? [{ id: 'ai', icon: '✦', label: translate('ai', 'AI') }] : []),
    { id: 'brand', icon: '♥', label: translate('brand_label', 'Brand') },
  ];

  // Global ⌘E → Export (⌘S/⌘K already handled elsewhere; the rest of the
  // shortcut map is canvas-focus-scoped). Ignore while typing in a field.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
        const t = e.target as HTMLElement | null;
        const tag = t?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable) return;
        e.preventDefault();
        handleExport();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleExport]);

  // Full-screen fills the canvas app, not the page: the document goes fullscreen and the
  // Designer root goes immersive (fixed inset-0) to cover the app chrome. Modals/dialogs
  // mount at the app root (z 200+) and stay above this z-[100] layer.
  const { isFullscreen } = useFullscreen();

  return (
    <div className={`flex flex-col h-full w-full overflow-hidden bg-newBgColorInner ${isFullscreen ? 'fixed inset-0 z-[100]' : 'relative'}`}>
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-studioBorder bg-newBgColorInner shrink-0">
        <div className="flex items-center gap-2 shrink-0">
          <Logo size={26} className="" />
          <input
            value={designName}
            onChange={(e) => store.getState().setDesignName(e.target.value)}
            aria-label={translate('design_name_label', 'Design name')}
            className="mobile:hidden bg-transparent border-none text-textColor text-[14px] font-medium outline-none focus:border-b focus:border-designerAccent px-1 py-0.5 w-[150px]"
          />
        </div>

        <MenuBar actions={actions} />

        <div className="mobile:hidden flex items-center text-[11px] min-w-0 shrink-0">
          {isSaving && <span className="text-newTextColor/60">{translate('saving_ellipsis', 'Saving…')}</span>}
          {!isSaving && !isDirty && currentDesignId && (
            <span className="text-green-500">{translate('saved_status', 'Saved')}</span>
          )}
          {!isSaving && isDirty && <span className="text-amber-600">{translate('unsaved_status', 'Unsaved')}</span>}
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-1 shrink-0 min-w-0">
          {/* Secondary quick actions collapse on mobile (all reachable via the
              menus / ⌘ shortcuts); only Export + contextual actions stay. */}
          <div className="contents mobile:hidden">
          <button
            onClick={() => undo()}
            className="w-8 h-8 flex items-center justify-center rounded text-textColor hover:bg-studioBorder/30 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-designerAccent"
            title={translate('undo_ctrl_z', 'Undo (Ctrl+Z)')}
            aria-label={translate('undo_ctrl_z', 'Undo (Ctrl+Z)')}
          >
            ↩
          </button>
          <button
            onClick={() => redo()}
            className="w-8 h-8 flex items-center justify-center rounded text-textColor hover:bg-studioBorder/30 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-designerAccent"
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
            className="px-3 py-1.5 rounded-md text-[12px] border border-studioBorder text-textColor hover:bg-boxHover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-designerAccent"
            aria-label={translate('save_ctrl_s', 'Save (Ctrl+S)')}
          >
            {translate('save', 'Save')}
          </button>
          </div>
          <FullscreenButton className="w-8 h-8 flex items-center justify-center rounded text-textColor hover:bg-studioBorder/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-designerAccent shrink-0" />
          <button
            onClick={handleExport}
            disabled={isSaving}
            className="px-4 py-1.5 rounded-md text-[12px] bg-designerAccent text-white hover:bg-designerAccent/80 disabled:opacity-50 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            {translate('export', 'Export')}
          </button>
          {setMedia && (
            <button
              onClick={handleExport}
              disabled={isSaving}
              className="px-4 py-1.5 rounded-md text-[12px] bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
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
                className="w-8 h-8 flex items-center justify-center rounded text-textColor hover:bg-studioBorder/30 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-designerAccent"
                title={translate('close', 'Close')}
                aria-label={translate('close_designer', 'Close designer')}
              >
                ✕
              </button>
            </>
          )}
        </div>
      </div>

      <div className="relative flex flex-1 min-h-0 w-full overflow-hidden">
        <div className="w-[48px] shrink-0 flex flex-col items-center pt-2 gap-1 border-r border-studioBorder bg-newBgColorInner z-30">
          {panels.map((p) => (
            <button
              key={p.id}
              tabIndex={0}
              onClick={() => setActivePanel(activePanel === p.id ? null : p.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setActivePanel(activePanel === p.id ? null : p.id);
                }
              }}
              className={`w-9 h-9 flex items-center justify-center rounded-lg text-[15px] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-designerAccent ${
                activePanel === p.id
                  ? 'bg-designerAccent/20 text-btnPrimaryAccent'
                  : 'text-textColor/60 hover:bg-studioBorder/30 hover:text-textColor'
              }`}
              title={p.label}
              aria-label={translate('panel_aria_label', '{{label}} panel', { label: p.label })}
            >
              {p.icon}
            </button>
          ))}
        </div>

        {activePanel && (
          <div className="absolute left-[48px] top-0 bottom-0 w-[260px] z-20 border-r border-studioBorder bg-newBgColorInner overflow-y-auto p-3 shadow-xl">
            <div className="text-[12px] font-medium text-textColor/60 uppercase tracking-wider mb-3">
              {panels.find((p) => p.id === activePanel)?.label}
            </div>
            {activePanel === 'text' && <TextPanel store={store as any} />}
            {activePanel === 'elements' && <ElementsPanel store={store as any} />}
            {activePanel === 'icons' && <IconsPanel store={store as any} />}
            {activePanel === 'photos' && <PhotosPanel store={store as any} />}
            {activePanel === 'uploads' && <UploadsPanel store={store as any} />}
            {activePanel === 'background' && <BackgroundPanel store={store as any} />}
            {activePanel === 'layers' && <LayersPanel store={store as any} />}
            {activePanel === 'ai' && <AiPanel store={store as any} />}
            {activePanel === 'brand' && <BrandPanel store={store as any} />}
          </div>
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
              peers={doc.mode === 'video' ? peerTimelines : undefined}
              peerImages={doc.mode === 'image' ? peerImages : undefined}
              mode={doc.mode}
              durationMs={doc.mode === 'video' ? (doc.outputs[currentOutput] as any)?.durationMs : undefined}
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
                    className="w-6 h-6 flex items-center justify-center rounded text-textColor/60 hover:bg-studioBorder/30 hover:text-textColor text-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-designerAccent"
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
                    key={`canvas-${currentOutput}-${(doc.outputs[currentOutput] as any)?.width}x${(doc.outputs[currentOutput] as any)?.height}`}
                    store={store}
                    onSetBackgroundImage={onSetBackgroundImage}
                  />
                )}
              </div>
            )}

            {inspectorCollapsed && (
              <button
                onClick={() => setInspectorCollapsed(false)}
                className="absolute right-0 top-2 z-20 px-1.5 py-3 rounded-l-md border border-r-0 border-studioBorder bg-newBgColorInner text-textColor/60 hover:text-textColor shadow-xl text-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-designerAccent focus-visible:ring-inset"
                title={translate('show_properties', 'Show properties')}
                aria-label={translate('expand_properties_panel', 'Expand properties panel')}
              >
                ‹
              </button>
            )}
          </div>
          {doc.mode === 'video' && <VideoTimeline store={store} sendTimelineAwareness={collabData.sendTimelineAwareness} />}
          <OutputTabs store={store} />
        </div>
      </div>
      <CommandPalette actions={actions} />
      {showStart && (
        <StartDialog store={store} fetchFn={fetch} onDone={() => setShowStart(false)} />
      )}
    </div>
  );
};

export default Designer;
