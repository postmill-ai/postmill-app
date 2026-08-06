'use client';

import React, { FC, useCallback, useMemo, useRef, useState } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import type { DesignerElement, DesignerOutput } from '../designer.store';
import {
  buildLayerTree,
  flattenForDisplay,
  descendantIds,
  isEffectivelyHidden,
  type LayerNode,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/layer-tree';
import { SELECTABLE_BLEND_MODES } from '@postmill-ai/nestjs-libraries/media/designer-doc/pixel-ops';
import { layerThumbnail } from './layer-thumbnail';
import { SmartFilterList } from './smart-filter-list';
import {
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  UnlockIcon,
} from '@postmill-ai/frontend/components/ui/icons/designer-tools';

interface LayersPanelProps {
  store: ReturnType<typeof import('../designer.store').createDesignerStore>;
  onClose?: () => void;
}

/** Glyph per layer type, used when no thumbnail can be produced. */
const TYPE_GLYPH: Record<string, string> = {
  text: 'T',
  image: '▣',
  shape: '◇',
  icon: '★',
  path: '✎',
  raster: '▨',
  group: '▤',
  fill: '■',
  adjustment: '◐',
};

const layerLabel = (el: DesignerElement): string => {
  if (el.name) return el.name;
  if (el.type === 'text') return el.text?.slice(0, 30) || 'Text';
  if (el.type === 'adjustment') return el.adjustment?.type || 'Adjustment';
  if (el.type === 'fill') return el.fillStyle?.type || 'Fill';
  if (el.type === 'shape') return el.shape || 'Shape';
  return el.type.charAt(0).toUpperCase() + el.type.slice(1);
};

const BLEND_LABELS: Record<string, string> = {
  'normal': 'Normal', 'multiply': 'Multiply', 'screen': 'Screen',
  'overlay': 'Overlay', 'darken': 'Darken', 'lighten': 'Lighten',
  'color-dodge': 'Color Dodge', 'color-burn': 'Color Burn',
  'hard-light': 'Hard Light', 'soft-light': 'Soft Light',
  'difference': 'Difference', 'exclusion': 'Exclusion',
  'hue': 'Hue', 'saturation': 'Saturation', 'color': 'Color',
  'luminosity': 'Luminosity', 'dissolve': 'Dissolve',
  'linear-burn': 'Linear Burn', 'linear-dodge': 'Linear Dodge',
  'vivid-light': 'Vivid Light', 'linear-light': 'Linear Light',
  'pin-light': 'Pin Light', 'hard-mix': 'Hard Mix',
  'subtract': 'Subtract', 'divide': 'Divide',
  'darker-color': 'Darker Color', 'lighter-color': 'Lighter Color',
};

/**
 * Photoshop-style layers panel.
 *
 * Reads the tree from the flat `children` array via `parentId` (see
 * `layer-tree`), so groups nest and collapse while every other part of the app
 * keeps seeing one flat list.
 */
export const LayersPanel: FC<LayersPanelProps> = ({ store, onClose }) => {
  const t = useT();
  const currentOutput = store((s) => s.currentOutput);
  const output = store(
    (s) => s.doc.outputs[s.currentOutput] as DesignerOutput | undefined
  );
  const elements = useMemo(() => output?.children || [], [output]);
  const selectedIds = store((s) => s.selectedIds);

  const [localEditingId, setLocalEditingId] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const lastClickedId = useRef<string | null>(null);

  const tree = useMemo(() => buildLayerTree(elements), [elements]);

  /** Visible rows, top-first, hiding the contents of collapsed groups. */
  const rows = useMemo(() => {
    const collapsed = new Set(
      elements.filter((e) => e.type === 'group' && e.collapsed).map((e) => e.id)
    );
    const insideCollapsed = new Set<string>();
    for (const id of collapsed) {
      descendantIds(elements, id).forEach((d) => insideCollapsed.add(d));
    }
    return flattenForDisplay(tree).filter((n) => !insideCollapsed.has(n.element.id));
  }, [tree, elements]);

  const select = useCallback(
    (id: string, e: React.MouseEvent) => {
      const state = store.getState();
      if (e.shiftKey && lastClickedId.current) {
        // Range select across the VISIBLE rows, which is what the user sees.
        const order = rows.map((r) => r.element.id);
        const a = order.indexOf(lastClickedId.current);
        const b = order.indexOf(id);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          state.setSelectedIds(order.slice(lo, hi + 1));
          return;
        }
      }
      if (e.metaKey || e.ctrlKey) {
        const next = new Set(state.selectedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        state.setSelectedIds(Array.from(next));
        lastClickedId.current = id;
        return;
      }
      // Alt-click toggles the clipping mask, matching Photoshop.
      if (e.altKey) {
        state.toggleClipped([id]);
        return;
      }
      state.setSelectedIds([id]);
      lastClickedId.current = id;
    },
    [store, rows]
  );

  // Layer ▸ Rename Layer names its target in the store; the inline editor lives
  // here. Derived rather than copied into state so opening it never costs a
  // second render pass.
  const renamingId = store((s) => s.renamingId);
  const maskTargetId = store((s) => s.maskTargetId);
  const editingId =
    localEditingId ?? (elements.some((e) => e.id === renamingId) ? renamingId : null);

  const stopRename = useCallback(() => {
    setLocalEditingId(null);
    if (store.getState().renamingId) store.getState().requestRename(null);
  }, [store]);

  const commitRename = useCallback(() => {
    if (!editingId) return;
    // Uncontrolled input: the draft lives in the DOM, so the editor can open
    // from either route without an effect seeding a draft-name state.
    const trimmed = (nameInputRef.current?.value || '').trim();
    store.getState().updateElement(editingId, { name: trimmed || undefined });
    store.getState().pushHistory();
    stopRename();
  }, [editingId, store, stopRename]);

  /**
   * Drop the dragged rows at a visible row boundary.
   *
   * The panel is top-first while `children` is bottom-first, so the display
   * index has to be inverted before it means anything to the document.
   */
  const handleDrop = useCallback(
    (displayIndex: number) => {
      if (!dragId) return;
      const target = rows[displayIndex];
      const ids = selectedIds.includes(dragId) ? selectedIds : [dragId];
      // Drop INTO a collapsed/expanded group when landing on its row.
      const parentId =
        target?.element.type === 'group' ? target.element.id : target?.element.parentId;
      const docIndex = target
        ? elements.findIndex((e) => e.id === target.element.id)
        : elements.length;
      store.getState().moveLayersTo(ids, Math.max(0, docIndex), parentId);
      setDragId(null);
      setDropIndex(null);
    },
    [dragId, rows, selectedIds, elements, store]
  );

  if (!rows.length) {
    return (
      <div className="text-[12px] text-textColor/50 text-center py-6">
        {t('layers_panel_empty', 'No layers on this output')}
      </div>
    );
  }

  const selectedEl = elements.find((e) => e.id === selectedIds[0]);

  return (
    <div className="flex flex-col gap-2">
      {/* Blend + opacity for the selection, as Photoshop puts above the list. */}
      <div className="flex items-center gap-2 pb-2 border-b border-studioBorder">
        <select
          aria-label={t('layer_blend_mode', 'Blend mode')}
          value={selectedEl?.blendMode || 'normal'}
          disabled={!selectedEl}
          onChange={(e) =>
            store.getState().setLayerBlend(selectedIds, e.target.value as never)
          }
          className="flex-1 min-w-0 h-[26px] px-1.5 rounded-md bg-newBgColor border border-studioBorder text-[11px] text-textColor outline-none disabled:opacity-40"
        >
          {SELECTABLE_BLEND_MODES.map((m) => (
            <option key={m} value={m}>{BLEND_LABELS[m] || m}</option>
          ))}
        </select>
        <label className="flex items-center gap-1 shrink-0">
          <span className="text-[11px] text-textColor/60">
            {t('layer_opacity', 'Opacity')}
          </span>
          <input
            type="number"
            min={0}
            max={100}
            aria-label={t('layer_opacity', 'Opacity')}
            value={Math.round((selectedEl?.opacity ?? 1) * 100)}
            disabled={!selectedEl}
            // Silent while typing, one history entry on commit — the store's
            // convention for continuous controls. `updateElements` here put an
            // undo step on the stack for every keystroke.
            onChange={(e) => {
              const v = Math.max(0, Math.min(100, Number(e.target.value))) / 100;
              store.getState().updateElementsSilent(selectedIds, { opacity: v });
            }}
            onBlur={() => store.getState().pushHistory()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') store.getState().pushHistory();
            }}
            className="w-[46px] h-[26px] px-1 rounded-md bg-newBgColor border border-studioBorder text-[11px] text-textColor outline-none disabled:opacity-40"
          />
        </label>
      </div>

      <div
        className="flex flex-col"
        role="listbox"
        aria-multiselectable="true"
        aria-label={t('layers_panel_layers', 'Layers')}
        // A listbox must be focusable so Escape reaches it without first
        // clicking a row.
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && onClose) {
            e.preventDefault();
            onClose();
          }
        }}
      >
        {rows.map((node, i) => {
          const el = node.element;
          const isSelected = selectedIds.includes(el.id);
          const isGroup = el.type === 'group';
          const thumb = layerThumbnail(el, output);
          const dimmed = isEffectivelyHidden(elements, el) && !el.hidden;

          return (
            <React.Fragment key={el.id}>
            <div
              data-layer-row
              data-element-id={el.id}
              role="option"
              aria-selected={isSelected}
              tabIndex={0}
              draggable={!el.locked}
              onDragStart={() => setDragId(el.id)}
              onDragOver={(e) => {
                e.preventDefault();
                setDropIndex(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(i);
              }}
              onDragEnd={() => {
                setDragId(null);
                setDropIndex(null);
              }}
              onClick={(e) => select(el.id, e)}
              onDoubleClick={() => setLocalEditingId(el.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  setLocalEditingId(el.id);
                }
              }}
              style={{ paddingInlineStart: 4 + node.depth * 12 }}
              className={`group flex items-center gap-1.5 pe-1.5 py-1 rounded-md text-[12px] cursor-default transition-colors ${
                isSelected ? 'bg-designerAccent/25 text-textColor' : 'hover:bg-studioBorder/25 text-textColor/85'
              } ${dropIndex === i && dragId ? 'border-t-2 border-designerAccent' : ''} ${
                dimmed ? 'opacity-40' : ''
              }`}
            >
              {/* Expand / collapse, groups only. */}
              {isGroup ? (
                <button
                  type="button"
                  data-row-action
                  aria-label={el.collapsed ? t('expand', 'Expand') : t('collapse', 'Collapse')}
                  onClick={(e) => {
                    e.stopPropagation();
                    store.getState().toggleGroupCollapsed(el.id);
                  }}
                  className="w-3 shrink-0 text-[9px] text-textColor/60"
                >
                  {el.collapsed ? '▶' : '▼'}
                </button>
              ) : (
                <span className="w-3 shrink-0" />
              )}

              {/* Clipping indicator — Photoshop's downward arrow. */}
              {el.clipped && (
                <span className="shrink-0 text-[10px] text-textColor/50" title={t('clipped', 'Clipped')}>
                  ↳
                </span>
              )}

              {/* The mask thumbnail. Clicking it arms the mask as the paint
                  target; the ring makes which surface is armed unmistakable,
                  because painting into the wrong one is invisible until it
                  isn't. ⇧-click disables, ⌥-click is handled by the row. */}
              {el.maskSrc && (
                <button
                  type="button"
                  data-row-action
                  aria-label={t('designer_layer_mask', 'Layer mask')}
                  aria-pressed={maskTargetId === el.id}
                  title={
                    el.maskEnabled === false
                      ? t('designer_mask_disabled', 'Mask disabled — shift-click to enable')
                      : t('designer_paint_mask', 'Paint the mask — shift-click to disable')
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    const st = store.getState();
                    if (e.shiftKey) {
                      st.updateElement(el.id, { maskEnabled: el.maskEnabled === false });
                      st.pushHistory();
                      return;
                    }
                    st.setMaskTarget(maskTargetId === el.id ? null : el.id);
                  }}
                  className={`w-7 h-7 shrink-0 rounded border overflow-hidden flex items-center justify-center bg-newBgColor ${
                    maskTargetId === el.id
                      ? 'border-designerAccent ring-2 ring-designerAccent'
                      : 'border-studioBorder'
                  } ${el.maskEnabled === false ? 'opacity-40' : ''}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={el.maskSrc} alt="" className="max-w-full max-h-full object-contain" />
                </button>
              )}

              <span className={`w-7 h-7 shrink-0 rounded border overflow-hidden flex items-center justify-center text-[11px] text-textColor/60 bg-newBgColor ${
                el.maskSrc && maskTargetId !== el.id
                  ? 'border-designerAccent ring-2 ring-designerAccent'
                  : 'border-studioBorder'
              }`}>
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumb} alt="" className="max-w-full max-h-full object-contain" />
                ) : (
                  TYPE_GLYPH[el.type] || '?'
                )}
              </span>

              {editingId === el.id ? (
                <input
                  autoFocus
                  ref={nameInputRef}
                  key={el.id}
                  defaultValue={el.name || layerLabel(el)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    // The row itself opens the editor on Enter, so a bubbling
                    // Enter would re-open it the instant the commit closed it.
                    e.stopPropagation();
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') stopRename();
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 min-w-0 h-[22px] px-1 rounded bg-newBgColor border border-designerAccent text-[12px] text-textColor outline-none"
                />
              ) : (
                <span className="flex-1 truncate">{layerLabel(el)}</span>
              )}

              {/* Effects marker — only for effects that are actually painting.
                  A stack switched entirely off changes nothing on the canvas
                  and should not claim otherwise. */}
              {el.styles?.some((s) => s.enabled !== false) && (
                <span className="shrink-0 text-[10px] text-textColor/45" title={t('layer_effects', 'Effects')}>
                  fx
                </span>
              )}
              {el.originId && (
                <span className="shrink-0 text-[10px] text-textColor/35" title={t('linked', 'Linked')}>
                  🔗
                </span>
              )}

              <button
                type="button"
                data-row-action
                aria-label={el.hidden ? t('show_layer', 'Show layer') : t('hide_layer', 'Hide layer')}
                onClick={(e) => {
                  e.stopPropagation();
                  store.getState().updateElement(el.id, { hidden: !el.hidden });
                  store.getState().pushHistory();
                }}
                className="shrink-0 w-5 h-5 flex items-center justify-center text-textColor/55 hover:text-textColor"
              >
                {el.hidden ? <EyeOffIcon size={13} /> : <EyeIcon size={13} />}
              </button>
              <button
                type="button"
                data-row-action
                aria-label={el.locked ? t('unlock_layer', 'Unlock layer') : t('lock_layer', 'Lock layer')}
                onClick={(e) => {
                  e.stopPropagation();
                  store.getState().updateElement(el.id, { locked: !el.locked });
                  store.getState().pushHistory();
                }}
                className="shrink-0 w-5 h-5 flex items-center justify-center text-textColor/55 hover:text-textColor"
              >
                {el.locked ? <LockIcon size={13} /> : <UnlockIcon size={13} />}
              </button>
            </div>

            <SmartFilterList
              stack={el.smartFilters}
              depth={node.depth}
              onChange={(next) => {
                store.getState().updateElement(el.id, { smartFilters: next });
                store.getState().pushHistory();
              }}
            />
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
