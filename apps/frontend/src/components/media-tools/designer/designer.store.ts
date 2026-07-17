import { create } from 'zustand';
import { CHANNEL_PRESETS } from '@gitroom/nestjs-libraries/integrations/social/channel-presets';
import { detectFocalPoint } from './reflow';
import {
  migrateDoc,
  genId,
  matchPreset,
} from '@gitroom/nestjs-libraries/media/designer-doc/designer-doc.migrate';
import { smartReflow } from '@gitroom/nestjs-libraries/media/designer-doc/reflow';
import { seedCopy } from '@gitroom/nestjs-libraries/media/designer-doc/seed-copy';
import { applyLinked, GEOMETRY_KEYS } from '@gitroom/nestjs-libraries/media/designer-doc/apply-linked';
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
} from '@gitroom/nestjs-libraries/media/designer-doc/designer-doc.schema';

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
};
export { migrateDoc };

export interface DesignerState {
  doc: DesignerDoc;
  selectedIds: string[];
  currentOutput: number;
  zoom: number; viewportX: number; viewportY: number;
  history: DesignerDoc[]; historyIndex: number;
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
  setOutputBackground: (bg: DesignerBackground) => void;
  copySelection: () => void; cutSelection: () => void; paste: () => void;
  groupSelection: () => void; ungroupSelection: () => void;
  reorder: (ids: string[], dir: 'front' | 'back' | 'forward' | 'backward') => void;
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
  undo: () => void; redo: () => void; pushHistory: () => void;
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
      version: 2,
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
    version: 2,
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
      currentOutput: 0,
      zoom: 1, viewportX: 0, viewportY: 0,
      history: [JSON.parse(JSON.stringify(initialDoc))], historyIndex: 0,
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
        const el = activeImage().children.find((e) => e.id === id);
        if (!el) return;
        const newEl = { ...JSON.parse(JSON.stringify(el)), id: genId(), originId: genId(), x: el.x + 20, y: el.y + 20 };
        set({ doc: { ...get().doc, outputs: withActiveChildren([...activeImage().children, newEl]) }, isDirty: true, selectedIds: [newEl.id] });
        get().pushHistory();
      },

      setSelectedIds: (ids) => set({ selectedIds: ids }),

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

      groupSelection: () => {
        if (isVideoMode()) return;
        const { selectedIds } = get();
        if (selectedIds.length < 2) return;
        const gid = genId();
        set({ doc: { ...get().doc, outputs: withActiveChildren(
          activeImage().children.map((el) => (selectedIds.includes(el.id) ? { ...el, groupId: gid } : el))
        ) }, isDirty: true });
        get().pushHistory();
      },

      ungroupSelection: () => {
        if (isVideoMode()) return;
        const { selectedIds } = get();
        const groupIds = new Set(activeImage().children.filter((el) => selectedIds.includes(el.id) && el.groupId).map((el) => el.groupId as string));
        if (!groupIds.size) return;
        set({ doc: { ...get().doc, outputs: withActiveChildren(
          activeImage().children.map((el) => (el.groupId && groupIds.has(el.groupId) ? { ...el, groupId: undefined } : el))
        ) }, isDirty: true });
        get().pushHistory();
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
        const children = sourceChildren.map((el) =>
          seedCopy(el, source, { ...preset, id: '', background: '#fff', children: [] } as DesignerOutput, el.originId as string),
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
        resized.children = out.children.map((el) => seedCopy(el, out, resized, el.originId || el.id));
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

      pushHistory: () => {
        const { doc, history, historyIndex, savedHistoryIndex } = get();
        const snapshot = JSON.parse(JSON.stringify(doc));
        const newHistory = history.slice(0, historyIndex + 1);
        newHistory.push(snapshot);
        let savedIdx = savedHistoryIndex;
        if (newHistory.length > 50) {
          newHistory.shift();
          savedIdx -= 1; // indices shifted down; -1 → saved snapshot evicted
        }
        set({ history: newHistory, historyIndex: newHistory.length - 1, savedHistoryIndex: savedIdx });
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
          history: [JSON.parse(JSON.stringify(newDoc))], historyIndex: 0, savedHistoryIndex: 0,
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
          selectedIds: [], currentOutput: 0, zoom: 1,
          history: [JSON.parse(JSON.stringify(migrated))], historyIndex: 0, savedHistoryIndex: 0, isDirty: false,
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
