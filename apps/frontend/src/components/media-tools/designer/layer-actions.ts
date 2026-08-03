import type { DesignerAction } from './actions';
import type { DesignerAdjustment, DesignerElement, DesignerLayerStyle } from './designer.store';
import { defaultAdjustmentValues } from '@postmill-ai/nestjs-libraries/media/designer-doc/pixel-ops';

type StoreApi = ReturnType<typeof import('./designer.store').createDesignerStore>;

/**
 * The Layer menu — Photoshop's, minus the items with no home in this app.
 *
 * Split out of `actions.ts` because it is by far the largest menu (three levels
 * deep, ~45 entries) and would otherwise bury the other nine.
 */

/** Copy buffer for Copy/Paste Layer Style. Editor state, not document state. */
let styleClipboard: DesignerLayerStyle[] | null = null;

const ADJUSTMENTS: { type: DesignerAdjustment['type']; label: string }[] = [
  { type: 'vibrance', label: 'Color and Vibrance' },
  { type: 'clarity-dehaze', label: 'Clarity and Dehaze' },
  { type: 'brightness-contrast', label: 'Brightness/Contrast' },
  { type: 'levels', label: 'Levels' },
  { type: 'curves', label: 'Curves' },
  { type: 'exposure', label: 'Exposure' },
  { type: 'hue-saturation', label: 'Hue/Saturation' },
  { type: 'color-balance', label: 'Color Balance' },
  { type: 'black-white', label: 'Black & White' },
  { type: 'photo-filter', label: 'Photo Filter' },
  { type: 'channel-mixer', label: 'Channel Mixer' },
  { type: 'selective-color', label: 'Selective Color' },
  { type: 'invert', label: 'Invert' },
  { type: 'posterize', label: 'Posterize' },
  { type: 'threshold', label: 'Threshold' },
  { type: 'gradient-map', label: 'Gradient Map' },
];

const STYLES: { type: DesignerLayerStyle['type']; label: string }[] = [
  { type: 'bevel-emboss', label: 'Bevel and Emboss' },
  { type: 'stroke', label: 'Stroke' },
  { type: 'inner-shadow', label: 'Inner Shadow' },
  { type: 'inner-glow', label: 'Inner Glow' },
  { type: 'satin', label: 'Satin' },
  { type: 'color-overlay', label: 'Color Overlay' },
  { type: 'gradient-overlay', label: 'Gradient Overlay' },
  { type: 'pattern-overlay', label: 'Pattern Overlay' },
  { type: 'outer-glow', label: 'Outer Glow' },
  { type: 'drop-shadow', label: 'Drop Shadow' },
];

/** Sensible starting values so a newly added effect is visible, not a no-op. */
const defaultStyle = (type: DesignerLayerStyle['type']): DesignerLayerStyle => {
  const base: DesignerLayerStyle = { type, enabled: true, opacity: 0.75 };
  switch (type) {
    case 'drop-shadow':
      return { ...base, color: '#000000', angle: 120, useGlobalLight: true, distance: 6, size: 8 };
    case 'inner-shadow':
      return { ...base, color: '#000000', angle: 120, useGlobalLight: true, distance: 4, size: 6 };
    case 'outer-glow':
      return { ...base, color: '#ffd966', size: 12, spread: 10 };
    case 'inner-glow':
      return { ...base, color: '#ffffff', size: 10, spread: 8 };
    case 'stroke':
      return { ...base, color: '#000000', size: 3, position: 'outside', opacity: 1 };
    case 'bevel-emboss':
      return { ...base, style: 'inner-bevel', depth: 100, size: 6, soften: 0, angle: 120, useGlobalLight: true, highlightColor: '#ffffff', shadowColor: '#000000' };
    case 'satin':
      return { ...base, color: '#000000', angle: 19, distance: 11, size: 14, opacity: 0.5 };
    case 'color-overlay':
      return { ...base, color: '#2B5CD3', opacity: 1 };
    case 'gradient-overlay':
      return { ...base, opacity: 1, angle: 90, gradient: { type: 'linear', stops: [{ offset: 0, color: '#2B5CD3' }, { offset: 1, color: '#ffffff' }] } };
    case 'pattern-overlay':
      return { ...base, opacity: 1, pattern: { preset: 'dots', scale: 1, color: '#000000', background: '#ffffff' } };
    default:
      return base;
  }
};

