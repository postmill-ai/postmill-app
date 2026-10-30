import { create } from 'zustand';
import { CHANNEL_PRESETS } from '@postmill-ai/nestjs-libraries/integrations/social/channel-presets';
import { detectFocalPoint } from './reflow';
import {
  disposeAllBuffers,
  disposeElementBuffers,
  reconcileBuffersWithDoc,
} from './raster-layers';
import { DEFAULT_TOOL_ID, getTool } from './tools';
import type { SelectionMask } from './selection-mask';
import { DESIGNER_DOC_VERSION, MAX_VIDEO_DURATION_MS } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.limits';
import { splitSpeedCurveForClip } from '@postmill-ai/nestjs-libraries/media/designer-doc/speed-curve';
import {
  pageChildren,
  withPageChildren,
  pageCount,
  appendPage,
  removePageAt,
  duplicatePageAt,
  movePage,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.pages';
import {
  migrateDoc,
  genId,
  matchPreset,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.migrate';
import { smartReflow, computeGroupBoxes } from '@postmill-ai/nestjs-libraries/media/designer-doc/reflow';
import { seedCopy } from '@postmill-ai/nestjs-libraries/media/designer-doc/seed-copy';
import { canSplitClipAt } from './timeline-split';
import { applyLinked, applyElementPatch, applyLinkedVideoClip, GEOMETRY_KEYS } from '@postmill-ai/nestjs-libraries/media/designer-doc/apply-linked';
import {
  seedVideoOutput,
  reflowVideoOutputInPlace,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/video-reflow';
import { moveLayers, descendantIds } from '@postmill-ai/nestjs-libraries/media/designer-doc/layer-tree';
import type {
  DesignerDoc,
  DesignerElement,
  DesignerOutput,
  VideoOutput,
  VideoTrack,
  VideoClip,
  VideoMarker,
  ClipTransition,
  DesignerBackground,
  DesignerGradient,
  DesignerTexture,
  DesignerMask,
  TextRun,
  DesignerAttribution,
  DesignerTextShadow,
  StickerFrame,
  DesignerBlendMode,
  DesignerLayerStyle,
  DesignerPattern,
  DesignerFillStyle,
  DesignerAdjustment,
  DesignerPageContent,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import type { FillContents } from '@postmill-ai/nestjs-libraries/media/designer-doc/fill-stroke';
import { mergeKeyframes } from './keyframe-props';
import { expandClipRefs, groupRefsForClip, toggleClipRefs } from './video-selection';

export type {
  DesignerDoc,
  DesignerElement,
  DesignerOutput,
  VideoOutput,
  VideoTrack,
  VideoClip,
  VideoMarker,
  ClipTransition,
  DesignerBackground,
  DesignerGradient,
  DesignerTexture,
  DesignerMask,
  TextRun,
  DesignerAttribution,
  DesignerTextShadow,
  StickerFrame,
  DesignerBlendMode,
  DesignerLayerStyle,
  DesignerPattern,
  DesignerFillStyle,
  DesignerAdjustment,
  DesignerPageContent,
  FillContents,
};
export { migrateDoc };

/** Hard cap on timeline tracks per output — unbounded track creation (the
 *  drag-below-creates-track gesture, landing on occupied tracks) would
 *  otherwise grow the doc and the render graph without limit. */
export const MAX_TRACKS = 40;
export {
  pageChildren,
  pageCount,
  pageBackground,
  pageName,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.pages';

export interface DesignerState {
  doc: DesignerDoc;
  selectedIds: string[];
  /**
   * Layer the user asked to rename from the Layer menu. The panel owns the
   * inline editor, so the menu action just names the target and the panel
   * picks it up; it clears itself once the editor opens.
   */
  renamingId: string | null;
  currentOutput: number;
  /**
   * 0-based page within the CURRENT output (doc v8): 0 is page 1
   * (`output.children`), n ≥ 1 is `output.pages[n - 1]`. Editor state, not
   * document content — it resets/clamps whenever outputs or history change.
   */
  currentPage: number;
  zoom: number; viewportX: number; viewportY: number;
  history: DesignerDoc[]; historyIndex: number;
  /**
   * What each history entry DID, parallel to `history`. Optional at every call
   * site — an unlabelled push reads as a generic edit rather than forcing all
   * ~60 callers to be touched at once.
   */
  historyLabels: string[];
  // The history index that matches the last persisted doc, so undo/redo back to a
  // saved state clears isDirty instead of always reporting unsaved.
  savedHistoryIndex: number;
  designId: string | null;
  designTemplateId: string | null;
  templateId: string | null;
  designName: string;
  isDirty: boolean; isSaving: boolean; lastSaved: Date | null;
  /** An autosave write failed and a backoff retry is pending — drives the header pill. */
  saveFailed: boolean;
  /** Retries gave up after repeated failures; the next real edit re-arms them. */
  saveRetryPaused: boolean;
  clipboard: DesignerElement[];
  editFormatOnly: boolean;
  brandEnforcement: boolean;
  brandAdminOverride: boolean;
  playheadMs: number;
  /**
   * Whether timeline playback is currently running. Ephemeral editor state
   * (never part of history); mirrored from VideoTimeline so sibling subtrees —
   * the canvas overlay's repaint loop — can gate per-frame work on it without
   * prop-threading through DesignerCanvas.
   */
  isPlaying: boolean;
  /** The primary selection — drives the inspector. Always a member of `selectedClips`. */
  selectedClip: { outputIndex: number; trackId: string; clipId: string } | null;
  /**
   * Multi-select on the video timeline. Editor state, deliberately NOT part of
   * history (snapshots carry only `doc`). Members carry no outputIndex — track
   * ids are doc-unique and the timeline only renders the current output.
   */
  selectedClips: { trackId: string; clipId: string }[];
  /**
   * Clips copied from the timeline. `trackId` targets the paste at the original
   * track; `trackType` is the fallback when that track is gone (find-or-create,
   * the same rule add-media-to-timeline uses).
   */
  clipClipboard: { clip: VideoClip; trackId: string; trackType: VideoTrack['type'] }[];
  /**
   * Keyframes copied from a single clip, for paste-onto-another-clip. Editor
   * state like `clipClipboard`, deliberately NOT part of history. tMs values
   * are clip-relative, so a paste lands at the same offset into the target
   * clip regardless of where either clip sits on the timeline.
   */
  keyframeClipboard: NonNullable<VideoClip['keyframes']> | null;
  linkedUpdateFlash: Record<number, number>;
  // View prefs / canvas requests (menu-driven)
  snapEnabled: boolean;
  /** Timeline clip/marker snapping — a view pref like `snapEnabled`, not document content. */
  timelineSnap: boolean;
  /** Video timeline panel height in px (drag-resized); view pref, clamped on write. */
  timelineHeight: number;
  /** Grid overlay — a view pref, like snapping, not part of the document. */
  showGrid: boolean;
  gridSize: number;
  snapToGrid: boolean;
  fitNonce: number;
  // Photoshop-style tool palette (see tools.ts). Tool state is editor UI, not
  // document content — it is deliberately NOT part of DesignerDoc and never
  // reaches the renderer.
  activeTool: string;
  /** Last tool used per group, so a rail slot shows the option you last picked. */
  lastToolPerGroup: Record<string, string>;
  /** Per-tool settings shown in the options bar, keyed by tool id. */
  toolOptions: Record<string, Record<string, unknown>>;
  /**
   * The pixel selection — Photoshop's marching ants.
   *
   * Editor state, NOT document content: it lives here rather than inside the
   * paint hook only so the Select menu and the filter runner can reach it, and
   * it must never be written into `doc`, or every marquee drag would land in
   * undo history and in the saved design.
   */
  selection: SelectionMask | null;
  /** The last non-empty selection, for Select ▸ Reselect. */
  lastSelection: SelectionMask | null;
  /**
   * The layer whose MASK the paint tools should write into, rather than its
   * pixels. Editor state — which of a layer's two surfaces is armed is not part
   * of the document.
   */
  maskTargetId: string | null;
  /**
   * A generation the Tools menu asked the timeline to open.
   *
   * The dialogs and their result-landing logic live in `video-timeline`, which
   * the menu can't reach — so the menu names what it wants and the timeline
   * opens its own dialog, then clears this. Same request/consume shape as
   * `renamingId`.
   */
  generateRequest: 'video' | 'music' | 'voiceover' | 'record-voiceover' | null;
}

export interface DesignerActions {
  setDoc: (doc: DesignerDoc) => void;
  setCharacterReferences: (references: DesignerDoc['characterReferences']) => void;
  setDesignName: (name: string) => void;
  setDesignId: (id: string | null) => void;
  setTemplateId: (id: string | null) => void;
  addElement: (element: DesignerElement, beforeId?: string) => void;
  updateElement: (id: string, updates: Partial<DesignerElement>) => void;
  updateElements: (ids: string[], updates: Partial<DesignerElement>) => void;
  // Same as updateElements but does NOT commit history — for continuous controls
  // (slider/drag), which push a single history entry on release instead.
  updateElementsSilent: (ids: string[], updates: Partial<DesignerElement>) => void;
  /**
   * Gesture-scoped write: patches the element on the CURRENT output only, with
   * no cross-output applyLinked and no linkedUpdateFlash churn. Drag/transform
   * move events call it per rAF frame; dragEnd/transformEnd re-commit through
   * updateElement (+ pushHistory), so the gesture's final state and its single
   * history entry are identical to the plain updateElement path.
   */
  updateElementEphemeral: (id: string, updates: Partial<DesignerElement>) => void;
  removeElement: (id: string) => void;
  removeElements: (ids: string[]) => void;
  duplicateElement: (id: string) => void;
  setSelectedIds: (ids: string[]) => void;
  requestRename: (id: string | null) => void;
  // `commit: false` writes without a history entry — continuous controls
  // (texture sliders) write silently per tick and pushHistory once on release,
  // the same discipline `updateElementsSilent` gives element sliders.
  setOutputBackground: (bg: DesignerBackground, commit?: boolean) => void;
  copySelection: () => void; cutSelection: () => void; paste: () => void;
  groupSelection: (ids?: string[]) => void; ungroupSelection: (ids?: string[]) => void;
  /** Turn the selection into a reusable symbol, replacing it with an instance. */
  createSymbol: (name?: string) => void;
  /** Place another instance of an existing symbol. */
  placeSymbol: (symbolId: string) => void;
  /** Push edits back into the definition, updating every instance at once. */
  updateSymbolDefinition: (symbolId: string, children: DesignerElement[]) => void;
  reorder: (ids: string[], dir: 'front' | 'back' | 'forward' | 'backward') => void;
  /** Drag-to-reorder / reparent. `reorder` can only nudge front/back. */
  moveLayersTo: (ids: string[], targetIndex: number, parentId?: string) => void;
  /** Insert a new layer of any kind above the current selection. */
  addLayer: (kind: 'group' | 'fill' | 'adjustment', init?: Partial<DesignerElement>) => void;
  /** Toggle Photoshop's clipping-mask flag on the selection. */
  toggleClipped: (ids: string[]) => void;
  setLayerBlend: (ids: string[], blendMode: DesignerBlendMode) => void;
  /** Collapse/expand a group in the layers panel. */
  toggleGroupCollapsed: (id: string) => void;
  // outputs (replaces multi-page)
  setCurrentOutput: (index: number) => void;
  addOutput: (preset: { formatId: string; name: string; width: number; height: number }) => void;
  removeOutput: (index: number) => void;
  resizeOutput: (index: number, width: number, height: number, formatId?: string, name?: string) => void;
  // pages within an image output (doc v8). pageNumber is 0-based; 0 = page 1.
  setCurrentPage: (pageNumber: number) => void;
  /** Append a blank page to the current output. No-op at MAX_PAGES_PER_OUTPUT. */
  addPage: (name?: string) => void;
  /** Deep-clone page `pageNumber` of the current output (fresh ids/originIds). */
  duplicatePage: (pageNumber: number) => void;
  /** Remove page `pageNumber` of the current output; page 1 cannot be removed. */
  removePage: (pageNumber: number) => void;
  renamePage: (pageNumber: number, name: string) => void;
  /** Move a page within the current output's full page range [0..pageCount). */
  reorderPage: (from: number, to: number) => void;
  // linked-by-default
  setEditFormatOnly: (v: boolean) => void;
  setBrandEnforcement: (v: boolean) => void;
  setBrandAdminOverride: (v: boolean) => void;
  unlinkElement: (id: string) => void;
  relinkElement: (id: string, originId: string) => void;
  setZoom: (zoom: number) => void;
  setViewport: (x: number, y: number) => void;
  setSnapEnabled: (v: boolean) => void;
  setTimelineSnap: (v: boolean) => void;
  setTimelineHeight: (px: number) => void;
  setShowGrid: (v: boolean) => void;
  setGridSize: (n: number) => void;
  setSnapToGrid: (v: boolean) => void;
  /** Add a ruler guide to the active output. Editor state, never exported. */
  addGuide: (axis: 'x' | 'y', position: number) => void;
  /** Move guide `index` on `axis`; pass null to delete it. */
  moveGuide: (axis: 'x' | 'y', index: number, position: number | null) => void;
  clearGuides: () => void;
  requestFit: () => void;
  /** Select a tool; also remembers it as its group's last-used option. */
  setActiveTool: (toolId: string) => void;
  setToolOption: (toolId: string, key: string, value: unknown) => void;
  /** Replace the pixel selection. Remembers the outgoing one for Reselect. */
  setSelection: (mask: SelectionMask | null) => void;
  requestGenerate: (kind: 'video' | 'music' | 'voiceover' | 'record-voiceover' | null) => void;
  /** Arm a layer's mask as the paint target (null = paint the pixels). */
  setMaskTarget: (id: string | null) => void;
  undo: () => void; redo: () => void; pushHistory: (label?: string) => void;
  /** Jump straight to a history entry, as Photoshop's History panel does. */
  jumpToHistory: (index: number) => void;
  markSaved: () => void; setSaving: (saving: boolean) => void; setSaveFailed: (failed: boolean) => void;
  setSaveRetryPaused: (paused: boolean) => void;
  reset: (width?: number, height?: number) => void;
  loadDesign: (doc: any, id: string, name: string, templateId?: string | null) => void;
  // video mode
  addTrack: (outputIndex: number, type: VideoTrack['type']) => void;
  removeTrack: (outputIndex: number, trackId: string) => void;
  addClip: (outputIndex: number, trackId: string, clip: VideoClip) => void;
  removeClip: (outputIndex: number, trackId: string, clipId: string) => void;
  /**
   * The timeline's cross-track drop: move clips onto other tracks — or onto a
   * freshly appended track (`opts.newTrackType`, referenced by `toTrackId:
   * null`) — as ONE history entry. Timings arrive already collision-resolved
   * (clip-geometry `resolveClipPlacement`/`planTrackDrop`). Returns false —
   * nothing moved, no history — when any move is illegal: unknown clip,
   * type-mismatched or locked target, out-of-bounds timing, or the new track
   * would exceed MAX_TRACKS. Selection refs follow the moved clips.
   */
  moveClips: (
    outputIndex: number,
    moves: { trackId: string; clipId: string; toTrackId: string | null; startMs: number; endMs: number }[],
    opts?: { newTrackType?: VideoTrack['type'] }
  ) => boolean;
  updateClip: (outputIndex: number, trackId: string, clipId: string, updates: Partial<VideoClip>) => void;
  // Same as updateClip but does NOT commit history — for continuous controls
  // (slider/drag), which push a single history entry on release instead, the
  // same discipline `updateElementsSilent` gives element sliders.
  // Returns whether the write landed.
  updateClipSilent: (outputIndex: number, trackId: string, clipId: string, updates: Partial<VideoClip>) => boolean;
  setVideoDuration: (outputIndex: number, durationMs: number) => void;
  splitClip: (outputIndex: number, trackId: string, clipId: string, atMs: number) => void;
  setMode: (mode: 'image' | 'video') => void;
  setPlayhead: (ms: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setSelectedClip: (clip: { outputIndex: number; trackId: string; clipId: string } | null) => void;
  /**
   * Replace the multi-selection. Keeps the primary (`selectedClip`) a member:
   * a primary outside the new set is moved to its first entry (or null).
   */
  setSelectedClips: (
    clips: { trackId: string; clipId: string }[],
    primary?: { trackId: string; clipId: string }
  ) => void;
  /** Shift-click: add/remove one clip or its group, making an added clip the primary. */
  toggleClipSelection: (trackId: string, clipId: string) => void;
  setTrackGain: (outputIndex: number, trackId: string, gain: number, commit?: boolean) => void;
  setTrackAutoDuck: (outputIndex: number, trackId: string, autoDuck: boolean) => void;
  /** Rename a track (empty/whitespace clears the custom name back to the type label). */
  renameTrack: (outputIndex: number, trackId: string, name: string) => void;
  /** Muted audio tracks contribute nothing to preview or export. */
  setTrackMuted: (outputIndex: number, trackId: string, muted: boolean) => void;
  /** Locked tracks refuse clip edits (drag/trim/split/delete skip their clips). */
  setTrackLocked: (outputIndex: number, trackId: string, locked: boolean) => void;
  /** Hidden tracks are excluded from the preview AND the export renderers. */
  setTrackHidden: (outputIndex: number, trackId: string, hidden: boolean) => void;
  /** Add a marker at `tMs` on the output's ruler. Returns the new marker id. */
  addMarker: (outputIndex: number, tMs: number, name?: string) => string | null;
  /** Rename a marker (empty/whitespace clears the custom name). */
  renameMarker: (outputIndex: number, markerId: string, name: string) => void;
  removeMarker: (outputIndex: number, markerId: string) => void;
  /**
   * Copy a clip onto the same track right after the source clip (extending the
   * output duration when it would overflow, like an insert). Returns the new
   * clip id, or null when there is no room even after extension.
   */
  duplicateClip: (outputIndex: number, trackId: string, clipId: string) => string | null;
  /**
   * Remove the clip and pull every later clip on the SAME track left by the
   * removed clip's effective duration (freeze extension included), clamped at
   * t=0. One history entry; other tracks are untouched.
   */
  rippleDeleteClip: (outputIndex: number, trackId: string, clipId: string) => void;
  /**
   * Multi-clip variants of removeClip/rippleDeleteClip — the timeline's Delete
   * and Shift+Delete act on the whole multi-selection as ONE history step.
   * Refs that don't resolve to a clip are ignored.
   */
  removeClips: (outputIndex: number, refs: { trackId: string; clipId: string }[]) => void;
  rippleDeleteClips: (outputIndex: number, refs: { trackId: string; clipId: string }[]) => void;
  /** Deep-clone the multi-selection (primary when it stands alone) into the clip clipboard. */
  copySelectedClips: () => void;
  /**
   * Paste the clip clipboard with the group's earliest clip landing at `atMs`
   * (the playhead), onto the original tracks — falling back to the first track
   * of the same type, created when none exists. Fresh ids, the output duration
   * extends like duplicateClip (MAX_VIDEO_DURATION_MS ceiling; clips that still
   * overflow are skipped). One history entry; the pasted clips become the selection.
   */
  pasteClips: (atMs: number) => void;
  /** Deep-clone one clip's keyframes into the keyframe clipboard. No history entry — a copy is not an edit. */
  copyClipKeyframes: (outputIndex: number, trackId: string, clipId: string) => void;
  /**
   * Merge the keyframe clipboard onto the SELECTED clip (merge-by-prop: a
   * keyframe within 1ms of an existing one overwrites the props it carries,
   * anything else is added). Clip-relative tMs is preserved, so the motion
   * lands at the same offset into the target clip; passing `atMs` instead
   * shifts the batch so its earliest keyframe lands there. One history entry.
   */
  pasteClipKeyframes: (atMs?: number) => void;
}

export type DesignerStore = DesignerState & DesignerActions;

const createEmptyDoc = (width = 1080, height = 1080, attribution?: DesignerAttribution, mode: 'image' | 'video' = 'image'): DesignerDoc => {
  const m = matchPreset(width, height);
  if (mode === 'video') {
    const trackId = genId();
    const preset = CHANNEL_PRESETS.find((p) => p.id === m.formatId);
    return {
      version: DESIGNER_DOC_VERSION,
      mode: 'video',
      outputs: [{
        id: genId(),
        formatId: m.formatId,
        name: m.name,
        width,
        height,
        fps: preset?.fps ?? 30,
        // The preset's maxDurationMs is a hard cap, not a default — new
        // timelines start at 10 s, lowered only when the cap is tighter.
        durationMs: Math.min(preset?.maxDurationMs ?? 10000, 10000),
        tracks: [{ id: trackId, type: 'video', clips: [] }],
      }],
      attribution,
    };
  }
  return {
    version: DESIGNER_DOC_VERSION,
    mode: 'image',
    outputs: [{ id: genId(), formatId: m.formatId, name: m.name, width, height, background: '#ffffff', children: [] }],
    attribution,
  };
};

const sharedUpdates = (updates: Partial<DesignerElement>): Partial<DesignerElement> => {
  const out: any = {};
  for (const k of Object.keys(updates)) if (!GEOMETRY_KEYS.has(k)) out[k] = (updates as any)[k];
  return out;
};

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export const createDesignerStore = (
  width?: number,
  height?: number,
  attribution?: DesignerAttribution,
  fetch?: FetchLike,
) =>
  create<DesignerStore>((set, get) => {
    const initialDoc = createEmptyDoc(width, height, attribution);
    const active = () => get().doc.outputs[get().currentOutput] as DesignerOutput | VideoOutput;
    const activeImage = () => get().doc.outputs[get().currentOutput] as DesignerOutput;
    const isVideoMode = () => get().doc.mode === 'video';
    /** Children of the ACTIVE PAGE — page-aware read counterpart of withActiveChildren. */
    const activePageChildren = () =>
      pageChildren(activeImage(), get().currentPage);
    const withActiveChildren = (children: DesignerElement[]) => {
      const { doc, currentOutput, currentPage } = get();
      const outs = [...doc.outputs];
      const out = outs[currentOutput] as DesignerOutput;
      outs[currentOutput] = withPageChildren(out, currentPage, children);
      return outs;
    };
    /**
     * Clamp a page index against an output of an arbitrary doc (undo/redo and
     * output removal both restore docs whose page counts may have shrunk).
     */
    const clampPage = (doc: DesignerDoc, outputIndex: number, page: number) => {
      const out = doc.outputs[outputIndex] as DesignerOutput | undefined;
      const max = out && 'children' in out ? pageCount(out) - 1 : 0;
      return Math.max(0, Math.min(page, max));
    };
    /**
     * Async focal-point attach for a freshly inserted image. `pageIndex` is
     * recorded AT INSERT TIME — detection resolves later, and the user may
     * have switched pages by then; the write must still land on the page the
     * element was inserted on. `copyIds` (page-1 inserts only) propagates the
     * focal point to the linked copies seeded on the other outputs.
     */
    const attachFocalPoint = (
      id: string,
      src: string,
      pageIndex: number,
      copyIds?: Map<number, string>
    ) => {
      detectFocalPoint(src, fetch).then((fp) => {
        const state = get();
        const source = state.doc.outputs[state.currentOutput] as DesignerOutput | undefined;
        if (!source || !('children' in source)) return;
        // Stale guard: the element must still be on its page with the same src.
        const sourceEl = pageChildren(source, pageIndex).find((c) => c.id === id);
        if (!sourceEl || sourceEl.src !== src) return;
        if (pageIndex > 0 || !copyIds) {
          // Page-2+ inserts exist on their page only — no linked copies.
          const outs = [...state.doc.outputs];
          outs[state.currentOutput] = withPageChildren(
            source,
            pageIndex,
            pageChildren(source, pageIndex).map((c) =>
              c.id === id ? { ...c, focalPoint: fp } : c
            )
          );
          set({ doc: { ...state.doc, outputs: outs }, isDirty: true });
          return;
        }
        const nextOutputs = state.doc.outputs.map((out, i) => {
          const target = out as DesignerOutput;
          const targetId = i === state.currentOutput ? id : copyIds.get(i);
          if (!targetId) return out;
          return {
            ...out,
            children: target.children.map((c) =>
              c.id === targetId ? { ...c, focalPoint: fp } : c
            ),
          };
        });
        set({ doc: { ...state.doc, outputs: nextOutputs }, isDirty: true });
      }).catch(() => {
        // Non-fatal: center fallback is already in place.
      });
    };
    return {
      doc: initialDoc,
      selectedIds: [],
      renamingId: null,
      currentOutput: 0,
      currentPage: 0,
      zoom: 1, viewportX: 0, viewportY: 0,
      history: [JSON.parse(JSON.stringify(initialDoc))], historyIndex: 0, historyLabels: ['Open'],
      savedHistoryIndex: 0,
      designId: null, designTemplateId: null, templateId: null,
      designName: 'Untitled Design',
      isDirty: false, isSaving: false, lastSaved: null,
      saveFailed: false, saveRetryPaused: false,
      editFormatOnly: false,
      brandEnforcement: false,
      brandAdminOverride: false,
      playheadMs: 0,
      isPlaying: false,
      selectedClip: null,
      selectedClips: [],
      clipClipboard: [],
      keyframeClipboard: null,
      linkedUpdateFlash: {},
      snapEnabled: true,
      timelineSnap: true,
      timelineHeight: 240,
      showGrid: false,
      gridSize: 50,
      snapToGrid: false,
      fitNonce: 0,
      activeTool: DEFAULT_TOOL_ID,
      lastToolPerGroup: {},
      toolOptions: {},
      selection: null,
      lastSelection: null,
      generateRequest: null,
      maskTargetId: null,
      clipboard: [],
      setDoc: (doc) => set({ doc: migrateDoc(doc), isDirty: true }),
      setCharacterReferences: (references) => {
        const { doc } = get();
        if (doc.mode !== 'video') return;
        const nextReferences = references?.length
          ? references.slice(0, 3).map((reference) => ({
              fileId: reference.fileId,
              src: reference.src,
              ...(reference.name?.trim() ? { name: reference.name.trim().slice(0, 200) } : {}),
            }))
          : undefined;
        if (JSON.stringify(doc.characterReferences ?? []) === JSON.stringify(nextReferences ?? [])) return;
        const nextDoc = { ...doc };
        if (nextReferences) nextDoc.characterReferences = nextReferences;
        else delete nextDoc.characterReferences;
        set({ doc: nextDoc, isDirty: true });
        get().pushHistory('Edit character references');
      },
      setDesignName: (name) => set({ designName: name, isDirty: true }),
      setDesignId: (id) => set({ designId: id }),
      setTemplateId: (id) => set({ templateId: id }),

      addElement: (element, beforeId) => {
        if (isVideoMode()) return;
        const { doc, currentOutput, currentPage } = get();
        const originId = element.originId || genId();
        const baseEl = { ...element, id: element.id || genId(), originId };
        const sourceOutput = doc.outputs[currentOutput] as DesignerOutput;
        const sourceChildren = pageChildren(sourceOutput, currentPage);
        const beforeOriginId = beforeId
          ? sourceChildren.find((c) => c.id === beforeId)?.originId
          : undefined;
        const insert = (children: DesignerElement[], el: DesignerElement) => {
          if (!beforeId) return [...children, el];
          const idx = children.findIndex(
            (c) => c.id === beforeId || (beforeOriginId && c.originId === beforeOriginId)
          );
          if (idx === -1) return [...children, el];
          const next = [...children];
          next.splice(idx, 0, el);
          return next;
        };
        // Linked (originId) seeding across outputs is a PAGE-1 behavior: an
        // element added on a later page exists on that page only.
        if (currentPage > 0) {
          set({
            doc: {
              ...doc,
              outputs: withActiveChildren(insert(sourceChildren, baseEl)),
            },
            isDirty: true,
            selectedIds: [baseEl.id],
          });
          get().pushHistory();
          if (baseEl.type === 'image' && baseEl.src) {
            attachFocalPoint(baseEl.id, baseEl.src, currentPage);
          }
          return;
        }
        const copyIds = new Map<number, string>();
        const outs = doc.outputs.map((out, i) =>
          i === currentOutput
            ? { ...out, children: insert((out as DesignerOutput).children, baseEl) }
            : (() => {
                const copy = seedCopy(baseEl, sourceOutput, out as DesignerOutput, originId);
                copyIds.set(i, copy.id);
                return { ...out, children: insert((out as DesignerOutput).children, copy) };
              })()
        );
        set({ doc: { ...doc, outputs: outs }, isDirty: true, selectedIds: [baseEl.id] });
        get().pushHistory();

        if (baseEl.type === 'image' && baseEl.src) {
          attachFocalPoint(baseEl.id, baseEl.src, 0, copyIds);
        }
      },

      updateElement: (id, updates) => {
        if (isVideoMode()) return;
        const { doc, currentOutput, currentPage, editFormatOnly, linkedUpdateFlash } = get();
        if (currentPage > 0) {
          // Per-page edits stay local — linked propagation is page-1-only.
          set({
            doc: {
              ...doc,
              outputs: withActiveChildren(
                activePageChildren().map((el) => (el.id === id ? applyElementPatch(el, updates) : el))
              ),
            },
            isDirty: true,
          });
          return;
        }
        const { outputs, affected } = applyLinked(doc, currentOutput, new Set([id]), updates, editFormatOnly);
        const now = Date.now();
        const nextFlash: Record<number, number> = { ...linkedUpdateFlash };
        affected.forEach((i) => (nextFlash[i] = now));
        set({ doc: { ...doc, outputs }, isDirty: true, linkedUpdateFlash: nextFlash });
      },

      updateElements: (ids, updates) => {
        if (isVideoMode()) return;
        const { doc, currentOutput, currentPage, editFormatOnly, linkedUpdateFlash } = get();
        if (currentPage > 0) {
          const idSet = new Set(ids);
          set({
            doc: {
              ...doc,
              outputs: withActiveChildren(
                activePageChildren().map((el) => (idSet.has(el.id) ? applyElementPatch(el, updates) : el))
              ),
            },
            isDirty: true,
          });
          get().pushHistory();
          return;
        }
        const { outputs, affected } = applyLinked(doc, currentOutput, new Set(ids), updates, editFormatOnly);
        const now = Date.now();
        const nextFlash: Record<number, number> = { ...linkedUpdateFlash };
        affected.forEach((i) => (nextFlash[i] = now));
        set({ doc: { ...doc, outputs }, isDirty: true, linkedUpdateFlash: nextFlash });
        get().pushHistory();
      },

      updateElementsSilent: (ids, updates) => {
        if (isVideoMode()) return;
        const { doc, currentOutput, currentPage, editFormatOnly, linkedUpdateFlash } = get();
        if (currentPage > 0) {
          const idSet = new Set(ids);
          set({
            doc: {
              ...doc,
              outputs: withActiveChildren(
                activePageChildren().map((el) => (idSet.has(el.id) ? applyElementPatch(el, updates) : el))
              ),
            },
            isDirty: true,
          });
          return;
        }
        const { outputs, affected } = applyLinked(doc, currentOutput, new Set(ids), updates, editFormatOnly);
        const now = Date.now();
        const nextFlash: Record<number, number> = { ...linkedUpdateFlash };
        affected.forEach((i) => (nextFlash[i] = now));
        set({ doc: { ...doc, outputs }, isDirty: true, linkedUpdateFlash: nextFlash });
      },

      updateElementEphemeral: (id, updates) => {
        if (isVideoMode()) return;
        const { doc, currentOutput, currentPage } = get();
        const out = doc.outputs[currentOutput] as DesignerOutput | undefined;
        if (!out || !('children' in out)) return;
        const outs = [...doc.outputs];
        outs[currentOutput] = withPageChildren(
          out,
          currentPage,
          pageChildren(out, currentPage).map((el) => (el.id === id ? applyElementPatch(el, updates) : el))
        );
        set({ doc: { ...doc, outputs: outs }, isDirty: true });
      },

      removeElement: (id) => {
        if (isVideoMode()) return;
        const { selectedIds } = get();
        set({
          doc: { ...get().doc, outputs: withActiveChildren(activePageChildren().filter((el) => el.id !== id)) },
          isDirty: true, selectedIds: selectedIds.filter((s) => s !== id),
        });
        get().pushHistory();
        disposeElementBuffers(id);
      },

      removeElements: (ids) => {
        if (isVideoMode()) return;
        if (!ids.length) return;
        const remove = new Set(ids);
        const { selectedIds } = get();
        set({
          doc: { ...get().doc, outputs: withActiveChildren(activePageChildren().filter((el) => !remove.has(el.id))) },
          isDirty: true, selectedIds: selectedIds.filter((s) => !remove.has(s)),
        });
        get().pushHistory();
        ids.forEach(disposeElementBuffers);
      },

      duplicateElement: (id) => {
        if (isVideoMode()) return;
        const children = activePageChildren();
        const el = children.find((e) => e.id === id);
        if (!el) return;

        // Duplicating a group takes its contents with it.
        const subtree = el.type === 'group' ? descendantIds(children, id) : [];
        const sourceIds = [id, ...subtree];
        const idMap = new Map(sourceIds.map((sid) => [sid, genId()]));
        const groupRemap: Record<string, string> = {};

        const copies = children
          .filter((c) => idMap.has(c.id))
          .map((c) => {
            const clone = JSON.parse(JSON.stringify(c)) as DesignerElement;
            // Remap groupId rather than copying it verbatim — the old code
            // silently joined every duplicate to the ORIGINAL's reflow group.
            if (clone.groupId) {
              groupRemap[clone.groupId] = groupRemap[clone.groupId] || genId();
              clone.groupId = groupRemap[clone.groupId];
            }
            return {
              ...clone,
              id: idMap.get(c.id) as string,
              originId: genId(),
              // Re-point at the copied parent when it came along; otherwise
              // keep the original parent so a duplicate stays in its folder.
              parentId: clone.parentId && idMap.has(clone.parentId)
                ? idMap.get(clone.parentId)
                : clone.parentId,
              x: c.x + 20,
              y: c.y + 20,
            };
          });

        set({
          doc: { ...get().doc, outputs: withActiveChildren([...children, ...copies]) },
          isDirty: true,
          selectedIds: [idMap.get(id) as string],
        });
        get().pushHistory();
      },

      setSelectedIds: (ids) => set({ selectedIds: ids }),
      requestRename: (id) => set({ renamingId: id }),

      setOutputBackground: (bg, commit = true) => {
        if (isVideoMode()) return;
        const { doc, currentOutput } = get();
        const outs = [...doc.outputs];
        const out = outs[currentOutput] as DesignerOutput;
        outs[currentOutput] = {
          ...out,
          background: bg.type === 'color' && bg.color ? bg.color : out.background,
          bg,
        };
        set({ doc: { ...doc, outputs: outs }, isDirty: true });
        if (commit) get().pushHistory();
      },

      copySelection: () => {
        if (isVideoMode()) return;
        const { selectedIds } = get();
        set({ clipboard: JSON.parse(JSON.stringify(activePageChildren().filter((el) => selectedIds.includes(el.id)))) });
      },

      cutSelection: () => {
        if (isVideoMode()) return;
        const { selectedIds } = get();
        const picked = activePageChildren().filter((el) => selectedIds.includes(el.id));
        if (!picked.length) return;
        set({
          clipboard: JSON.parse(JSON.stringify(picked)),
          doc: { ...get().doc, outputs: withActiveChildren(activePageChildren().filter((el) => !selectedIds.includes(el.id))) },
          selectedIds: [], isDirty: true,
        });
        get().pushHistory();
        selectedIds.forEach(disposeElementBuffers);
      },

      paste: () => {
        if (isVideoMode()) return;
        const { clipboard } = get();
        if (!clipboard.length) return;
        const groupRemap: Record<string, string> = {};
        const pasted = clipboard.map((el) => {
          let groupId = el.groupId;
          if (groupId) { groupRemap[groupId] = groupRemap[groupId] || genId(); groupId = groupRemap[groupId]; }
          return { ...el, id: genId(), originId: genId(), x: el.x + 20, y: el.y + 20, groupId };
        });
        set({ doc: { ...get().doc, outputs: withActiveChildren([...activePageChildren(), ...pasted]) }, selectedIds: pasted.map((el) => el.id), isDirty: true });
        get().pushHistory();
      },

      /**
       * Create a real layer group: a `group` element plus `parentId` on each
       * member.
       *
       * `groupId` is set too — deliberately. It is a DIFFERENT concept (the
       * cross-format reflow move-unit), and a Photoshop folder should also
       * travel as one when the design is re-fitted to another format.
       */
      createSymbol: (name) => {
        const { doc, currentOutput, currentPage, selectedIds } = get();
        const out = doc.outputs[currentOutput] as DesignerOutput;
        if (!('children' in out) || selectedIds.length === 0) return;

        const pageEls = pageChildren(out, currentPage);
        const members = pageEls.filter((c) => selectedIds.includes(c.id));
        if (!members.length) return;

        // The definition is authored in its own coordinate space, so an
        // instance can be moved and resized without touching it.
        const minX = Math.min(...members.map((m) => m.x));
        const minY = Math.min(...members.map((m) => m.y));
        const maxX = Math.max(...members.map((m) => m.x + m.width));
        const maxY = Math.max(...members.map((m) => m.y + m.height));

        const symbolId = `sym-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
        const definition = {
          id: symbolId,
          name: name || 'Symbol',
          width: Math.max(1, maxX - minX),
          height: Math.max(1, maxY - minY),
          children: members.map((m) => ({
            ...JSON.parse(JSON.stringify(m)),
            x: m.x - minX,
            y: m.y - minY,
            parentId: undefined,
          })),
        };

        const instance: DesignerElement = {
          id: `inst-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
          type: 'symbol',
          symbolId,
          name: definition.name,
          x: minX,
          y: minY,
          width: definition.width,
          height: definition.height,
          rotation: 0,
          opacity: 1,
          locked: false,
          hidden: false,
        };

        const outputs = doc.outputs.map((o, i) =>
          i === currentOutput
            ? withPageChildren(o as DesignerOutput, currentPage, [
                ...pageChildren(o as DesignerOutput, currentPage).filter((c) => !selectedIds.includes(c.id)),
                instance,
              ])
            : o
        );
        set({
          doc: { ...doc, outputs, symbols: [...(doc.symbols || []), definition] },
          selectedIds: [instance.id],
          isDirty: true,
        });
        get().pushHistory('Create symbol');
      },

      placeSymbol: (symbolId) => {
        const { doc, currentOutput } = get();
        const definition = (doc.symbols || []).find((s) => s.id === symbolId);
        const out = doc.outputs[currentOutput] as DesignerOutput;
        if (!definition || !('children' in out)) return;

        const instance: DesignerElement = {
          id: `inst-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
          type: 'symbol',
          symbolId,
          name: definition.name,
          // Centred, like every other insert.
          x: Math.round((out.width - definition.width) / 2),
          y: Math.round((out.height - definition.height) / 2),
          width: definition.width,
          height: definition.height,
          rotation: 0,
          opacity: 1,
          locked: false,
          hidden: false,
        };
        get().addElement(instance);
      },

      updateSymbolDefinition: (symbolId, children) => {
        const { doc } = get();
        if (!(doc.symbols || []).some((s) => s.id === symbolId)) return;
        set({
          doc: {
            ...doc,
            symbols: (doc.symbols || []).map((s) =>
              s.id === symbolId ? { ...s, children } : s
            ),
          },
          isDirty: true,
        });
        get().pushHistory('Edit symbol');
      },

      groupSelection: (ids) => {
        if (isVideoMode()) {
          const { doc, currentOutput, selectedClips } = get();
          const vo = doc.outputs[currentOutput] as VideoOutput | undefined;
          if (!vo || !selectedClips.length) return;
          const selected = new Set(
            expandClipRefs(vo, selectedClips).map((ref) => `${ref.trackId}:${ref.clipId}`)
          );
          const groupId = genId();
          const outs = [...doc.outputs];
          outs[currentOutput] = {
            ...vo,
            tracks: vo.tracks.map((track) => ({
              ...track,
              clips: track.clips.map((clip) =>
                selected.has(`${track.id}:${clip.id}`) ? { ...clip, groupId } : clip
              ),
            })),
          };
          set({ doc: { ...doc, outputs: outs }, isDirty: true });
          get().pushHistory('Group clips');
          return;
        }
        // Explicit ids let a caller (the canvas context menu) group without a
        // selection round-trip; the default is the live selection.
        const selectedIds = ids ?? get().selectedIds;
        // One layer is groupable — Photoshop's Layer ▸ Group Layers wraps a
        // single selection too. Only New ▸ Group from Layers is plural-only.
        if (selectedIds.length < 1) return;

        const children = activePageChildren();
        const gid = genId();
        const groupEl: DesignerElement = {
          id: genId(),
          type: 'group',
          name: 'Group',
          // A group's box is derived from its members; it has none of its own.
          x: 0, y: 0, width: 0, height: 0,
          rotation: 0, opacity: 1, locked: false, hidden: false,
        };

        // Insert the container just below the lowest member so z-order holds.
        const firstIndex = children.findIndex((el) => selectedIds.includes(el.id));
        const next = children.map((el) =>
          selectedIds.includes(el.id)
            ? { ...el, parentId: groupEl.id, groupId: gid }
            : el
        );
        next.splice(Math.max(0, firstIndex), 0, groupEl);

        set({
          doc: { ...get().doc, outputs: withActiveChildren(next) },
          isDirty: true,
          selectedIds: [groupEl.id],
        });
        get().pushHistory();
      },

      /** Dissolve the selected groups, promoting members to the group's level. */
      ungroupSelection: (ids) => {
        if (isVideoMode()) {
          const { doc, currentOutput, selectedClips } = get();
          const vo = doc.outputs[currentOutput] as VideoOutput | undefined;
          if (!vo || !selectedClips.length) return;
          const groupIds = new Set(
            selectedClips.flatMap((ref) => {
              const clip = vo.tracks
                .find((track) => track.id === ref.trackId)
                ?.clips.find((item) => item.id === ref.clipId);
              return clip?.groupId ? [clip.groupId] : [];
            })
          );
          if (!groupIds.size) return;
          const outs = [...doc.outputs];
          outs[currentOutput] = {
            ...vo,
            tracks: vo.tracks.map((track) => ({
              ...track,
              clips: track.clips.map((clip) =>
                clip.groupId && groupIds.has(clip.groupId)
                  ? { ...clip, groupId: undefined }
                  : clip
              ),
            })),
          };
          set({ doc: { ...doc, outputs: outs }, isDirty: true });
          get().pushHistory('Ungroup clips');
          return;
        }
        const selectedIds = ids ?? get().selectedIds;
        const children = activePageChildren();

        // Accept either the group itself or any member being selected.
        const targets = new Set<string>();
        for (const el of children) {
          if (!selectedIds.includes(el.id)) continue;
          if (el.type === 'group') targets.add(el.id);
          else if (el.parentId) targets.add(el.parentId);
        }
        if (!targets.size) return;

        const parentOfGroup = new Map<string, string | undefined>();
        for (const el of children) {
          if (targets.has(el.id)) parentOfGroup.set(el.id, el.parentId);
        }

        const next = children
          // Drop the group containers themselves.
          .filter((el) => !(el.type === 'group' && targets.has(el.id)))
          .map((el) =>
            el.parentId && targets.has(el.parentId)
              // Promote to whatever the group's own parent was, so ungrouping
              // an inner group leaves its members in the outer one.
              ? { ...el, parentId: parentOfGroup.get(el.parentId), groupId: undefined }
              : el
          );

        set({ doc: { ...get().doc, outputs: withActiveChildren(next) }, isDirty: true });
        get().pushHistory();
      },

      moveLayersTo: (ids, targetIndex, parentId) => {
        if (isVideoMode()) return;
        const next = moveLayers(activePageChildren(), ids, targetIndex, parentId);
        if (next === activePageChildren()) return;
        set({ doc: { ...get().doc, outputs: withActiveChildren(next) }, isDirty: true });
        get().pushHistory();
      },

      addLayer: (kind, init) => {
        if (isVideoMode()) return;
        const out = activeImage();
        const el: DesignerElement = {
          id: '',
          type: kind,
          name:
            kind === 'group' ? 'Group'
            : kind === 'fill' ? 'Fill'
            : 'Adjustment',
          x: 0,
          y: 0,
          // Fill and adjustment layers cover the whole artboard by default,
          // like Photoshop's. A group derives its box from its members.
          width: kind === 'group' ? 0 : out.width,
          height: kind === 'group' ? 0 : out.height,
          rotation: 0,
          opacity: 1,
          locked: false,
          hidden: false,
          ...init,
        };
        get().addElement(el);
      },

      toggleClipped: (ids) => {
        if (isVideoMode() || !ids.length) return;
        const children = activePageChildren();
        const allClipped = children
          .filter((el) => ids.includes(el.id))
          .every((el) => el.clipped);
        set({ doc: { ...get().doc, outputs: withActiveChildren(
          children.map((el) => (ids.includes(el.id) ? { ...el, clipped: !allClipped } : el))
        ) }, isDirty: true });
        get().pushHistory();
      },

      setLayerBlend: (ids, blendMode) => {
        if (isVideoMode() || !ids.length) return;
        set({ doc: { ...get().doc, outputs: withActiveChildren(
          activePageChildren().map((el) => (ids.includes(el.id) ? { ...el, blendMode } : el))
        ) }, isDirty: true });
        get().pushHistory();
      },

      toggleGroupCollapsed: (id) => {
        if (isVideoMode()) return;
        // Panel-only state, so no history entry — collapsing a folder is not an
        // edit anyone wants to undo.
        set({ doc: { ...get().doc, outputs: withActiveChildren(
          activePageChildren().map((el) => (el.id === id ? { ...el, collapsed: !el.collapsed } : el))
        ) } });
      },

      reorder: (ids, dir) => {
        if (isVideoMode()) return;
        const children = [...activePageChildren()];
        const picked = children.filter((el) => ids.includes(el.id));
        if (!picked.length) return;
        const rest = children.filter((el) => !ids.includes(el.id));
        let next: DesignerElement[];
        if (dir === 'front') next = [...rest, ...picked];
        else if (dir === 'back') next = [...picked, ...rest];
        else {
          next = [...children];
          const indices = ids.map((id) => next.findIndex((el) => el.id === id)).filter((i) => i >= 0).sort((a, b) => (dir === 'forward' ? b - a : a - b));
          indices.forEach((i) => { const swap = dir === 'forward' ? i + 1 : i - 1; if (swap < 0 || swap >= next.length) return; [next[i], next[swap]] = [next[swap], next[i]]; });
        }
        set({ doc: { ...get().doc, outputs: withActiveChildren(next) }, isDirty: true });
        get().pushHistory();
      },

      setCurrentOutput: (index) => {
        const { doc } = get();
        if (index < 0 || index >= doc.outputs.length) return;
        // Pages belong to an output; switching outputs always lands on page 1.
        set({ currentOutput: index, currentPage: 0, selectedIds: [] });
      },

      setCurrentPage: (pageNumber) => {
        const { doc, currentOutput } = get();
        if (doc.mode !== 'image') return;
        const out = doc.outputs[currentOutput] as DesignerOutput | undefined;
        if (!out || !('children' in out)) return;
        if (pageNumber < 0 || pageNumber >= pageCount(out)) return;
        set({ currentPage: pageNumber, selectedIds: [] });
      },

      addPage: (name) => {
        if (isVideoMode()) return;
        const { doc, currentOutput } = get();
        const out = doc.outputs[currentOutput] as DesignerOutput;
        const next = appendPage(out, { id: genId(), name, children: [] });
        // appendPage returns null at MAX_PAGES_PER_OUTPUT.
        if (!next) return;
        const outs = [...doc.outputs];
        outs[currentOutput] = next;
        set({
          doc: { ...doc, outputs: outs },
          currentPage: pageCount(next) - 1,
          selectedIds: [],
          isDirty: true,
        });
        get().pushHistory('Add page');
      },

      duplicatePage: (pageNumber) => {
        if (isVideoMode()) return;
        const { doc, currentOutput } = get();
        const out = doc.outputs[currentOutput] as DesignerOutput;
        const next = duplicatePageAt(out, pageNumber);
        if (!next) return;
        const outs = [...doc.outputs];
        outs[currentOutput] = next;
        set({
          doc: { ...doc, outputs: outs },
          currentPage: pageNumber + 1,
          selectedIds: [],
          isDirty: true,
        });
        get().pushHistory('Duplicate page');
      },

      removePage: (pageNumber) => {
        if (isVideoMode()) return;
        const { doc, currentOutput, currentPage } = get();
        const out = doc.outputs[currentOutput] as DesignerOutput;
        const next = removePageAt(out, pageNumber);
        // removePageAt refuses page 1 — it IS the output.
        if (!next) return;
        const outs = [...doc.outputs];
        outs[currentOutput] = next;
        set({
          doc: { ...doc, outputs: outs },
          currentPage: Math.max(0, Math.min(currentPage, pageCount(next) - 1)),
          selectedIds: [],
          isDirty: true,
        });
        get().pushHistory('Delete page');
      },

      renamePage: (pageNumber, name) => {
        if (isVideoMode()) return;
        const { doc, currentOutput } = get();
        const out = doc.outputs[currentOutput] as DesignerOutput;
        // Page 1's name slot is the output's own name — it already has a
        // rename flow (output-tabs), so only extras are renamed here.
        if (pageNumber <= 0 || !out.pages?.[pageNumber - 1]) return;
        const trimmed = name.trim();
        const outs = [...doc.outputs];
        outs[currentOutput] = {
          ...out,
          pages: out.pages.map((p, i) =>
            i === pageNumber - 1 ? { ...p, name: trimmed || undefined } : p
          ),
        };
        set({ doc: { ...doc, outputs: outs }, isDirty: true });
        get().pushHistory('Rename page');
      },

      reorderPage: (from, to) => {
        if (isVideoMode()) return;
        const { doc, currentOutput, currentPage } = get();
        const out = doc.outputs[currentOutput] as DesignerOutput;
        const next = movePage(out, from, to);
        if (!next) return;
        const outs = [...doc.outputs];
        outs[currentOutput] = next;
        set({
          doc: { ...doc, outputs: outs },
          currentPage: currentPage === from ? to : currentPage,
          selectedIds: [],
          isDirty: true,
        });
        get().pushHistory('Reorder pages');
      },

      addOutput: (preset) => {
        const { doc, currentOutput } = get();
        if (isVideoMode()) {
          // Video variant: clone the CURRENT output's tracks/clips with fresh
          // ids (originId shared, backfilled on the source) and smart-reflow
          // the geometry onto the new canvas. Timing/fps/durationMs copy
          // unchanged — see designer-doc/video-reflow.
          const source = doc.outputs[currentOutput] as VideoOutput;
          if (!source || !('tracks' in source)) return;
          const { output, sourceTracks } = seedVideoOutput(source, preset);
          const outs = doc.outputs.map((o, i) =>
            i === currentOutput ? { ...(o as VideoOutput), tracks: sourceTracks } : o
          );
          outs.push(output);
          set({
            doc: { ...doc, outputs: outs },
            currentOutput: outs.length - 1,
            currentPage: 0,
            selectedIds: [],
            selectedClip: null,
            selectedClips: [],
            isDirty: true,
          });
          get().pushHistory('Add format');
          return;
        }
        const source = doc.outputs[currentOutput] as DesignerOutput;
        const sourceChildren = source.children.map((el) => (el.originId ? el : { ...el, originId: genId() }));
        const targetBasis = { ...preset, id: '', background: '#fff', children: [] } as DesignerOutput;
        const groupBoxes = computeGroupBoxes(sourceChildren);
        const children = sourceChildren.map((el) =>
          seedCopy(el, source, targetBasis, el.originId as string, el.groupId ? groupBoxes.get(el.groupId) : undefined),
        );
        // Pages 2+ come along too: fresh element ids AND fresh originIds —
        // per-page edits are deliberately local (duplicatePageAt semantics,
        // designer-doc.pages.ts) — each child reflowed onto the new canvas.
        const pages = source.pages?.map((page) => {
          const pageBoxes = computeGroupBoxes(page.children);
          return {
            ...page,
            id: genId(),
            children: page.children.map((el) =>
              seedCopy(el, source, targetBasis, genId(), el.groupId ? pageBoxes.get(el.groupId) : undefined)),
          };
        });
        const newOutput: DesignerOutput = {
          id: genId(), formatId: preset.formatId, name: preset.name,
          width: preset.width, height: preset.height,
          background: source.background, bg: source.bg, children,
          ...(pages?.length ? { pages } : {}),
        };
        const outs = doc.outputs.map((o, i) => (i === currentOutput ? { ...o, children: sourceChildren } : o)) as DesignerOutput[];
        outs.push(newOutput);
        set({ doc: { ...doc, outputs: outs }, currentOutput: outs.length - 1, selectedIds: [], isDirty: true });
        get().pushHistory();
      },

      removeOutput: (index) => {
        const { doc, currentOutput } = get();
        if (doc.outputs.length <= 1) return;
        const outs = doc.outputs.filter((_, i) => i !== index);
        const nextOutput = Math.max(0, Math.min(currentOutput, outs.length - 1));
        set({
          doc: { ...doc, outputs: outs },
          currentOutput: nextOutput,
          currentPage: clampPage({ ...doc, outputs: outs } as DesignerDoc, nextOutput, get().currentPage),
          selectedIds: [],
          isDirty: true,
        });
        get().pushHistory();
      },

      resizeOutput: (index, width, height, formatId, name) => {
        const { doc } = get();
        const out = doc.outputs[index];
        if (!out) return;
        if ('tracks' in out) {
          // Video outputs resize in place: ids stay, every clip's geometry
          // smart-reflows onto the new canvas (timing/fps/duration untouched).
          const resized = reflowVideoOutputInPlace(out as VideoOutput, width, height, formatId, name);
          const outs = [...doc.outputs]; outs[index] = resized;
          set({ doc: { ...doc, outputs: outs }, isDirty: true });
          get().pushHistory('Resize format');
          return;
        }
        if (isVideoMode()) return;
        const imgOut = out as DesignerOutput;
        const resized: DesignerOutput = { ...imgOut, width, height, formatId: formatId ?? imgOut.formatId, name: name ?? imgOut.name };
        const groupBoxes = computeGroupBoxes(imgOut.children);
        resized.children = imgOut.children.map((el) => seedCopy(el, imgOut, resized, el.originId || el.id, el.groupId ? groupBoxes.get(el.groupId) : undefined));
        // Pages 2+ carry elements in the OLD canvas coordinates — reflow them
        // too, or a resize leaves every extra page laid out for the old size.
        resized.pages = imgOut.pages?.map((page) => {
          const pageBoxes = computeGroupBoxes(page.children);
          return {
            ...page,
            children: page.children.map((el) =>
              seedCopy(el, imgOut, resized, el.originId || el.id, el.groupId ? pageBoxes.get(el.groupId) : undefined)),
          };
        });
        const outs = [...doc.outputs]; outs[index] = resized;
        set({ doc: { ...doc, outputs: outs }, isDirty: true });
        get().pushHistory();
      },

      setEditFormatOnly: (v) => set({ editFormatOnly: v }),

      setBrandEnforcement: (v) => set({ brandEnforcement: v }),

      setBrandAdminOverride: (v) => set({ brandAdminOverride: v }),

      unlinkElement: (id) => {
        if (isVideoMode()) return;
        set({ doc: { ...get().doc, outputs: withActiveChildren(
          activePageChildren().map((el) => (el.id === id ? { ...el, originId: undefined } : el))
        ) }, isDirty: true });
        get().pushHistory();
      },

      relinkElement: (id, originId) => {
        if (isVideoMode()) return;
        const { doc, currentOutput } = get();
        const el = (doc.outputs[currentOutput] as DesignerOutput).children.find((e) => e.id === id);
        if (!el) return;
        const style = sharedUpdates(el);
        delete (style as any).id;
        delete (style as any).originId;
        delete (style as any).groupId;
        const outs = doc.outputs.map((out, i) => ({
          ...out,
          children: (out as DesignerOutput).children.map((c) =>
            i === currentOutput && c.id === id
              ? { ...c, originId }
              : c.originId === originId
              ? { ...c, ...style }
              : c
          ),
        }));
        set({ doc: { ...doc, outputs: outs }, isDirty: true });
        get().pushHistory();
      },

      setZoom: (zoom) => set({ zoom: Math.max(0.1, Math.min(5, zoom)) }),
      setViewport: (x, y) => set({ viewportX: x, viewportY: y }),
      setSnapEnabled: (v) => set({ snapEnabled: v }),
      setTimelineSnap: (v) => set({ timelineSnap: v }),
      setTimelineHeight: (px) => set({ timelineHeight: Math.max(120, Math.min(600, Math.round(px))) }),
      setShowGrid: (v) => set({ showGrid: v }),
      setGridSize: (n) => set({ gridSize: Math.max(2, Math.min(500, Math.round(n))) }),
      setSnapToGrid: (v) => set({ snapToGrid: v }),

      // Guides live on the OUTPUT, so they follow the design rather than the
      // session — but nothing in any renderer reads them.
      addGuide: (axis, position) =>
        set((state) => {
          const doc = structuredClone(state.doc);
          const out = doc.outputs[state.currentOutput] as any;
          if (!out) return {};
          const guides = out.guides || { x: [], y: [] };
          out.guides = { ...guides, [axis]: [...guides[axis], position] };
          return { doc };
        }),

      moveGuide: (axis, index, position) =>
        set((state) => {
          const doc = structuredClone(state.doc);
          const out = doc.outputs[state.currentOutput] as any;
          const guides = out?.guides;
          if (!guides?.[axis] || index < 0 || index >= guides[axis].length) return {};
          out.guides = {
            ...guides,
            [axis]:
              position === null
                ? guides[axis].filter((_: number, i: number) => i !== index)
                : guides[axis].map((g: number, i: number) => (i === index ? position : g)),
          };
          return { doc };
        }),

      clearGuides: () =>
        set((state) => {
          const doc = structuredClone(state.doc);
          const out = doc.outputs[state.currentOutput] as any;
          if (!out) return {};
          out.guides = { x: [], y: [] };
          return { doc };
        }),
      requestFit: () => set({ fitNonce: get().fitNonce + 1 }),
      setActiveTool: (toolId) => {
        const t = getTool(toolId);
        if (!t) return;
        set({
          activeTool: toolId,
          lastToolPerGroup: { ...get().lastToolPerGroup, [t.group]: toolId },
        });
      },
      setToolOption: (toolId, key, value) =>
        set({
          toolOptions: {
            ...get().toolOptions,
            [toolId]: { ...(get().toolOptions[toolId] || {}), [key]: value },
          },
        }),

      requestGenerate: (kind) => set({ generateRequest: kind }),

      setMaskTarget: (id) => set({ maskTargetId: id }),

      setSelection: (mask) => {
        const previous = get().selection;
        set({
          selection: mask,
          // Only a real selection is worth restoring; clearing an already-empty
          // one must not wipe what Reselect had to offer.
          lastSelection: previous ?? get().lastSelection,
        });
      },

      pushHistory: (label) => {
        const { doc, history, historyLabels, historyIndex, savedHistoryIndex } = get();
        const snapshot = JSON.parse(JSON.stringify(doc));
        const newHistory = history.slice(0, historyIndex + 1);
        const newLabels = historyLabels.slice(0, historyIndex + 1);
        newHistory.push(snapshot);
        newLabels.push(label || 'Edit');
        let savedIdx = savedHistoryIndex;
        if (newHistory.length > 50) {
          newHistory.shift();
          newLabels.shift();
          savedIdx -= 1; // indices shifted down; -1 → saved snapshot evicted
        }
        set({
          history: newHistory,
          historyLabels: newLabels,
          historyIndex: newHistory.length - 1,
          savedHistoryIndex: savedIdx,
        });
      },

      jumpToHistory: (index) => {
        const { history, historyIndex, savedHistoryIndex, currentOutput, currentPage } = get();
        if (index < 0 || index >= history.length || index === historyIndex) return;
        const nextDoc = JSON.parse(JSON.stringify(history[index]));
        const clampedOutput = Math.max(0, Math.min(currentOutput, (nextDoc.outputs?.length ?? 1) - 1));
        set({
          doc: nextDoc,
          historyIndex: index,
          selectedIds: [],
          isDirty: index !== savedHistoryIndex,
          currentOutput: clampedOutput,
          currentPage: clampPage(nextDoc, clampedOutput, currentPage),
        });
        // The restored `src` is now the truth for every raster layer — the
        // live paint buffers have to catch up or the canvas keeps showing the
        // pixels undo just reverted.
        reconcileBuffersWithDoc(nextDoc);
      },

      undo: () => {
        const { historyIndex, history, savedHistoryIndex, currentOutput, currentPage } = get();
        if (historyIndex <= 0) return;
        const newIndex = historyIndex - 1;
        const nextDoc = JSON.parse(JSON.stringify(history[newIndex]));
        const clampedOutput = Math.max(0, Math.min(currentOutput, (nextDoc.outputs?.length ?? 1) - 1));
        set({
          doc: nextDoc,
          historyIndex: newIndex,
          selectedIds: [],
          isDirty: newIndex !== savedHistoryIndex,
          currentOutput: clampedOutput,
          currentPage: clampPage(nextDoc, clampedOutput, currentPage),
        });
        reconcileBuffersWithDoc(nextDoc);
      },

      redo: () => {
        const { historyIndex, history, savedHistoryIndex, currentOutput, currentPage } = get();
        if (historyIndex >= history.length - 1) return;
        const newIndex = historyIndex + 1;
        const nextDoc = JSON.parse(JSON.stringify(history[newIndex]));
        const clampedOutput = Math.max(0, Math.min(currentOutput, (nextDoc.outputs?.length ?? 1) - 1));
        set({
          doc: nextDoc,
          historyIndex: newIndex,
          selectedIds: [],
          isDirty: newIndex !== savedHistoryIndex,
          currentOutput: clampedOutput,
          currentPage: clampPage(nextDoc, clampedOutput, currentPage),
        });
        reconcileBuffersWithDoc(nextDoc);
      },

      markSaved: () => set({ isDirty: false, isSaving: false, saveFailed: false, saveRetryPaused: false, lastSaved: new Date(), savedHistoryIndex: get().historyIndex }),
      setSaving: (saving) => set({ isSaving: saving }),
      setSaveFailed: (failed) => set({ saveFailed: failed }),
      setSaveRetryPaused: (paused) => set({ saveRetryPaused: paused }),

      reset: (w, h) => {
        const newDoc = createEmptyDoc(w, h);
        // Every live paint buffer belongs to the document being discarded.
        disposeAllBuffers();
        set({
          doc: newDoc, selectedIds: [], currentOutput: 0, currentPage: 0, zoom: 1, viewportX: 0, viewportY: 0,
          // Ask the canvas to fit. Bumped here rather than at the call sites so
          // every route into a new document gets it — there are four.
          fitNonce: get().fitNonce + 1,
          history: [JSON.parse(JSON.stringify(newDoc))], historyLabels: ['New'], historyIndex: 0, savedHistoryIndex: 0,
          designId: null, designTemplateId: null, templateId: null,
          designName: 'Untitled Design', isDirty: false, isSaving: false, lastSaved: null, saveFailed: false, saveRetryPaused: false,
          editFormatOnly: false,
          brandEnforcement: false,
          brandAdminOverride: false,
          playheadMs: 0,
          selectedClip: null,
          selectedClips: [],
          linkedUpdateFlash: {},
        });
      },

      loadDesign: (doc, id, name, templateId = null) => {
        const migrated = migrateDoc(doc);
        // Buffers from the previously open design would otherwise live (and
        // paint over matching ids) for the tab's lifetime.
        disposeAllBuffers();
        set({
          doc: migrated, designId: id, designName: name,
          templateId, designTemplateId: templateId,
          selectedIds: [], currentOutput: 0, currentPage: 0,
          // The zoom and viewport belonged to whatever was open before. Reset
          // them and ask for a fit: leaving a stale zoom on screen for a frame
          // before the fit lands reads as a flash.
          zoom: 1, viewportX: 0, viewportY: 0,
          fitNonce: get().fitNonce + 1,
          history: [JSON.parse(JSON.stringify(migrated))], historyLabels: ['Open'], historyIndex: 0, savedHistoryIndex: 0, isDirty: false,
          // A paused/failed autosave belonged to the previous design.
          saveFailed: false, saveRetryPaused: false,
          playheadMs: 0,
          selectedClip: null,
          selectedClips: [],
          linkedUpdateFlash: {},
          brandAdminOverride: false,
        });
      },

      // --- Video mode actions ---

      addTrack: (outputIndex, type) => {
        const { doc } = get();
        const vo = doc.outputs[outputIndex] as VideoOutput | undefined;
        if (!vo || doc.mode !== 'video') return;
        if (vo.tracks.length >= MAX_TRACKS) return;
        const updated: VideoOutput = {
          ...vo,
          tracks: [...vo.tracks, { id: genId(), type, clips: [] }],
        };
        const outs = [...doc.outputs];
        outs[outputIndex] = updated;
        set({ doc: { ...doc, outputs: outs }, isDirty: true });
        get().pushHistory();
      },

      removeTrack: (outputIndex, trackId) => {
        const { doc } = get();
        const vo = doc.outputs[outputIndex] as VideoOutput | undefined;
        if (!vo || doc.mode !== 'video') return;
        const updated: VideoOutput = {
          ...vo,
          tracks: vo.tracks.filter((t) => t.id !== trackId),
        };
        const outs = [...doc.outputs];
        outs[outputIndex] = updated;
        set({ doc: { ...doc, outputs: outs }, isDirty: true });
        get().pushHistory();
      },

      addClip: (outputIndex, trackId, clip) => {
        const { doc } = get();
        const vo = doc.outputs[outputIndex] as VideoOutput | undefined;
        if (!vo || doc.mode !== 'video') return;
        // Explicit duration cap: reject clips that would exceed the output duration.
        const startMs = Math.max(0, clip.startMs ?? 0);
        const endMs = Math.max(startMs + 100, clip.endMs ?? startMs + 1000);
        if (endMs > vo.durationMs || startMs >= vo.durationMs) {
          return;
        }
        const newClip = { ...clip, id: clip.id || genId(), startMs, endMs };
        const updated: VideoOutput = {
          ...vo,
          tracks: vo.tracks.map((t) =>
            t.id === trackId ? { ...t, clips: [...t.clips, newClip] } : t
          ),
        };
        const outs = [...doc.outputs];
        outs[outputIndex] = updated;
        set({ doc: { ...doc, outputs: outs }, isDirty: true });
        get().pushHistory();
      },

      removeClip: (outputIndex, trackId, clipId) => {
        get().removeClips(outputIndex, [{ trackId, clipId }]);
      },

      moveClips: (outputIndex, moves, opts) => {
        const { doc, selectedClip, selectedClips } = get();
        const vo = doc.outputs[outputIndex] as VideoOutput | undefined;
        if (!vo || doc.mode !== 'video' || !moves.length) return false;

        let tracks = vo.tracks;
        let newTrackId: string | null = null;
        if (opts?.newTrackType) {
          if (tracks.length >= MAX_TRACKS) return false;
          newTrackId = genId();
          tracks = [...tracks, { id: newTrackId, type: opts.newTrackType, clips: [] }];
        }

        const byId = new Map(tracks.map((t) => [t.id, t] as const));
        const pending: { clip: VideoClip; from: VideoTrack; to: VideoTrack; startMs: number; endMs: number }[] = [];
        for (const m of moves) {
          const from = byId.get(m.trackId);
          const to = byId.get(m.toTrackId ?? newTrackId ?? '');
          const clip = from?.clips.find((c) => c.id === m.clipId);
          if (!from || !to || !clip || to.locked) return false;
          // Same-type only — canDropClipOnTrack lives in clip-geometry.ts and
          // is inlined here to keep the store free of a module cycle.
          if (from.type !== to.type) return false;
          if (m.startMs < 0 || m.endMs <= m.startMs || m.endMs > vo.durationMs) return false;
          pending.push({ clip, from, to, startMs: m.startMs, endMs: m.endMs });
        }

        const moving = new Set(moves.map((m) => `${m.trackId}:${m.clipId}`));
        const updated: VideoOutput = {
          ...vo,
          tracks: tracks.map((t) => {
            const kept = t.clips.filter((c) => !moving.has(`${t.id}:${c.id}`));
            const incoming = pending
              .filter((p) => p.to.id === t.id)
              .map((p) => ({ ...p.clip, startMs: p.startMs, endMs: p.endMs }));
            return kept.length === t.clips.length && !incoming.length
              ? t
              : { ...t, clips: [...kept, ...incoming] };
          }),
        };
        const outs = [...doc.outputs];
        outs[outputIndex] = updated;

        // Selection refs follow each clip to its new track.
        const retarget = (r: { trackId: string; clipId: string }) => {
          const mv = moves.find((m) => m.trackId === r.trackId && m.clipId === r.clipId);
          return mv ? { ...r, trackId: mv.toTrackId ?? newTrackId! } : r;
        };
        set({
          doc: { ...doc, outputs: outs },
          isDirty: true,
          selectedClips: selectedClips.map(retarget),
          selectedClip:
            selectedClip && selectedClip.outputIndex === outputIndex
              ? { ...selectedClip, ...retarget(selectedClip) }
              : selectedClip,
        });
        get().pushHistory('Move clip');
        return true;
      },

      removeClips: (outputIndex, refs) => {
        const { doc, selectedClip, selectedClips } = get();
        const vo = doc.outputs[outputIndex] as VideoOutput | undefined;
        if (!vo || doc.mode !== 'video' || !refs.length) return;
        // Clips on locked tracks refuse deletion — filter them out before the
        // doomed-set is built (drag/trim are blocked at the gesture level).
        const lockedTracks = new Set(vo.tracks.filter((t) => t.locked).map((t) => t.id));
        const editable = refs.filter((r) => !lockedTracks.has(r.trackId));
        if (!editable.length) return;
        const doomed = new Set(editable.map((r) => `${r.trackId}:${r.clipId}`));
        const isDoomed = (trackId: string, clipId: string) => doomed.has(`${trackId}:${clipId}`);
        const updated: VideoOutput = {
          ...vo,
          tracks: vo.tracks.map((t) => ({
            ...t,
            clips: t.clips.filter((c) => !isDoomed(t.id, c.id)),
          })),
        };
        const outs = [...doc.outputs];
        outs[outputIndex] = updated;
        const nextSelected = selectedClips.filter((c) => !isDoomed(c.trackId, c.clipId));
        const wasPrimary = selectedClip && isDoomed(selectedClip.trackId, selectedClip.clipId);
        set({
          doc: { ...doc, outputs: outs },
          isDirty: true,
          selectedClips: nextSelected,
          selectedClip: wasPrimary
            ? nextSelected.length
              ? { outputIndex, trackId: nextSelected[nextSelected.length - 1].trackId, clipId: nextSelected[nextSelected.length - 1].clipId }
              : null
            : selectedClip,
        });
        get().pushHistory();
      },

      updateClip: (outputIndex, trackId, clipId, updates) => {
        if (get().updateClipSilent(outputIndex, trackId, clipId, updates)) {
          get().pushHistory();
        }
      },

      // Returns whether the write landed — a rejected update (unknown clip,
      // degenerate timing) must not become an empty undo step.
      updateClipSilent: (outputIndex, trackId, clipId, updates) => {
        const { doc, editFormatOnly, linkedUpdateFlash } = get();
        const vo = doc.outputs[outputIndex] as VideoOutput | undefined;
        if (!vo || doc.mode !== 'video') return false;
        const track = vo.tracks.find((t) => t.id === trackId);
        const clip = track?.clips.find((c) => c.id === clipId);
        if (!clip) return false;
        let patched = updates;
        // The range check applies only when timing is actually being edited —
        // a clip left out of bounds by a duration shrink must stay editable
        // (filters, scale, position…), or the whole inspector goes dead.
        // In-range edits clamp rather than reject, so a drag past the end
        // lands at the boundary instead of doing nothing.
        if (updates.startMs !== undefined || updates.endMs !== undefined) {
          const nextStart = Math.max(0, Math.min(vo.durationMs, updates.startMs ?? clip.startMs));
          const nextEnd = Math.max(0, Math.min(vo.durationMs, updates.endMs ?? clip.endMs));
          // A zero/negative-length clip is the one timing state still rejected.
          if (nextEnd <= nextStart) return false;
          // Both ends are written back clamped: editing the timing of a clip
          // whose other end was left out of bounds (duration shrink) heals it
          // instead of failing on the stale value forever.
          patched = { ...updates, startMs: nextStart, endMs: nextEnd };
        }
        // Linked-by-default across video variants: content/style updates
        // propagate to same-originId clips on the other outputs; geometry and
        // timing stay local (VIDEO_CLIP_LOCAL_KEYS), like the image path.
        const { outputs, affected } = applyLinkedVideoClip(
          doc,
          outputIndex,
          trackId,
          clipId,
          patched,
          editFormatOnly
        );
        if (affected.length) {
          const now = Date.now();
          const nextFlash: Record<number, number> = { ...linkedUpdateFlash };
          affected.forEach((i) => (nextFlash[i] = now));
          set({ doc: { ...doc, outputs }, isDirty: true, linkedUpdateFlash: nextFlash });
          return true;
        }
        set({ doc: { ...doc, outputs }, isDirty: true });
        return true;
      },

      setVideoDuration: (outputIndex, durationMs) => {
        const { doc } = get();
        const vo = doc.outputs[outputIndex] as VideoOutput | undefined;
        if (!vo || doc.mode !== 'video') return;
        const clamped = Math.max(1000, Math.min(MAX_VIDEO_DURATION_MS, durationMs));
        const updated: VideoOutput = { ...vo, durationMs: clamped };
        const outs = [...doc.outputs];
        outs[outputIndex] = updated;
        set({ doc: { ...doc, outputs: outs }, isDirty: true });
        get().pushHistory();
      },

      splitClip: (outputIndex, trackId, clipId, atMs) => {
        const { doc } = get();
        const vo = doc.outputs[outputIndex] as VideoOutput | undefined;
        if (!vo || doc.mode !== 'video' || !canSplitClipAt(vo, trackId, clipId, atMs)) return;
        let resultingClipId: string | null = null;
        const updated: VideoOutput = {
          ...vo,
          tracks: vo.tracks.map((t) => {
            if (t.id !== trackId) return t;
            const idx = t.clips.findIndex((c) => c.id === clipId);
            if (idx < 0) return t;
            const original = t.clips[idx];
            const splitPoint = atMs;
            // A ramped clip splits its CURVE at the cut: each side keeps the
            // points for the source window it plays, re-based to its own
            // start, with trim-in fixed so the source stays continuous (see
            // splitSpeedCurveForClip — it also handles the reverse mirror).
            // Without a curve the legacy trim advance applies unchanged.
            const curveSplit = splitSpeedCurveForClip(original, splitPoint - original.startMs);
            const first: VideoClip = {
              ...original,
              id: genId(),
              endMs: splitPoint,
              ...(curveSplit ? { speedCurve: curveSplit.first.speedCurve, trimInMs: curveSplit.first.trimInMs } : {}),
            };
            // The second half must advance its source trim-in so it continues from
            // where the first half ended, otherwise it replays the source from 0
            // (sourceTimeForPlayhead adds trimInMs). Applies even when the original
            // had no trimIn.
            const second: VideoClip = {
              ...original,
              id: genId(),
              startMs: splitPoint,
              ...(curveSplit
                ? { speedCurve: curveSplit.second.speedCurve, trimInMs: curveSplit.second.trimInMs }
                : { trimInMs: (original.trimInMs ?? 0) + (splitPoint - original.startMs) }),
            };
            resultingClipId = second.id;
            const clips = [...t.clips];
            clips.splice(idx, 1, first, second);
            return { ...t, clips };
          }),
        };
        if (!resultingClipId) return;
        const outs = [...doc.outputs];
        outs[outputIndex] = updated;
        set({
          doc: { ...doc, outputs: outs },
          isDirty: true,
          selectedClip: { outputIndex, trackId, clipId: resultingClipId },
          selectedClips: [{ trackId, clipId: resultingClipId }],
        });
        get().pushHistory();
      },

      setMode: (mode) => {
        const { doc } = get();
        if (doc.mode === mode) return;
        if (mode === 'video') {
          const source = doc.outputs[0] as DesignerOutput;
          const trackId = genId();
          const preset = CHANNEL_PRESETS.find((p) => p.id === source.formatId);
          const vo: VideoOutput = {
            id: genId(),
            formatId: source.formatId,
            name: source.name,
            width: source.width,
            height: source.height,
            fps: preset?.fps ?? 30,
            // Hard cap only — the mode flip starts the timeline at 10 s unless
            // the preset's maxDurationMs is tighter.
            durationMs: Math.min(preset?.maxDurationMs ?? 10000, 10000),
            tracks: [{ id: trackId, type: 'video', clips: [] }],
          };
          set({ doc: { ...doc, mode: 'video', outputs: [vo] }, selectedIds: [], selectedClip: null, selectedClips: [], currentOutput: 0, currentPage: 0, isDirty: true });
        } else {
          const source = doc.outputs[0] as VideoOutput;
          const imgOut: DesignerOutput = {
            id: genId(),
            formatId: source.formatId,
            name: source.name,
            width: source.width,
            height: source.height,
            background: '#ffffff',
            children: [],
          };
          const nextDoc = { ...doc, mode: 'image' as const, outputs: [imgOut] };
          delete nextDoc.characterReferences;
          set({ doc: nextDoc, selectedIds: [], selectedClip: null, selectedClips: [], currentOutput: 0, currentPage: 0, isDirty: true });
        }
        get().pushHistory();
      },

      setPlayhead: (ms) => set({ playheadMs: ms }),

      setIsPlaying: (playing) => set({ isPlaying: playing }),

      setSelectedClip: (clip) => {
        if (!clip) {
          set({ selectedClip: null, selectedClips: [], selectedIds: [] });
          return;
        }
        const vo = get().doc.outputs[clip.outputIndex] as VideoOutput | undefined;
        const selectedClips = vo
          ? groupRefsForClip(vo, clip.trackId, clip.clipId)
          : [{ trackId: clip.trackId, clipId: clip.clipId }];
        set({ selectedClip: clip, selectedClips, selectedIds: [] });
      },

      setSelectedClips: (clips, primary) => {
        const { selectedClip, currentOutput } = get();
        const requestedPrimary = primary && clips.some(
          (clip) => clip.trackId === primary.trackId && clip.clipId === primary.clipId
        );
        const primarySurvives =
          selectedClip &&
          clips.some((c) => c.trackId === selectedClip.trackId && c.clipId === selectedClip.clipId);
        set({
          selectedClips: clips,
          selectedClip: requestedPrimary
            ? { outputIndex: currentOutput, ...primary }
            : primarySurvives
            ? selectedClip
            : clips.length
            ? { outputIndex: currentOutput, trackId: clips[0].trackId, clipId: clips[0].clipId }
            : null,
        });
      },

      toggleClipSelection: (trackId, clipId) => {
        const { doc, selectedClips, currentOutput } = get();
        const vo = doc.outputs[currentOutput] as VideoOutput | undefined;
        if (!vo) return;
        const members = groupRefsForClip(vo, trackId, clipId);
        const adding = !members.every((member) =>
          selectedClips.some(
            (ref) => ref.trackId === member.trackId && ref.clipId === member.clipId
          )
        );
        get().setSelectedClips(
          toggleClipRefs(selectedClips, members),
          adding ? { trackId, clipId } : undefined
        );
      },

      setTrackGain: (outputIndex, trackId, gain, commit = true) => {
        const { doc } = get();
        const vo = doc.outputs[outputIndex] as VideoOutput | undefined;
        if (!vo || doc.mode !== 'video') return;
        const updated: VideoOutput = {
          ...vo,
          tracks: vo.tracks.map((t) => t.id === trackId ? { ...t, gain: Math.max(0, Math.min(2, gain)) } : t),
        };
        const outs = [...doc.outputs];
        outs[outputIndex] = updated;
        set({ doc: { ...doc, outputs: outs }, isDirty: true });
        // Gain rides a range slider: the caller passes commit:false per tick
        // and pushes one history entry on release.
        if (commit) get().pushHistory();
      },

      setTrackAutoDuck: (outputIndex, trackId, autoDuck) => {
        const { doc } = get();
        const vo = doc.outputs[outputIndex] as VideoOutput | undefined;
        if (!vo || doc.mode !== 'video') return;
        const updated: VideoOutput = {
          ...vo,
          tracks: vo.tracks.map((t) => t.id === trackId ? { ...t, autoDuck } : t),
        };
        const outs = [...doc.outputs];
        outs[outputIndex] = updated;
        set({ doc: { ...doc, outputs: outs }, isDirty: true });
        get().pushHistory();
      },

      renameTrack: (outputIndex, trackId, name) => {
        const { doc } = get();
        const vo = doc.outputs[outputIndex] as VideoOutput | undefined;
        if (!vo || doc.mode !== 'video') return;
        const trimmed = name.trim();
        const updated: VideoOutput = {
          ...vo,
          // Clearing the name stores undefined (not '') so the label falls back
          // to the track type and the field stays absent from the saved doc.
          tracks: vo.tracks.map((t) => t.id === trackId ? { ...t, name: trimmed || undefined } : t),
        };
        const outs = [...doc.outputs];
        outs[outputIndex] = updated;
        set({ doc: { ...doc, outputs: outs }, isDirty: true });
        get().pushHistory('Rename track');
      },

      setTrackMuted: (outputIndex, trackId, muted) => {
        const { doc } = get();
        const vo = doc.outputs[outputIndex] as VideoOutput | undefined;
        if (!vo || doc.mode !== 'video') return;
        const updated: VideoOutput = {
          ...vo,
          tracks: vo.tracks.map((t) => t.id === trackId ? { ...t, muted } : t),
        };
        const outs = [...doc.outputs];
        outs[outputIndex] = updated;
        set({ doc: { ...doc, outputs: outs }, isDirty: true });
        get().pushHistory(muted ? 'Mute track' : 'Unmute track');
      },

      setTrackLocked: (outputIndex, trackId, locked) => {
        const { doc } = get();
        const vo = doc.outputs[outputIndex] as VideoOutput | undefined;
        if (!vo || doc.mode !== 'video') return;
        const updated: VideoOutput = {
          ...vo,
          tracks: vo.tracks.map((t) => t.id === trackId ? { ...t, locked } : t),
        };
        const outs = [...doc.outputs];
        outs[outputIndex] = updated;
        set({ doc: { ...doc, outputs: outs }, isDirty: true });
        get().pushHistory(locked ? 'Lock track' : 'Unlock track');
      },

      setTrackHidden: (outputIndex, trackId, hidden) => {
        const { doc } = get();
        const vo = doc.outputs[outputIndex] as VideoOutput | undefined;
        if (!vo || doc.mode !== 'video') return;
        const updated: VideoOutput = {
          ...vo,
          tracks: vo.tracks.map((t) => t.id === trackId ? { ...t, hidden } : t),
        };
        const outs = [...doc.outputs];
        outs[outputIndex] = updated;
        set({ doc: { ...doc, outputs: outs }, isDirty: true });
        get().pushHistory(hidden ? 'Hide track' : 'Show track');
      },

      addMarker: (outputIndex, tMs, name) => {
        const { doc } = get();
        const vo = doc.outputs[outputIndex] as VideoOutput | undefined;
        if (!vo || doc.mode !== 'video') return null;
        const marker = {
          id: genId(),
          tMs: Math.max(0, Math.min(vo.durationMs, Math.round(tMs))),
          ...(name?.trim() ? { name: name.trim() } : {}),
        };
        const markers = [...(vo.markers || []), marker].sort((a, b) => a.tMs - b.tMs);
        const outs = [...doc.outputs];
        outs[outputIndex] = { ...vo, markers };
        set({ doc: { ...doc, outputs: outs }, isDirty: true });
        get().pushHistory('Add marker');
        return marker.id;
      },

      renameMarker: (outputIndex, markerId, name) => {
        const { doc } = get();
        const vo = doc.outputs[outputIndex] as VideoOutput | undefined;
        if (!vo || doc.mode !== 'video' || !vo.markers?.some((m) => m.id === markerId)) return;
        const trimmed = name.trim();
        const markers = vo.markers.map((m) =>
          m.id === markerId ? { ...m, name: trimmed || undefined } : m
        );
        const outs = [...doc.outputs];
        outs[outputIndex] = { ...vo, markers };
        set({ doc: { ...doc, outputs: outs }, isDirty: true });
        get().pushHistory('Rename marker');
      },

      removeMarker: (outputIndex, markerId) => {
        const { doc } = get();
        const vo = doc.outputs[outputIndex] as VideoOutput | undefined;
        if (!vo || doc.mode !== 'video' || !vo.markers?.some((m) => m.id === markerId)) return;
        const markers = vo.markers.filter((m) => m.id !== markerId);
        const outs = [...doc.outputs];
        outs[outputIndex] = { ...vo, markers: markers.length ? markers : undefined };
        set({ doc: { ...doc, outputs: outs }, isDirty: true });
        get().pushHistory('Delete marker');
      },

      duplicateClip: (outputIndex, trackId, clipId) => {
        const { doc } = get();
        const vo = doc.outputs[outputIndex] as VideoOutput | undefined;
        if (!vo || doc.mode !== 'video') return;
        const track = vo.tracks.find((t) => t.id === trackId);
        const source = track?.clips.find((c) => c.id === clipId);
        if (!track || !source || track.locked) return null;

        // Start at the source's VISUAL end (freeze extension included) so the
        // copy never overlaps the original's held frame.
        const duration = source.endMs - source.startMs;
        const startMs = source.endMs + (source.freezeAtMs || 0);
        // Extend the output when the copy would overflow, the way insert flows
        // do — but the MAX_VIDEO_DURATION_MS ceiling still applies; past it there is no room.
        const durationMs = Math.max(vo.durationMs, startMs + duration);
        if (durationMs > MAX_VIDEO_DURATION_MS || startMs >= durationMs) return null;
        const newClip: VideoClip = {
          ...source,
          id: genId(),
          groupId: source.groupId ? genId() : undefined,
          startMs,
          endMs: startMs + duration,
          // A frozen hold is not part of the copy: duplicating a half-frozen
          // clip would otherwise paste a clip whose tail sits inside the new
          // duration bounds but reads as a longer freeze.
          freezeAtMs: undefined,
        };
        const updated: VideoOutput = {
          ...vo,
          durationMs,
          tracks: vo.tracks.map((t) =>
            t.id === trackId ? { ...t, clips: [...t.clips, newClip] } : t
          ),
        };
        const outs = [...doc.outputs];
        outs[outputIndex] = updated;
        // One history entry for the whole operation (duration extension +
        // insert) — a split setVideoDuration/addClip pair would undo in two
        // steps for a single user gesture.
        set({ doc: { ...doc, outputs: outs }, isDirty: true, selectedClip: { outputIndex, trackId, clipId: newClip.id }, selectedClips: [{ trackId, clipId: newClip.id }], selectedIds: [] });
        get().pushHistory('Duplicate clip');
        return newClip.id;
      },

      rippleDeleteClip: (outputIndex, trackId, clipId) => {
        const { doc, selectedClip, selectedClips } = get();
        const vo = doc.outputs[outputIndex] as VideoOutput | undefined;
        if (!vo || doc.mode !== 'video') return;
        const track = vo.tracks.find((t) => t.id === trackId);
        const clip = track?.clips.find((c) => c.id === clipId);
        // A locked track refuses deletion, same as removeClips/splitClip.
        if (!track || !clip || track.locked) return;

        // The gap a ripple closes is the clip's VISUAL length — a freeze hold
        // occupies timeline space past endMs and must collapse with the clip.
        const shift = clip.endMs + (clip.freezeAtMs || 0) - clip.startMs;
        const updated: VideoOutput = {
          ...vo,
          tracks: vo.tracks.map((t) => {
            if (t.id !== trackId) return t;
            return {
              ...t,
              clips: t.clips
                .filter((c) => c.id !== clipId)
                .map((c) => {
                  if (c.startMs < clip.startMs) return c;
                  // Clamped at 0: a successor parked near the head stops there
                  // rather than going negative; duration is preserved.
                  const startMs = Math.max(0, c.startMs - shift);
                  return { ...c, startMs, endMs: startMs + (c.endMs - c.startMs) };
                }),
            };
          }),
        };
        const outs = [...doc.outputs];
        outs[outputIndex] = updated;
        const nextSelected = selectedClips.filter((c) => !(c.trackId === trackId && c.clipId === clipId));
        const wasPrimary = selectedClip?.trackId === trackId && selectedClip?.clipId === clipId;
        set({
          doc: { ...doc, outputs: outs },
          isDirty: true,
          selectedClips: nextSelected,
          selectedClip: wasPrimary
            ? nextSelected.length
              ? { outputIndex, trackId: nextSelected[nextSelected.length - 1].trackId, clipId: nextSelected[nextSelected.length - 1].clipId }
              : null
            : selectedClip,
        });
        get().pushHistory('Ripple delete');
      },

      rippleDeleteClips: (outputIndex, refs) => {
        const { doc, selectedClip, selectedClips } = get();
        const vo = doc.outputs[outputIndex] as VideoOutput | undefined;
        if (!vo || doc.mode !== 'video' || !refs.length) return;
        // Locked tracks refuse deletion, same as removeClips.
        const lockedTracks = new Set(vo.tracks.filter((t) => t.locked).map((t) => t.id));
        const editable = refs.filter((r) => !lockedTracks.has(r.trackId));
        if (!editable.length) return;
        const doomed = new Set(editable.map((r) => `${r.trackId}:${r.clipId}`));
        const isDoomed = (trackId: string, clipId: string) => doomed.has(`${trackId}:${clipId}`);
        const updated: VideoOutput = {
          ...vo,
          tracks: vo.tracks.map((t) => {
            const removed = t.clips
              .filter((c) => isDoomed(t.id, c.id))
              .sort((a, b) => a.startMs - b.startMs);
            if (!removed.length) return t;
            // A later clip closes the gap of every removed clip before it —
            // the same visual-length rule the single-clip ripple applies.
            const span = (c: VideoClip) => c.endMs + (c.freezeAtMs || 0) - c.startMs;
            return {
              ...t,
              clips: t.clips
                .filter((c) => !isDoomed(t.id, c.id))
                .map((c) => {
                  const shift = removed
                    .filter((r) => r.startMs <= c.startMs)
                    .reduce((sum, r) => sum + span(r), 0);
                  if (!shift) return c;
                  const startMs = Math.max(0, c.startMs - shift);
                  return { ...c, startMs, endMs: startMs + (c.endMs - c.startMs) };
                }),
            };
          }),
        };
        const outs = [...doc.outputs];
        outs[outputIndex] = updated;
        const nextSelected = selectedClips.filter((c) => !isDoomed(c.trackId, c.clipId));
        const wasPrimary = selectedClip && isDoomed(selectedClip.trackId, selectedClip.clipId);
        set({
          doc: { ...doc, outputs: outs },
          isDirty: true,
          selectedClips: nextSelected,
          selectedClip: wasPrimary
            ? nextSelected.length
              ? { outputIndex, trackId: nextSelected[nextSelected.length - 1].trackId, clipId: nextSelected[nextSelected.length - 1].clipId }
              : null
            : selectedClip,
        });
        get().pushHistory('Ripple delete');
      },

      copySelectedClips: () => {
        const { doc, currentOutput, selectedClips, selectedClip } = get();
        const vo = doc.outputs[currentOutput] as VideoOutput | undefined;
        if (!vo || doc.mode !== 'video') return;
        const refs = selectedClips.length
          ? selectedClips
          : selectedClip && selectedClip.outputIndex === currentOutput
          ? [{ trackId: selectedClip.trackId, clipId: selectedClip.clipId }]
          : [];
        const entries: { clip: VideoClip; trackId: string; trackType: VideoTrack['type'] }[] = [];
        for (const ref of refs) {
          const track = vo.tracks.find((t) => t.id === ref.trackId);
          const clip = track?.clips.find((c) => c.id === ref.clipId);
          if (track && clip) {
            entries.push({ clip: JSON.parse(JSON.stringify(clip)), trackId: track.id, trackType: track.type });
          }
        }
        if (entries.length) set({ clipClipboard: entries });
      },

      pasteClips: (atMs) => {
        const { doc, currentOutput, clipClipboard } = get();
        const vo = doc.outputs[currentOutput] as VideoOutput | undefined;
        if (!vo || doc.mode !== 'video' || !clipClipboard.length) return;

        const anchor = Math.max(0, atMs);
        const earliest = Math.min(...clipClipboard.map((e) => e.clip.startMs));
        const offset = anchor - earliest;
        const placed = clipClipboard.map((e) => {
          const duration = e.clip.endMs - e.clip.startMs;
          const startMs = e.clip.startMs + offset;
          return { entry: e, startMs, endMs: startMs + duration, effectiveEnd: startMs + duration + (e.clip.freezeAtMs || 0) };
        });

        // Extend the output when the paste overflows, the way duplicateClip
        // does — the MAX_VIDEO_DURATION_MS ceiling still applies; clips past it are skipped.
        const durationMs = Math.min(MAX_VIDEO_DURATION_MS, Math.max(vo.durationMs, ...placed.map((p) => p.effectiveEnd)));
        const fits = placed.filter((p) => p.startMs < durationMs && p.effectiveEnd <= durationMs);
        if (!fits.length) return;

        const tracks = vo.tracks.map((t) => ({ ...t, clips: [...t.clips] }));
        const pastedRefs: { trackId: string; clipId: string }[] = [];
        const groupRemap = new Map<string, string>();
        for (const p of fits) {
          const track =
            tracks.find((t) => t.id === p.entry.trackId && !t.locked) ??
            tracks.find((t) => t.type === p.entry.trackType && !t.locked) ??
            (() => {
              if (tracks.length >= MAX_TRACKS) return undefined;
              const created = { id: genId(), type: p.entry.trackType, clips: [] as VideoClip[] };
              tracks.push(created);
              return created;
            })();
          if (!track) continue;
          const sourceGroupId = p.entry.clip.groupId;
          if (sourceGroupId && !groupRemap.has(sourceGroupId)) {
            groupRemap.set(sourceGroupId, genId());
          }
          const clip: VideoClip = {
            ...JSON.parse(JSON.stringify(p.entry.clip)),
            id: genId(),
            groupId: sourceGroupId ? groupRemap.get(sourceGroupId) : undefined,
            startMs: p.startMs,
            endMs: p.endMs,
          };
          track.clips.push(clip);
          pastedRefs.push({ trackId: track.id, clipId: clip.id });
        }
        if (!pastedRefs.length) return;

        const updated: VideoOutput = { ...vo, durationMs, tracks };
        const outs = [...doc.outputs];
        outs[currentOutput] = updated;
        // One history entry for the whole paste (track creation + duration
        // extension + inserts), like duplicateClip.
        set({
          doc: { ...doc, outputs: outs },
          isDirty: true,
          selectedClips: pastedRefs,
          selectedClip: { outputIndex: currentOutput, trackId: pastedRefs[0].trackId, clipId: pastedRefs[0].clipId },
          selectedIds: [],
        });
        get().pushHistory('Paste clips');
      },

      copyClipKeyframes: (outputIndex, trackId, clipId) => {
        const { doc } = get();
        const vo = doc.outputs[outputIndex] as VideoOutput | undefined;
        if (!vo || doc.mode !== 'video') return;
        const clip = vo.tracks
          .find((t) => t.id === trackId)
          ?.clips.find((c) => c.id === clipId);
        if (!clip?.keyframes?.length) return;
        // Deep clone: later edits to the source clip must not rewrite what a
        // future paste will produce.
        set({ keyframeClipboard: JSON.parse(JSON.stringify(clip.keyframes)) });
      },

      pasteClipKeyframes: (atMs) => {
        const { doc, keyframeClipboard, selectedClip } = get();
        if (!keyframeClipboard?.length || !selectedClip || doc.mode !== 'video') return;
        const vo = doc.outputs[selectedClip.outputIndex] as VideoOutput | undefined;
        const track = vo?.tracks.find((t) => t.id === selectedClip.trackId);
        const clip = track?.clips.find((c) => c.id === selectedClip.clipId);
        if (!vo || !clip) return;

        // A second deep clone on the way out: the clipboard stays pristine and
        // the doc never shares objects with it.
        let incoming = JSON.parse(JSON.stringify(keyframeClipboard)) as NonNullable<VideoClip['keyframes']>;
        if (atMs !== undefined) {
          const earliest = Math.min(...incoming.map((kf) => kf.tMs));
          const offset = atMs - earliest;
          incoming = incoming.map((kf) => ({ ...kf, tMs: kf.tMs + offset }));
        }
        const clipDurationMs = clip.endMs + (clip.freezeAtMs || 0) - clip.startMs;
        incoming = incoming.map((kf) => ({
          ...kf,
          tMs: Math.max(0, Math.min(clipDurationMs, Math.round(kf.tMs))),
        }));

        const merged = mergeKeyframes(clip.keyframes || [], incoming);
        if (
          get().updateClipSilent(selectedClip.outputIndex, selectedClip.trackId, selectedClip.clipId, {
            keyframes: merged,
          })
        ) {
          get().pushHistory('Paste keyframes');
        }
      },

    };
  });
