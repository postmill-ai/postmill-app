'use client';

import { useMemo } from 'react';
import type { DesignerOutput, DesignerElement } from './designer.store';
import { addText as addTextTo } from './add-text';
import {
  FILTER_FAMILY_ORDER,
  FILTER_FAMILY_LABELS,
  filtersInFamily,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/filter-descriptors';
import { layerActions } from './layer-actions';

type DesignerStoreApi = ReturnType<
  typeof import('./designer.store').createDesignerStore
>;

export type DesignerMenu =
  | 'file'
  | 'edit'
  | 'view'
  | 'insert'
  | 'layer'
  | 'select'
  | 'filter'
  | 'tools'
  | 'help';

export interface DesignerAction {
  id: string;
  label: string | (() => string);
  menu: DesignerMenu;
  /** Groups items into a flyout sub-menu (e.g. 'New', 'Align', 'Arrange', 'Upscale'). */
  submenu?: string;
  /**
   * Deeper nesting, outermost first — e.g. `['New', 'Layer']` renders as
   * `Layer ▸ New ▸ Layer`. Takes precedence over `submenu`.
   */
  submenuPath?: string[];
  /** Divider key — a new value vs the previous item draws a separator. */
  group?: string;
  /** Display-only shortcut hint (the real keys live on the canvas / window handlers). */
  shortcut?: string;
  keywords?: string[];
  /** Read live state at call time — never close over a stale snapshot. */
  enabled?: () => boolean;
  checked?: () => boolean;
  run: () => void;
}

/**
 * UI state + modal/callback bridge the store can't own. Built in designer.tsx
 * and passed in fresh each render so `checked()`/`enabled()` see live values.
 */
export interface DesignerActionCtx {
  // live UI toggle values (designer-local)
  showSafeZones: boolean;
  showRulers: boolean;
  aiActive: boolean;
  // Per-operation media-tool availability (the single status signal). Optimistic/fail-open:
  // returns true while loading or on a status outage, so a hiccup never greys every tool.
  // Undefined ctx → treat as available. detect-subject deliberately stays on `aiActive`
  // (it is AI-vision with a non-fatal center fallback, not a media-provider operation).
  mediaOperationAvailable?: (operation: string) => boolean;
  /**
   * Availability by TOOL category (text-to-video, text-to-music, …). A separate
   * accessor from the operations one above because they read different halves of
   * the media-tools status payload — reusing the wrong one reports everything as
   * available.
   */
  mediaToolAvailable?: (category: string) => boolean;
  canShare: boolean;
  collabEnabled: boolean;
  inModal: boolean; // setMedia/closeModal present
  // callbacks
  onNew: (mode: 'image' | 'video') => void;
  onNewCustom: () => void;
  onOpenDesigns: () => void;
  onBrowseTemplates: () => void;
  onSave: () => void;
  onSaveAsTemplate: () => void;
  onOpenMedia: () => void;
  onExport: () => void;
  onUseInPost?: () => void;
  onClose?: () => void;
  onCanvasProperties: () => void;
  onTogglePanel: (id: string) => void;
  onToggleInspector: () => void;
  onToggleSafeZones: () => void;
  onToggleRulers: () => void;
  onToggleSnap: () => void;
  onFitToScreen: () => void;
  onActualSize: () => void;
  onShortcuts: () => void;
  onConvertMode: () => void;
  onToggleShare: () => void;
  // Pixel operations — Select, Edit ▸ Fill/Stroke and the Filter menu. The host
  // owns them because they need the Konva stage (to rasterize) and modals (to
  // ask before rasterizing, and to collect parameters).
  onSelectAll: () => void;
  onSelectInverse: () => void;
  /** False when nothing is selected, or the selection can't take pixels. */
  canEditPixels: () => boolean;
  onFill: () => void;
  onStroke: () => void;
  /** Open (or immediately run) a filter by id. */
  onFilter: (id: string) => void;
  onLastFilter: () => void;
  hasLastFilter: () => boolean;
  lastFilterLabel: () => string;
  // AI image tools (operate on the single selected image)
  onAiGenerate: () => void;
  onAiRemoveBg: () => void;
  onAiUpscale: (scale: number) => void;
  onAiInpaint: () => void;
  onAiDetectSubject: () => void;
}

const resolveLabel = (a: DesignerAction): string =>
  typeof a.label === 'function' ? a.label() : a.label;

export const actionLabel = resolveLabel;

const MENU_LABELS: Record<DesignerMenu, string> = {
  file: 'File',
  edit: 'Edit',
  view: 'View',
  insert: 'Insert',
  layer: 'Layer',
  select: 'Select',
  filter: 'Filter',
  tools: 'Tools',
  help: 'Help',
};

export const menuLabel = (m: DesignerMenu) => MENU_LABELS[m];

const MENU_LABEL_KEYS: Record<DesignerMenu, string> = {
  file: 'designer_menu_file',
  edit: 'designer_menu_edit',
  view: 'designer_menu_view',
  insert: 'designer_menu_insert',
  layer: 'designer_menu_layer',
  select: 'designer_menu_select',
  filter: 'designer_menu_filter',
  tools: 'designer_menu_tools',
  help: 'designer_menu_help',
};

/** i18n key for a top-level menu label — used at render sites (menu-bar, command-palette). */
export const menuLabelKey = (m: DesignerMenu) => MENU_LABEL_KEYS[m];

const SUBMENU_LABEL_KEYS: Record<string, string> = {
  New: 'designer_submenu_new',
  Format: 'designer_menu_format',
  'Generate Audio': 'designer_submenu_generate_audio',
  Options: 'designer_menu_options',
  Upscale: 'designer_submenu_upscale',
};

/** i18n key for a submenu heading (e.g. New / Align / Arrange / Upscale). */
export const submenuLabelKey = (name: string) =>
  SUBMENU_LABEL_KEYS[name] ?? `designer_submenu_${slugLabel(name)}`;

// Labels that already have a reusable i18n key elsewhere in the app — avoid coining a
// duplicate key for the exact same English word.
const REUSED_ACTION_LABEL_KEYS: Record<string, string> = {
  Image: 'provider_chip_image',
  Video: 'provider_chip_video',
  Text: 'provider_chip_text',
  Save: 'save',
  'Save as Template': 'save_as_template',
  Close: 'close',
  Copy: 'copy',
  Delete: 'delete',
  Group: 'group',
  AI: 'ai',
};

const slugLabel = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'label';

/**
 * i18n key for a menu action's *current* label — id-scoped so it never collides across
 * actions, and includes the resolved text so state-dependent labels (e.g. Lock/Unlock,
 * Convert to Video/Image Mode) resolve to distinct keys per state. Data-only helper (no
 * hook call) — actions.ts stays a plain data module; translation happens at the render
 * site (menu-bar.tsx / command-palette.tsx) via `t(actionLabelKey(action), actionLabel(action))`.
 */
export const actionLabelKey = (a: DesignerAction): string => {
  const label = resolveLabel(a);
  return REUSED_ACTION_LABEL_KEYS[label] ?? `designer_action_${a.id.replace(/-/g, '_')}_${slugLabel(label)}`;
};

/** Top-level menu order (drives the bar + the mobile overflow split). */
/** The Designer's page on the public docs site (`docs/user-guide/media/designer.md`). */
export const DESIGNER_DOCS_URL = 'https://docs.postmill.ai/user-guide/media/designer';

export const MENU_ORDER: DesignerMenu[] = [
  'file',
  'edit',
  'view',
  'insert',
  'layer',
  'select',
  'filter',
  'tools',
  'help',
];

export const useDesignerActions = (
  store: DesignerStoreApi,
  ctx: DesignerActionCtx
): DesignerAction[] => {
  return useMemo(() => {
    // Per-operation media availability (optimistic/fail-open default: available).
    const mediaOp = (operation: string): boolean =>
      ctx.mediaOperationAvailable?.(operation) ?? true;
    const mediaTool = (category: string) =>
      ctx.mediaToolAvailable?.(category) ?? true;
    const isVideoDoc = () => store.getState().doc.mode === 'video';
    // Live derivation — call inside run/enabled/checked, never cache.
    const live = () => {
      const st = store.getState();
      const out = st.doc.outputs[st.currentOutput] as DesignerOutput | undefined;
      const children =
        out && 'children' in out ? (out as DesignerOutput).children : [];
      const selectedEls = children.filter((c) => st.selectedIds.includes(c.id));
      return {
        st,
        out,
        children,
        selectedEls,
        hasSelection: st.selectedIds.length > 0,
        singleImageSelected:
          selectedEls.length === 1 && selectedEls[0].type === 'image',
        mode: st.doc.mode,
      };
    };

    // Works in both modes: an image doc gets an element, a video doc gets a text
    // clip on its text track. See `add-text.ts`.
    const addText = () => {
      addTextTo(store as never);
    };

    const addShape = () => {
      const st = store.getState();
      const out = st.doc.outputs[st.currentOutput];
      st.addElement({
        id: '',
        type: 'shape',
        shape: 'rect',
        x: out.width / 2 - 50,
        y: out.height / 2 - 50,
        width: 100,
        height: 100,
        rotation: 0,
        opacity: 1,
        locked: false,
        hidden: false,
        fill: '#2B5CD3',
      });
    };

    const alignSelected = (fn: (el: DesignerElement, out: DesignerOutput) => Partial<DesignerElement>) => {
      const st = store.getState();
      const out = st.doc.outputs[st.currentOutput] as DesignerOutput;
      st.selectedIds.forEach((id) => {
        const el = out.children.find((c) => c.id === id);
        if (el) st.updateElement(id, fn(el, out));
      });
    };

    const a: DesignerAction[] = [
      // ---------------- File ----------------
      { id: 'new-image', label: 'Image', menu: 'file', submenu: 'New', keywords: ['new', 'blank'], run: () => ctx.onNew('image') },
      { id: 'new-video', label: 'Video', menu: 'file', submenu: 'New', keywords: ['new', 'video'], run: () => ctx.onNew('video') },
      { id: 'new-custom', label: 'Custom Size…', menu: 'file', submenu: 'New', keywords: ['new', 'custom', 'size'], run: ctx.onNewCustom },
      { id: 'open-design', label: 'Open Design…', menu: 'file', group: 'open', keywords: ['open', 'my designs'], run: ctx.onOpenDesigns },
      { id: 'browse-templates', label: 'Browse Templates…', menu: 'file', group: 'open', keywords: ['template', 'browse'], run: ctx.onBrowseTemplates },
      { id: 'save', label: 'Save', menu: 'file', group: 'save', shortcut: '⌘S', keywords: ['save'], run: ctx.onSave },
      { id: 'save-as-template', label: 'Save as Template', menu: 'file', group: 'save', keywords: ['template', 'save as'], run: ctx.onSaveAsTemplate },
      { id: 'import-media', label: 'Import Media…', menu: 'file', group: 'io', keywords: ['import', 'media', 'upload'], run: ctx.onOpenMedia },
      { id: 'export', label: 'Export…', menu: 'file', group: 'io', shortcut: '⌘E', keywords: ['export', 'download'], run: ctx.onExport },
      ...(ctx.onUseInPost ? [{ id: 'use-in-post', label: 'Use in Post', menu: 'file' as const, group: 'io', keywords: ['post', 'use'], run: ctx.onUseInPost }] : []),
      ...(ctx.onClose ? [{ id: 'close', label: 'Close', menu: 'file' as const, group: 'close', keywords: ['close', 'exit'], run: ctx.onClose }] : []),

      // ---------------- Edit ----------------
      { id: 'undo', label: 'Undo', menu: 'edit', shortcut: '⌘Z', keywords: ['undo'], enabled: () => store.getState().historyIndex > 0, run: () => store.getState().undo() },
      { id: 'redo', label: 'Redo', menu: 'edit', shortcut: '⇧⌘Z', keywords: ['redo'], enabled: () => { const s = store.getState(); return s.historyIndex < s.history.length - 1; }, run: () => store.getState().redo() },
      { id: 'cut', label: 'Cut', menu: 'edit', group: 'clip', shortcut: '⌘X', keywords: ['cut'], enabled: () => live().hasSelection, run: () => store.getState().cutSelection() },
      { id: 'copy', label: 'Copy', menu: 'edit', group: 'clip', shortcut: '⌘C', keywords: ['copy'], enabled: () => live().hasSelection, run: () => store.getState().copySelection() },
      { id: 'paste', label: 'Paste', menu: 'edit', group: 'clip', shortcut: '⌘V', keywords: ['paste'], enabled: () => store.getState().clipboard.length > 0, run: () => store.getState().paste() },
      { id: 'duplicate', label: 'Duplicate', menu: 'edit', group: 'clip', keywords: ['duplicate'], enabled: () => live().hasSelection, run: () => { const st = store.getState(); st.selectedIds.forEach((id) => st.duplicateElement(id)); } },
      { id: 'delete', label: 'Delete', menu: 'edit', group: 'clip', keywords: ['delete', 'remove'], enabled: () => live().hasSelection, run: () => { const st = store.getState(); [...st.selectedIds].forEach((id) => st.removeElement(id)); } },
      { id: 'fill', label: 'Fill…', menu: 'edit', group: 'pixels', shortcut: '⇧F5', keywords: ['fill', 'color', 'pattern'], enabled: () => ctx.canEditPixels(), run: () => ctx.onFill() },
      { id: 'stroke', label: 'Stroke…', menu: 'edit', group: 'pixels', keywords: ['stroke', 'outline', 'border'], enabled: () => ctx.canEditPixels(), run: () => ctx.onStroke() },

      // ---------------- Select ----------------
      // Photoshop's Select menu acts on the PIXEL selection; the two layer
      // commands that used to sit in Edit move here as All/Deselect Layers.
      { id: 'select-all-pixels', label: 'All', menu: 'select', group: 'pixels', shortcut: '⌘A', keywords: ['select all', 'everything'], run: () => ctx.onSelectAll() },
      { id: 'select-deselect', label: 'Deselect', menu: 'select', group: 'pixels', shortcut: '⌘D', keywords: ['deselect', 'none'], enabled: () => !!store.getState().selection, run: () => store.getState().setSelection(null) },
      { id: 'select-reselect', label: 'Reselect', menu: 'select', group: 'pixels', shortcut: '⇧⌘D', keywords: ['reselect', 'restore'], enabled: () => !store.getState().selection && !!store.getState().lastSelection, run: () => { const st = store.getState(); if (st.lastSelection) st.setSelection(st.lastSelection); } },
      { id: 'select-inverse', label: 'Inverse', menu: 'select', group: 'pixels', shortcut: '⇧⌘I', keywords: ['inverse', 'invert selection'], enabled: () => !!store.getState().selection, run: () => ctx.onSelectInverse() },
      { id: 'select-all-layers', label: 'All Layers', menu: 'select', group: 'layers', shortcut: '⌥⌘A', keywords: ['select all layers'], run: () => { const st = store.getState(); const out = st.doc.outputs[st.currentOutput] as DesignerOutput; if ('children' in out) st.setSelectedIds(out.children.filter((c) => !c.hidden).map((c) => c.id)); } },
      { id: 'select-deselect-layers', label: 'Deselect Layers', menu: 'select', group: 'layers', keywords: ['deselect layers'], enabled: () => live().hasSelection, run: () => store.getState().setSelectedIds([]) },

      // ---------------- Filter ----------------
      // Generated from the descriptor table so the menu and the implementations
      // cannot drift; each family becomes a submenu, as Photoshop lays them out.
      { id: 'filter-last', label: ctx.lastFilterLabel, menu: 'filter', group: 'last', shortcut: '⌃⌘F', keywords: ['last filter', 'repeat'], enabled: () => ctx.hasLastFilter() && ctx.canEditPixels(), run: ctx.onLastFilter },
      ...FILTER_FAMILY_ORDER.flatMap((family) =>
        filtersInFamily(family).map((f) => ({
          id: `filter-${f.id}`,
          label: f.label,
          menu: 'filter' as const,
          submenuPath: [FILTER_FAMILY_LABELS[family]],
          group: family,
          keywords: ['filter', family, f.label.toLowerCase()],
          enabled: () => ctx.canEditPixels(),
          run: () => ctx.onFilter(f.id),
        }))
      ),

      // ---------------- View ----------------
      { id: 'zoom-in', label: 'Zoom In', menu: 'view', group: 'zoom', keywords: ['zoom in'], run: () => { const st = store.getState(); st.setZoom(st.zoom * 1.2); } },
      { id: 'zoom-out', label: 'Zoom Out', menu: 'view', group: 'zoom', keywords: ['zoom out'], run: () => { const st = store.getState(); st.setZoom(st.zoom / 1.2); } },
      { id: 'fit-screen', label: 'Fit to Screen', menu: 'view', group: 'zoom', keywords: ['fit', 'screen'], run: ctx.onFitToScreen },
      { id: 'actual-size', label: 'Actual Size (100%)', menu: 'view', group: 'zoom', keywords: ['actual', '100', 'reset zoom'], run: ctx.onActualSize },
      { id: 'view-safe-zones', label: 'Safe Zones', menu: 'view', group: 'overlay', keywords: ['safe zones'], checked: () => ctx.showSafeZones, run: ctx.onToggleSafeZones },
      { id: 'view-rulers', label: 'Rulers', menu: 'view', group: 'overlay', keywords: ['rulers'], checked: () => ctx.showRulers, run: ctx.onToggleRulers },
      { id: 'command-palette', label: 'Command Palette', menu: 'view', group: 'cmd', shortcut: '⌘K', keywords: ['command', 'palette'], run: () => { if (typeof window !== 'undefined') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true })); } },

      // ---------------- Insert ----------------
      { id: 'insert-text', label: 'Text', menu: 'insert', keywords: ['text'], run: addText },
      { id: 'insert-shape', label: 'Shape', menu: 'insert', keywords: ['shape', 'rectangle'], enabled: () => live().mode === 'image', run: addShape },
      { id: 'insert-image', label: 'Image…', menu: 'insert', keywords: ['image', 'photo'], enabled: () => live().mode === 'image', run: ctx.onOpenMedia },
      { id: 'insert-icon', label: 'Icon', menu: 'insert', keywords: ['icon'], run: () => ctx.onTogglePanel('icons') },

      // ---------------- Format ----------------
      { id: 'canvas-properties', label: 'Canvas Properties…', menu: 'file', submenuPath: ['Format'], group: 'canvas', keywords: ['canvas', 'properties', 'size', 'background'], run: ctx.onCanvasProperties },
      { id: 'align-left', label: 'Left', menu: 'file', submenuPath: ['Format'], group: 'align', keywords: ['align left'], enabled: () => live().hasSelection, run: () => alignSelected(() => ({ x: 0 })) },
      { id: 'align-center-h', label: 'Center', menu: 'file', submenuPath: ['Format'], group: 'align', keywords: ['align center'], enabled: () => live().hasSelection, run: () => alignSelected((el, out) => ({ x: (out.width - el.width) / 2 })) },
      { id: 'align-right', label: 'Right', menu: 'file', submenuPath: ['Format'], group: 'align', keywords: ['align right'], enabled: () => live().hasSelection, run: () => alignSelected((el, out) => ({ x: out.width - el.width })) },
      { id: 'align-top', label: 'Top', menu: 'file', submenuPath: ['Format'], group: 'align', keywords: ['align top'], enabled: () => live().hasSelection, run: () => alignSelected(() => ({ y: 0 })) },
      { id: 'align-middle', label: 'Middle', menu: 'file', submenuPath: ['Format'], group: 'align', keywords: ['align middle'], enabled: () => live().hasSelection, run: () => alignSelected((el, out) => ({ y: (out.height - el.height) / 2 })) },
      { id: 'align-bottom', label: 'Bottom', menu: 'file', submenuPath: ['Format'], group: 'align', keywords: ['align bottom'], enabled: () => live().hasSelection, run: () => alignSelected((el, out) => ({ y: out.height - el.height })) },
      // ── Layer menu ────────────────────────────────────────────────────────
      // Group / Ungroup / Lock live here rather than on Format, matching
      // Photoshop and keeping one home per command (the ⌘K palette flattens
      // submenus, so duplicates there read as ambiguous).
      ...layerActions(store, live),

      { id: 'bring-front', label: 'Bring to Front', menu: 'file', submenuPath: ['Format'], group: 'arrange', keywords: ['front', 'order'], enabled: () => live().hasSelection, run: () => { const st = store.getState(); st.reorder(st.selectedIds, 'front'); } },
      { id: 'bring-forward', label: 'Bring Forward', menu: 'file', submenuPath: ['Format'], group: 'arrange', keywords: ['forward', 'order'], enabled: () => live().hasSelection, run: () => { const st = store.getState(); st.reorder(st.selectedIds, 'forward'); } },
      { id: 'send-backward', label: 'Send Backward', menu: 'file', submenuPath: ['Format'], group: 'arrange', keywords: ['backward', 'order'], enabled: () => live().hasSelection, run: () => { const st = store.getState(); st.reorder(st.selectedIds, 'backward'); } },
      { id: 'send-back', label: 'Send to Back', menu: 'file', submenuPath: ['Format'], group: 'arrange', keywords: ['back', 'order'], enabled: () => live().hasSelection, run: () => { const st = store.getState(); st.reorder(st.selectedIds, 'back'); } },
      { id: 'convert-mode', label: () => (store.getState().doc.mode === 'image' ? 'Convert to Video Mode' : 'Convert to Image Mode'), menu: 'file', submenuPath: ['Format'], group: 'mode', keywords: ['convert', 'video', 'image', 'mode'], run: ctx.onConvertMode },

      // ---------------- Options ----------------
      { id: 'opt-snap', label: 'Snap to Guides', menu: 'file', submenuPath: ['Options'], group: 'overlay', keywords: ['snap', 'guides'], checked: () => store.getState().snapEnabled, run: ctx.onToggleSnap },
      { id: 'opt-format-only', label: 'Edit Format Only', menu: 'file', submenuPath: ['Options'], group: 'edit', keywords: ['format only', 'all formats'], checked: () => store.getState().editFormatOnly, run: () => { const st = store.getState(); st.setEditFormatOnly(!st.editFormatOnly); } },
      { id: 'opt-brand', label: 'Brand Enforcement', menu: 'file', submenuPath: ['Options'], group: 'edit', keywords: ['brand'], checked: () => store.getState().brandEnforcement, run: () => { const st = store.getState(); st.setBrandEnforcement(!st.brandEnforcement); } },

      // ---------------- Tools ----------------
      { id: 'ai-generate', label: 'Generate Image…', menu: 'tools', group: 'gen', keywords: ['ai', 'generate', 'image'], enabled: () => mediaOp('image'), run: ctx.onAiGenerate },
      // Video-document generation. The dialogs live on the timeline, which owns
      // the logic for landing a finished asset onto a track — the menu asks it
      // to open one rather than duplicating any of that.
      { id: 'gen-video', label: 'Generate Video…', menu: 'tools', group: 'gen', keywords: ['ai', 'generate', 'video'], enabled: () => isVideoDoc() && mediaTool('text-to-video'), run: () => store.getState().requestGenerate('video') },
      { id: 'gen-audio-music', label: 'Music…', menu: 'tools', submenuPath: ['Generate Audio'], group: 'gen', keywords: ['ai', 'generate', 'audio', 'music', 'soundtrack'], enabled: () => isVideoDoc() && mediaTool('text-to-music'), run: () => store.getState().requestGenerate('music') },
      { id: 'gen-audio-voiceover', label: 'Voiceover…', menu: 'tools', submenuPath: ['Generate Audio'], group: 'gen', keywords: ['ai', 'generate', 'audio', 'voiceover', 'speech', 'tts'], enabled: () => isVideoDoc() && mediaOp('tts'), run: () => store.getState().requestGenerate('voiceover') },
      { id: 'ai-remove-bg', label: 'Remove Background', menu: 'tools', group: 'ai', keywords: ['ai', 'background', 'remove'], enabled: () => mediaOp('bg-remove') && live().singleImageSelected, run: ctx.onAiRemoveBg },
      { id: 'ai-upscale-2x', label: '2×', menu: 'tools', submenu: 'Upscale', group: 'ai', keywords: ['ai', 'upscale'], enabled: () => mediaOp('upscale') && live().singleImageSelected, run: () => ctx.onAiUpscale(2) },
      { id: 'ai-upscale-4x', label: '4×', menu: 'tools', submenu: 'Upscale', group: 'ai', keywords: ['ai', 'upscale'], enabled: () => mediaOp('upscale') && live().singleImageSelected, run: () => ctx.onAiUpscale(4) },
      { id: 'ai-inpaint', label: 'Inpaint…', menu: 'tools', group: 'ai', keywords: ['ai', 'inpaint'], enabled: () => mediaOp('inpaint') && live().singleImageSelected, run: ctx.onAiInpaint },
      { id: 'ai-detect-subject', label: 'Auto-detect Subject', menu: 'tools', group: 'ai2', keywords: ['ai', 'subject', 'focal'], enabled: () => ctx.aiActive && live().singleImageSelected, run: ctx.onAiDetectSubject },
      { id: 'replace-image', label: 'Replace Image…', menu: 'tools', group: 'ai2', keywords: ['replace', 'image'], enabled: () => live().singleImageSelected, run: ctx.onOpenMedia },

      // ---------------- Window ----------------
      { id: 'win-templates', label: 'Templates', menu: 'view', group: 'win-panels', keywords: ['templates'], run: ctx.onBrowseTemplates },
      { id: 'win-layers', label: 'Layers', menu: 'view', group: 'win-panels', keywords: ['layers'], run: () => ctx.onTogglePanel('layers') },
      { id: 'win-brand', label: 'Brand', menu: 'view', group: 'win-panels', keywords: ['brand'], run: () => ctx.onTogglePanel('brand') },
      { id: 'win-inspector', label: 'Properties / Inspector', menu: 'view', group: 'win-panels', keywords: ['inspector', 'properties'], run: ctx.onToggleInspector },
      { id: 'win-icons', label: 'Icons', menu: 'view', group: 'win-panels2', keywords: ['icons'], run: () => ctx.onTogglePanel('icons') },
      ...(ctx.aiActive ? [{ id: 'win-ai', label: 'AI', menu: 'view' as const, group: 'win-panels2', keywords: ['ai'], run: () => ctx.onTogglePanel('ai') }] : []),
      ...(ctx.canShare ? [{ id: 'win-share', label: () => (ctx.collabEnabled ? 'Stop Sharing' : 'Share / Collaborate'), menu: 'view' as const, group: 'win-share', keywords: ['share', 'collaborate'], checked: () => ctx.collabEnabled, run: ctx.onToggleShare }] : []),

      // ---------------- Help ----------------
      { id: 'help-shortcuts', label: 'Keyboard Shortcuts', menu: 'help', shortcut: '?', keywords: ['shortcuts', 'keys', 'help'], run: ctx.onShortcuts },
      { id: 'help-docs', label: 'Designer Documentation', menu: 'help', group: 'docs', keywords: ['docs', 'documentation', 'guide', 'manual', 'help'], run: () => { window.open(DESIGNER_DOCS_URL, '_blank', 'noopener,noreferrer'); } },
    ];

    return a;
  }, [store, ctx]);
};
