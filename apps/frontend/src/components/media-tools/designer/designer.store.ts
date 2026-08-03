import { create } from 'zustand';
import { CHANNEL_PRESETS } from '@postmill-ai/nestjs-libraries/integrations/social/channel-presets';
import { detectFocalPoint } from './reflow';
import { DEFAULT_TOOL_ID, getTool } from './tools';
import type { SelectionMask } from './selection-mask';
import { DESIGNER_DOC_VERSION } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.limits';
import {
  migrateDoc,
  genId,
  matchPreset,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.migrate';
import { smartReflow, computeGroupBoxes } from '@postmill-ai/nestjs-libraries/media/designer-doc/reflow';
import { seedCopy } from '@postmill-ai/nestjs-libraries/media/designer-doc/seed-copy';
import { applyLinked, GEOMETRY_KEYS } from '@postmill-ai/nestjs-libraries/media/designer-doc/apply-linked';
import { moveLayers, descendantIds } from '@postmill-ai/nestjs-libraries/media/designer-doc/layer-tree';
import type {
  DesignerDoc,
  DesignerElement,
  DesignerOutput,
  VideoOutput,
  VideoTrack,
  VideoClip,
  DesignerBackground,
  DesignerGradient,
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
} from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import type { FillContents } from '@postmill-ai/nestjs-libraries/media/designer-doc/fill-stroke';

export type {
  DesignerDoc,
  DesignerElement,
  DesignerOutput,
  VideoOutput,
  VideoTrack,
  VideoClip,
  DesignerBackground,
  DesignerGradient,
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
  FillContents,
};
export { migrateDoc };

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
  clipboard: DesignerElement[];
  editFormatOnly: boolean;
  brandEnforcement: boolean;
  brandAdminOverride: boolean;
  playheadMs: number;
  selectedClip: { outputIndex: number; trackId: string; clipId: string } | null;
  linkedUpdateFlash: Record<number, number>;
  // View prefs / canvas requests (menu-driven)
  snapEnabled: boolean;
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
  generateRequest: 'video' | 'music' | 'voiceover' | null;
}