export const layerActions = (
  store: StoreApi,
  live: () => { selectedEls: DesignerElement[]; hasSelection: boolean; children: DesignerElement[] }
): DesignerAction[] => {
  const selected = () => store.getState().selectedIds;
  const firstSelected = (): DesignerElement | undefined => live().selectedEls[0];

  /** Add or replace a style on every selected layer. */
  const addStyle = (type: DesignerLayerStyle['type']) => {
    const st = store.getState();
    for (const el of live().selectedEls) {
      const styles = (el.styles || []).filter((s) => s.type !== type);
      st.updateElement(el.id, { styles: [...styles, defaultStyle(type)] });
    }
    st.pushHistory();
  };

  return [
    // ── New ▸ ───────────────────────────────────────────────────────────────
    { id: 'layer-new-layer', label: 'Layer', menu: 'layer', submenuPath: ['New'], group: 'new', keywords: ['new', 'layer', 'empty'], run: () => store.getState().addLayer('fill', { name: 'Layer', fillStyle: { type: 'solid', color: '#ffffff00' } }) },
    { id: 'layer-new-background', label: 'Background from Layer', menu: 'layer', submenuPath: ['New'], group: 'new', keywords: ['background'], enabled: () => live().hasSelection, run: () => { const st = store.getState(); st.reorder(selected(), 'back'); st.updateElements(selected(), { name: 'Background', locked: true }); } },
    { id: 'layer-new-artboard', label: 'Artboard', menu: 'layer', submenuPath: ['New'], group: 'new', keywords: ['artboard', 'format'], run: () => { const st = store.getState(); const out = st.doc.outputs[st.currentOutput]; st.addOutput({ formatId: 'custom', name: 'Artboard', width: out.width, height: out.height }); } },
    { id: 'layer-new-artboard-group', label: 'Artboard from Group', menu: 'layer', submenuPath: ['New'], group: 'new', keywords: ['artboard', 'group'], enabled: () => live().selectedEls.some((e) => e.type === 'group'), run: () => { const st = store.getState(); const out = st.doc.outputs[st.currentOutput]; st.addOutput({ formatId: 'custom', name: 'Artboard', width: out.width, height: out.height }); } },
    { id: 'layer-new-group', label: 'Group', menu: 'layer', submenuPath: ['New'], group: 'new', keywords: ['group', 'folder'], run: () => store.getState().addLayer('group') },
    { id: 'layer-new-group-from', label: 'Group from Layers', menu: 'layer', submenuPath: ['New'], group: 'new', keywords: ['group', 'folder'], enabled: () => selected().length >= 2, run: () => store.getState().groupSelection() },

    // ── Top level ───────────────────────────────────────────────────────────
    { id: 'layer-duplicate', label: 'Duplicate Layer', menu: 'layer', group: 'edit', shortcut: '⌘J', keywords: ['duplicate', 'copy'], enabled: () => live().hasSelection, run: () => { const st = store.getState(); selected().forEach((id) => st.duplicateElement(id)); } },
    { id: 'layer-rename', label: 'Rename Layer', menu: 'layer', group: 'edit', keywords: ['rename', 'name'], enabled: () => selected().length === 1, run: () => { const el = firstSelected(); if (!el) return; store.getState().requestRename(el.id); } },

    // ── Layer Style ▸ ───────────────────────────────────────────────────────
    { id: 'layer-style-blending', label: 'Blending Options', menu: 'layer', submenuPath: ['Layer Style'], group: 'style-a', keywords: ['blend', 'opacity'], enabled: () => live().hasSelection, run: () => store.getState().setLayerBlend(selected(), 'normal') },
    ...STYLES.map((s) => ({
      id: `layer-style-${s.type}`,
      label: s.label,
      menu: 'layer' as const,
      submenuPath: ['Layer Style'],
      group: 'style-b',
      keywords: ['style', 'effect', s.label.toLowerCase()],
      enabled: () => live().hasSelection,
      run: () => addStyle(s.type),
    })),
    { id: 'layer-style-global-light', label: 'Global Light', menu: 'layer', submenuPath: ['Layer Style'], group: 'style-c', keywords: ['global', 'light', 'angle'], enabled: () => live().hasSelection, run: () => { const st = store.getState(); for (const el of live().selectedEls) { st.updateElement(el.id, { styles: (el.styles || []).map((s) => ({ ...s, useGlobalLight: true, angle: 120 })) }); } st.pushHistory(); } },
    { id: 'layer-style-copy', label: 'Copy Layer Style', menu: 'layer', submenuPath: ['Layer Style'], group: 'style-d', keywords: ['copy', 'style'], enabled: () => !!firstSelected()?.styles?.length, run: () => { styleClipboard = firstSelected()?.styles ? JSON.parse(JSON.stringify(firstSelected()!.styles)) : null; } },
    { id: 'layer-style-paste', label: 'Paste Layer Style', menu: 'layer', submenuPath: ['Layer Style'], group: 'style-d', keywords: ['paste', 'style'], enabled: () => !!styleClipboard && live().hasSelection, run: () => { if (!styleClipboard) return; const st = store.getState(); st.updateElements(selected(), { styles: JSON.parse(JSON.stringify(styleClipboard)) }); } },
    { id: 'layer-style-clear', label: 'Clear Layer Style', menu: 'layer', submenuPath: ['Layer Style'], group: 'style-d', keywords: ['clear', 'remove', 'style'], enabled: () => live().selectedEls.some((e) => e.styles?.length), run: () => store.getState().updateElements(selected(), { styles: undefined }) },
    { id: 'layer-style-toggle', label: 'Toggle Layer Style', menu: 'layer', submenuPath: ['Layer Style'], group: 'style-d', keywords: ['toggle', 'style'], enabled: () => live().selectedEls.some((e) => e.styles?.length), run: () => { const st = store.getState(); for (const el of live().selectedEls) { if (!el.styles?.length) continue; const allOn = el.styles.every((s) => s.enabled !== false); st.updateElement(el.id, { styles: el.styles.map((s) => ({ ...s, enabled: !allOn })) }); } st.pushHistory(); } },

    // ── New Fill Layer ▸ ────────────────────────────────────────────────────
    { id: 'layer-fill-solid', label: 'Solid Color', menu: 'layer', submenuPath: ['New Fill Layer'], group: 'fill', keywords: ['fill', 'solid', 'color'], run: () => store.getState().addLayer('fill', { name: 'Color Fill', fillStyle: { type: 'solid', color: '#2B5CD3' } }) },
    { id: 'layer-fill-gradient', label: 'Gradient', menu: 'layer', submenuPath: ['New Fill Layer'], group: 'fill', keywords: ['fill', 'gradient'], run: () => store.getState().addLayer('fill', { name: 'Gradient Fill', fillStyle: { type: 'gradient', gradient: { type: 'linear', angle: 90, stops: [{ offset: 0, color: '#2B5CD3' }, { offset: 1, color: '#FFFFFF' }] } } }) },
    { id: 'layer-fill-pattern', label: 'Pattern', menu: 'layer', submenuPath: ['New Fill Layer'], group: 'fill', keywords: ['fill', 'pattern'], run: () => store.getState().addLayer('fill', { name: 'Pattern Fill', fillStyle: { type: 'pattern', pattern: { preset: 'dots', scale: 1, color: '#000000', background: '#ffffff' } } }) },

    // ── New Adjustment Layer ▸ ──────────────────────────────────────────────
    ...ADJUSTMENTS.map((a) => ({
      id: `layer-adj-${a.type}`,
      label: a.label,
      menu: 'layer' as const,
      submenuPath: ['New Adjustment Layer'],
      group: 'adjust',
      keywords: ['adjustment', a.label.toLowerCase()],
      run: () =>
        store.getState().addLayer('adjustment', {
          name: a.label,
          adjustment: {
            type: a.type,
            values: defaultAdjustmentValues(a.type),
            ...(a.type === 'gradient-map'
              ? { gradient: { type: 'linear' as const, stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }] } }
              : {}),
          },
        }),
    })),

    // ── Group / visibility / lock ───────────────────────────────────────────
    { id: 'group', label: 'Group Layers', menu: 'layer', group: 'group', shortcut: '⌘G', keywords: ['group'], enabled: () => selected().length >= 1, run: () => store.getState().groupSelection() },
    { id: 'ungroup', label: 'Ungroup Layers', menu: 'layer', group: 'group', shortcut: '⇧⌘G', keywords: ['ungroup'], enabled: () => live().selectedEls.some((e) => e.type === 'group' || e.parentId), run: () => store.getState().ungroupSelection() },
    { id: 'layer-hide', label: () => { const els = live().selectedEls; return els.length > 0 && els.every((e) => e.hidden) ? 'Show Layers' : 'Hide Layers'; }, menu: 'layer', group: 'visibility', keywords: ['hide', 'show', 'visibility'], enabled: () => live().hasSelection, run: () => { const st = store.getState(); const els = live().selectedEls; const allHidden = els.length > 0 && els.every((e) => e.hidden); st.updateElements(selected(), { hidden: !allHidden }); } },
    { id: 'lock-toggle', label: () => { const els = live().selectedEls; return els.length > 0 && els.every((e) => e.locked) ? 'Unlock Layers' : 'Lock Layers'; }, menu: 'layer', group: 'visibility', keywords: ['lock', 'unlock'], enabled: () => live().hasSelection, run: () => { const st = store.getState(); const els = live().selectedEls; const allLocked = els.length > 0 && els.every((e) => e.locked); st.updateElements(selected(), { locked: !allLocked }); } },
    { id: 'layer-clip', label: 'Create Clipping Mask', menu: 'layer', group: 'visibility', shortcut: '⌥⌘G', keywords: ['clip', 'clipping', 'mask'], enabled: () => live().hasSelection, run: () => store.getState().toggleClipped(selected()) },
  ];
};