export interface DesignerActions {
  setDoc: (doc: DesignerDoc) => void;
  setDesignName: (name: string) => void;
  setDesignId: (id: string | null) => void;
  setTemplateId: (id: string | null) => void;
  addElement: (element: DesignerElement, beforeId?: string) => void;
  updateElement: (id: string, updates: Partial<DesignerElement>) => void;
  updateElements: (ids: string[], updates: Partial<DesignerElement>) => void;
  // Same as updateElements but does NOT commit history — for continuous controls
  // (slider/drag), which push a single history entry on release instead.
  updateElementsSilent: (ids: string[], updates: Partial<DesignerElement>) => void;
  removeElement: (id: string) => void;
  removeElements: (ids: string[]) => void;
  duplicateElement: (id: string) => void;
  setSelectedIds: (ids: string[]) => void;
  requestRename: (id: string | null) => void;
  setOutputBackground: (bg: DesignerBackground) => void;
  copySelection: () => void; cutSelection: () => void; paste: () => void;
  groupSelection: () => void; ungroupSelection: () => void;
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
  // linked-by-default
  setEditFormatOnly: (v: boolean) => void;
  setBrandEnforcement: (v: boolean) => void;
  setBrandAdminOverride: (v: boolean) => void;
  unlinkElement: (id: string) => void;
  relinkElement: (id: string, originId: string) => void;
  setZoom: (zoom: number) => void;
  setViewport: (x: number, y: number) => void;
  setSnapEnabled: (v: boolean) => void;
  requestFit: () => void;
  /** Select a tool; also remembers it as its group's last-used option. */
  setActiveTool: (toolId: string) => void;
  setToolOption: (toolId: string, key: string, value: unknown) => void;
  /** Replace the pixel selection. Remembers the outgoing one for Reselect. */
  setSelection: (mask: SelectionMask | null) => void;
  requestGenerate: (kind: 'video' | 'music' | 'voiceover' | null) => void;
  /** Arm a layer's mask as the paint target (null = paint the pixels). */
  setMaskTarget: (id: string | null) => void;
  undo: () => void; redo: () => void; pushHistory: (label?: string) => void;
  /** Jump straight to a history entry, as Photoshop's History panel does. */
  jumpToHistory: (index: number) => void;
  markSaved: () => void; setSaving: (saving: boolean) => void;
  reset: (width?: number, height?: number) => void;
  loadDesign: (doc: any, id: string, name: string, templateId?: string | null) => void;
  // video mode
  addTrack: (outputIndex: number, type: VideoTrack['type']) => void;
  removeTrack: (outputIndex: number, trackId: string) => void;
  addClip: (outputIndex: number, trackId: string, clip: VideoClip) => void;
  removeClip: (outputIndex: number, trackId: string, clipId: string) => void;
  updateClip: (outputIndex: number, trackId: string, clipId: string, updates: Partial<VideoClip>) => void;
  setVideoDuration: (outputIndex: number, durationMs: number) => void;
  splitClip: (outputIndex: number, trackId: string, clipId: string, atMs: number) => void;
  setMode: (mode: 'image' | 'video') => void;
  setPlayhead: (ms: number) => void;
  setSelectedClip: (clip: { outputIndex: number; trackId: string; clipId: string } | null) => void;
  setTrackGain: (outputIndex: number, trackId: string, gain: number) => void;
  setTrackAutoDuck: (outputIndex: number, trackId: string, autoDuck: boolean) => void;
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
        durationMs: preset?.maxDurationMs ?? 10000,
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
    const withActiveChildren = (children: DesignerElement[]) => {
      const { doc, currentOutput } = get();
      const outs = [...doc.outputs];
      const out = outs[currentOutput] as DesignerOutput;
      outs[currentOutput] = { ...out, children };
      return outs;
    };
    return {
      doc: initialDoc,
      selectedIds: [],
      renamingId: null,
      currentOutput: 0,
      zoom: 1, viewportX: 0, viewportY: 0,
      history: [JSON.parse(JSON.stringify(initialDoc))], historyIndex: 0, historyLabels: ['Open'],
      savedHistoryIndex: 0,
      designId: null, designTemplateId: null, templateId: null,
      designName: 'Untitled Design',
      isDirty: false, isSaving: false, lastSaved: null,
      editFormatOnly: false,
      brandEnforcement: false,
      brandAdminOverride: false,
      playheadMs: 0,
      selectedClip: null,
      linkedUpdateFlash: {},
      snapEnabled: true,
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
      setDesignName: (name) => set({ designName: name, isDirty: true }),
      setDesignId: (id) => set({ designId: id }),
      setTemplateId: (id) => set({ templateId: id }),

      addElement: (element, beforeId) => {
        if (isVideoMode()) return;
        const { doc, currentOutput } = get();
        const originId = element.originId || genId();
        const baseEl = { ...element, id: element.id || genId(), originId };
        const sourceOutput = doc.outputs[currentOutput] as DesignerOutput;
        const beforeOriginId = beforeId
          ? sourceOutput.children.find((c) => c.id === beforeId)?.originId
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
          const addedId = baseEl.id;
          const addedSrc = baseEl.src;
          detectFocalPoint(addedSrc, fetch).then((fp) => {
            const state = get();
            const source = state.doc.outputs[state.currentOutput] as DesignerOutput | undefined;
            const sourceEl = source?.children.find((c) => c.id === addedId);
            if (!sourceEl || sourceEl.src !== addedSrc) return;
            const nextOutputs = state.doc.outputs.map((out, i) => {
              const target = out as DesignerOutput;
              const targetId = i === state.currentOutput ? addedId : copyIds.get(i);
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
        }
      },

      updateElement: (id, updates) => {
        if (isVideoMode()) return;
        const { doc, currentOutput, editFormatOnly, linkedUpdateFlash } = get();
        const { outputs, affected } = applyLinked(doc, currentOutput, new Set([id]), updates, editFormatOnly);
        const now = Date.now();
        const nextFlash: Record<number, number> = { ...linkedUpdateFlash };
        affected.forEach((i) => (nextFlash[i] = now));
        set({ doc: { ...doc, outputs }, isDirty: true, linkedUpdateFlash: nextFlash });
      },

      updateElements: (ids, updates) => {
        if (isVideoMode()) return;
        const { doc, currentOutput, editFormatOnly, linkedUpdateFlash } = get();
        const { outputs, affected } = applyLinked(doc, currentOutput, new Set(ids), updates, editFormatOnly);
        const now = Date.now();
        const nextFlash: Record<number, number> = { ...linkedUpdateFlash };
        affected.forEach((i) => (nextFlash[i] = now));
        set({ doc: { ...doc, outputs }, isDirty: true, linkedUpdateFlash: nextFlash });
        get().pushHistory();
      },

      updateElementsSilent: (ids, updates) => {
        if (isVideoMode()) return;
        const { doc, currentOutput, editFormatOnly, linkedUpdateFlash } = get();
        const { outputs, affected } = applyLinked(doc, currentOutput, new Set(ids), updates, editFormatOnly);
        const now = Date.now();
        const nextFlash: Record<number, number> = { ...linkedUpdateFlash };
        affected.forEach((i) => (nextFlash[i] = now));
        set({ doc: { ...doc, outputs }, isDirty: true, linkedUpdateFlash: nextFlash });
      },

      removeElement: (id) => {
        if (isVideoMode()) return;
        const { selectedIds } = get();
        set({
          doc: { ...get().doc, outputs: withActiveChildren(activeImage().children.filter((el) => el.id !== id)) },
          isDirty: true, selectedIds: selectedIds.filter((s) => s !== id),
        });
        get().pushHistory();
      },

      removeElements: (ids) => {
        if (isVideoMode()) return;
        if (!ids.length) return;
        const remove = new Set(ids);
        const { selectedIds } = get();
        set({
          doc: { ...get().doc, outputs: withActiveChildren(activeImage().children.filter((el) => !remove.has(el.id))) },
          isDirty: true, selectedIds: selectedIds.filter((s) => !remove.has(s)),
        });
        get().pushHistory();
      },

      duplicateElement: (id) => {
        if (isVideoMode()) return;
        const children = activeImage().children;
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

      setOutputBackground: (bg) => {
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
        get().pushHistory();
      },

      copySelection: () => {
        if (isVideoMode()) return;
        const { selectedIds } = get();
        set({ clipboard: JSON.parse(JSON.stringify(activeImage().children.filter((el) => selectedIds.includes(el.id)))) });
      },

      cutSelection: () => {
        if (isVideoMode()) return;
        const { selectedIds } = get();
        const picked = activeImage().children.filter((el) => selectedIds.includes(el.id));
        if (!picked.length) return;
        set({
          clipboard: JSON.parse(JSON.stringify(picked)),
          doc: { ...get().doc, outputs: withActiveChildren(activeImage().children.filter((el) => !selectedIds.includes(el.id))) },
          selectedIds: [], isDirty: true,
        });
        get().pushHistory();
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
        set({ doc: { ...get().doc, outputs: withActiveChildren([...activeImage().children, ...pasted]) }, selectedIds: pasted.map((el) => el.id), isDirty: true });
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
        const { doc, currentOutput, selectedIds } = get();
        const out = doc.outputs[currentOutput] as DesignerOutput;
        if (!('children' in out) || selectedIds.length === 0) return;

        const members = out.children.filter((c) => selectedIds.includes(c.id));
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
            ? {
                ...(o as DesignerOutput),
                children: [
                  ...(o as DesignerOutput).children.filter((c) => !selectedIds.includes(c.id)),
                  instance,
                ],
              }
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

      groupSelection: () => {
        if (isVideoMode()) return;
        const { selectedIds } = get();
        // One layer is groupable — Photoshop's Layer ▸ Group Layers wraps a
        // single selection too. Only New ▸ Group from Layers is plural-only.
        if (selectedIds.length < 1) return;

        const children = activeImage().children;
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
      ungroupSelection: () => {
        if (isVideoMode()) return;
        const { selectedIds } = get();
        const children = activeImage().children;

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
        const next = moveLayers(activeImage().children, ids, targetIndex, parentId);
        if (next === activeImage().children) return;
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
        const children = activeImage().children;
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
          activeImage().children.map((el) => (ids.includes(el.id) ? { ...el, blendMode } : el))
        ) }, isDirty: true });
        get().pushHistory();
      },

      toggleGroupCollapsed: (id) => {
        if (isVideoMode()) return;
        // Panel-only state, so no history entry — collapsing a folder is not an
        // edit anyone wants to undo.
        set({ doc: { ...get().doc, outputs: withActiveChildren(
          activeImage().children.map((el) => (el.id === id ? { ...el, collapsed: !el.collapsed } : el))
        ) } });
      },

      reorder: (ids, dir) => {
        if (isVideoMode()) return;
        const children = [...activeImage().children];
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
        set({ currentOutput: index, selectedIds: [] });
      },

      addOutput: (preset) => {
        if (isVideoMode()) return;
        const { doc, currentOutput } = get();
        const source = doc.outputs[currentOutput] as DesignerOutput;
        const sourceChildren = source.children.map((el) => (el.originId ? el : { ...el, originId: genId() }));
        const groupBoxes = computeGroupBoxes(sourceChildren);
        const children = sourceChildren.map((el) =>
          seedCopy(el, source, { ...preset, id: '', background: '#fff', children: [] } as DesignerOutput, el.originId as string, el.groupId ? groupBoxes.get(el.groupId) : undefined),
        );
        const newOutput: DesignerOutput = {
          id: genId(), formatId: preset.formatId, name: preset.name,
          width: preset.width, height: preset.height,
          background: source.background, bg: source.bg, children,
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
        set({ doc: { ...doc, outputs: outs }, currentOutput: Math.max(0, Math.min(currentOutput, outs.length - 1)), selectedIds: [], isDirty: true });
        get().pushHistory();
      },

      resizeOutput: (index, width, height, formatId, name) => {
        if (isVideoMode()) return;
        const { doc } = get();
        const out = doc.outputs[index] as DesignerOutput;
        if (!out) return;
        const resized: DesignerOutput = { ...out, width, height, formatId: formatId ?? out.formatId, name: name ?? out.name };
        const groupBoxes = computeGroupBoxes(out.children);
        resized.children = out.children.map((el) => seedCopy(el, out, resized, el.originId || el.id, el.groupId ? groupBoxes.get(el.groupId) : undefined));
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
          activeImage().children.map((el) => (el.id === id ? { ...el, originId: undefined } : el))
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
        const { history, historyIndex, savedHistoryIndex, currentOutput } = get();
        if (index < 0 || index >= history.length || index === historyIndex) return;
        const nextDoc = JSON.parse(JSON.stringify(history[index]));
        set({
          doc: nextDoc,
          historyIndex: index,
          selectedIds: [],
          isDirty: index !== savedHistoryIndex,
          currentOutput: Math.max(0, Math.min(currentOutput, (nextDoc.outputs?.length ?? 1) - 1)),
        });
      },

      undo: () => {
        const { historyIndex, history, savedHistoryIndex, currentOutput } = get();
        if (historyIndex <= 0) return;
        const newIndex = historyIndex - 1;
        const nextDoc = JSON.parse(JSON.stringify(history[newIndex]));
        set({
          doc: nextDoc,
          historyIndex: newIndex,
          selectedIds: [],
          isDirty: newIndex !== savedHistoryIndex,
          currentOutput: Math.max(0, Math.min(currentOutput, (nextDoc.outputs?.length ?? 1) - 1)),
        });
      },

      redo: () => {
        const { historyIndex, history, savedHistoryIndex, currentOutput } = get();
        if (historyIndex >= history.length - 1) return;
        const newIndex = historyIndex + 1;
        const nextDoc = JSON.parse(JSON.stringify(history[newIndex]));
        set({
          doc: nextDoc,
          historyIndex: newIndex,
          selectedIds: [],
          isDirty: newIndex !== savedHistoryIndex,
          currentOutput: Math.max(0, Math.min(currentOutput, (nextDoc.outputs?.length ?? 1) - 1)),
        });
      },

      markSaved: () => set({ isDirty: false, isSaving: false, lastSaved: new Date(), savedHistoryIndex: get().historyIndex }),
      setSaving: (saving) => set({ isSaving: saving }),

      reset: (w, h) => {
        const newDoc = createEmptyDoc(w, h);
        set({
          doc: newDoc, selectedIds: [], currentOutput: 0, zoom: 1, viewportX: 0, viewportY: 0,
          // Ask the canvas to fit. Bumped here rather than at the call sites so
          // every route into a new document gets it — there are four.
          fitNonce: get().fitNonce + 1,
          history: [JSON.parse(JSON.stringify(newDoc))], historyLabels: ['New'], historyIndex: 0, savedHistoryIndex: 0,
          designId: null, designTemplateId: null, templateId: null,
          designName: 'Untitled Design', isDirty: false, isSaving: false, lastSaved: null,
          editFormatOnly: false,
          brandEnforcement: false,
          brandAdminOverride: false,
          playheadMs: 0,
          selectedClip: null,
          linkedUpdateFlash: {},
        });
      },

      loadDesign: (doc, id, name, templateId = null) => {
        const migrated = migrateDoc(doc);
        set({
          doc: migrated, designId: id, designName: name,
          templateId, designTemplateId: templateId,
          selectedIds: [], currentOutput: 0,
          // The zoom and viewport belonged to whatever was open before. Reset
          // them and ask for a fit: leaving a stale zoom on screen for a frame
          // before the fit lands reads as a flash.
          zoom: 1, viewportX: 0, viewportY: 0,
          fitNonce: get().fitNonce + 1,
          history: [JSON.parse(JSON.stringify(migrated))], historyLabels: ['Open'], historyIndex: 0, savedHistoryIndex: 0, isDirty: false,
          playheadMs: 0,
          selectedClip: null,
          linkedUpdateFlash: {},
          brandAdminOverride: false,
        });
      },

      // --- Video mode actions ---

      addTrack: (outputIndex, type) => {
        const { doc } = get();
        const vo = doc.outputs[outputIndex] as VideoOutput | undefined;
        if (!vo || doc.mode !== 'video') return;
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
        // Explicit 60 s cap: reject clips that would exceed the output duration.
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
        const { doc } = get();
        const vo = doc.outputs[outputIndex] as VideoOutput | undefined;
        if (!vo || doc.mode !== 'video') return;
        const updated: VideoOutput = {
          ...vo,
          tracks: vo.tracks.map((t) =>
            t.id === trackId ? { ...t, clips: t.clips.filter((c) => c.id !== clipId) } : t
          ),
        };
        const outs = [...doc.outputs];
        outs[outputIndex] = updated;
        set({ doc: { ...doc, outputs: outs }, isDirty: true });
        get().pushHistory();
      },

      updateClip: (outputIndex, trackId, clipId, updates) => {
        const { doc } = get();
        const vo = doc.outputs[outputIndex] as VideoOutput | undefined;
        if (!vo || doc.mode !== 'video') return;
        const track = vo.tracks.find((t) => t.id === trackId);
        const clip = track?.clips.find((c) => c.id === clipId);
        if (!clip) return;
        const nextStart = updates.startMs ?? clip.startMs;
        const nextEnd = updates.endMs ?? clip.endMs;
        // Explicit 60 s cap: reject updates that would push the clip beyond the output duration.
        if (nextEnd > vo.durationMs || nextStart >= vo.durationMs || nextEnd <= nextStart) {
          return;
        }
        const updated: VideoOutput = {
          ...vo,
          tracks: vo.tracks.map((t) =>
            t.id === trackId
              ? { ...t, clips: t.clips.map((c) => (c.id === clipId ? { ...c, ...updates } : c)) }
              : t
          ),
        };
        const outs = [...doc.outputs];
        outs[outputIndex] = updated;
        set({ doc: { ...doc, outputs: outs }, isDirty: true });
      },

      setVideoDuration: (outputIndex, durationMs) => {
        const { doc } = get();
        const vo = doc.outputs[outputIndex] as VideoOutput | undefined;
        if (!vo || doc.mode !== 'video') return;
        const clamped = Math.max(1000, Math.min(60000, durationMs));
        const updated: VideoOutput = { ...vo, durationMs: clamped };
        const outs = [...doc.outputs];
        outs[outputIndex] = updated;
        set({ doc: { ...doc, outputs: outs }, isDirty: true });
        get().pushHistory();
      },

      splitClip: (outputIndex, trackId, clipId, atMs) => {
        const { doc } = get();
        const vo = doc.outputs[outputIndex] as VideoOutput | undefined;
        if (!vo || doc.mode !== 'video') return;
        const updated: VideoOutput = {
          ...vo,
          tracks: vo.tracks.map((t) => {
            if (t.id !== trackId) return t;
            const idx = t.clips.findIndex((c) => c.id === clipId);
            if (idx < 0) return t;
            const original = t.clips[idx];
            const splitPoint = Math.max(original.startMs + 100, Math.min(original.endMs - 100, atMs));
            if (splitPoint <= original.startMs || splitPoint >= original.endMs) return t;
            const first: VideoClip = { ...original, id: genId(), endMs: splitPoint };
            // The second half must advance its source trim-in so it continues from
            // where the first half ended, otherwise it replays the source from 0
            // (sourceTimeForPlayhead adds trimInMs). Applies even when the original
            // had no trimIn.
            const second: VideoClip = { ...original, id: genId(), startMs: splitPoint, trimInMs: (original.trimInMs ?? 0) + (splitPoint - original.startMs) };
            const clips = [...t.clips];
            clips.splice(idx, 1, first, second);
            return { ...t, clips };
          }),
        };
        const outs = [...doc.outputs];
        outs[outputIndex] = updated;
        set({ doc: { ...doc, outputs: outs }, isDirty: true });
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
            durationMs: preset?.maxDurationMs ?? 10000,
            tracks: [{ id: trackId, type: 'video', clips: [] }],
          };
          set({ doc: { ...doc, mode: 'video', outputs: [vo] }, selectedIds: [], selectedClip: null, currentOutput: 0, isDirty: true });
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
          set({ doc: { ...doc, mode: 'image', outputs: [imgOut] }, selectedIds: [], selectedClip: null, currentOutput: 0, isDirty: true });
        }
        get().pushHistory();
      },

      setPlayhead: (ms) => set({ playheadMs: ms }),

      setSelectedClip: (clip) => {
        set({ selectedClip: clip, selectedIds: clip ? [] : [] });
      },

      setTrackGain: (outputIndex, trackId, gain) => {
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
      },

    };
  });
