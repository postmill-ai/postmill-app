'use client';

import React, { FC, useCallback, useEffect, useRef, useState } from 'react';
import type { DesignerElement } from '../designer.store';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface LayersPanelProps {
  store: ReturnType<typeof import('../designer.store').createDesignerStore>;
  onClose?: () => void;
}

const elementIcon: Record<string, string> = {
  text: 'T',
  image: '▣',
  shape: '◇',
};

const elementLabel = (el: DesignerElement, t: ReturnType<typeof useT>): string => {
  if (el.name) return el.name;
  if (el.type === 'text') {
    const text = (el.text || '').slice(0, 20);
    return text ? `"${text}"` : t('provider_chip_text', 'Text');
  }
  if (el.type === 'image') return t('provider_chip_image', 'Image');
  if (el.type === 'icon') return t('layers_panel_icon', 'Icon');
  if (el.type === 'shape') return el.shape ? t('layers_panel_shape_named', 'Shape ({{shape}})', { shape: el.shape }) : t('layers_panel_shape', 'Shape');
  return t('layers_panel_element', 'Element');
};

export const LayersPanel: FC<LayersPanelProps> = ({ store }) => {
  const t = useT();
  const currentOutput = store((s) => s.currentOutput);
  const elements = store(
    (s) =>
      (s.doc.outputs[s.currentOutput] as import('../designer.store').DesignerOutput)
        ?.children || []
  );
  const selectedIds = store((s) => s.selectedIds);

  const reversed = [...elements].reverse();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId) {
      renameInputRef.current?.focus();
    }
  }, [editingId]);

  const selectElement = useCallback(
    (id: string) => {
      store.getState().setSelectedIds([id]);
    },
    [store]
  );

  const startRename = useCallback((el: DesignerElement) => {
    setEditingId(el.id);
    setDraftName(elementLabel(el, t));
  }, [t]);

  const commitRename = useCallback(() => {
    if (!editingId) return;
    const trimmed = draftName.trim();
    store.getState().updateElement(editingId, { name: trimmed || undefined });
    store.getState().pushHistory();
    setEditingId(null);
  }, [editingId, draftName, store]);

  const cancelRename = useCallback(() => {
    setEditingId(null);
  }, []);

  const getCurrentChildren = useCallback(
    () =>
      (
        store.getState().doc.outputs[currentOutput] as import('../designer.store').DesignerOutput
      )?.children || [],
    [store, currentOutput]
  );

  const toggleVisibility = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      const children = getCurrentChildren();
      const el = children.find((c) => c.id === id);
      if (el) {
        store.getState().updateElement(id, { hidden: !el.hidden });
        store.getState().pushHistory();
      }
    },
    [getCurrentChildren, store]
  );

  const toggleLock = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      const children = getCurrentChildren();
      const el = children.find((c) => c.id === id);
      if (el) {
        store.getState().updateElement(id, { locked: !el.locked });
        store.getState().pushHistory();
      }
    },
    [getCurrentChildren, store]
  );

  // Reorder via the store action, which replaces ONLY the current output's
  // children (preserving all other formats) and commits history. The previous
  // setDoc({ outputs: [{...output}] }) wrote a single-output array, silently
  // destroying every other format.
  const moveUp = useCallback(
    (e: React.MouseEvent, index: number) => {
      e.stopPropagation();
      const children = getCurrentChildren();
      if (index >= children.length - 1) return;
      const el = children[index];
      if (!el) return;
      store.getState().reorder([el.id], 'forward');
    },
    [store, getCurrentChildren]
  );

  const moveDown = useCallback(
    (e: React.MouseEvent, index: number) => {
      e.stopPropagation();
      const children = getCurrentChildren();
      if (index <= 0) return;
      const el = children[index];
      if (!el) return;
      store.getState().reorder([el.id], 'backward');
    },
    [store, getCurrentChildren]
  );

  const handlePanelKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (editingId) return;
      const target = e.target as HTMLElement;
      const row = target.closest('[data-layer-row]') as HTMLDivElement | null;
      if (!row) return;
      const idx = Number(row.dataset.index);
      const id = row.dataset.elementId;
      if (Number.isNaN(idx) || !id) return;

      const isActionButton = !!target.closest('[data-row-action]');
      const children = getCurrentChildren();
      const total = children.length;
      const el = children.find((c) => c.id === id);
      if (!el) return;

      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          if (idx > 0) {
            rowRefs.current[idx - 1]?.focus();
          }
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (idx < total - 1) {
            rowRefs.current[idx + 1]?.focus();
          }
          break;
        case 'Enter':
          if (isActionButton) return;
          e.preventDefault();
          selectElement(el.id);
          startRename(el);
          break;
        case ' ':
          if (isActionButton) return;
          e.preventDefault();
          selectElement(el.id);
          break;
      }
    },
    [editingId, selectElement, startRename, getCurrentChildren]
  );

  if (!elements.length) {
    return (
      <div className="text-[12px] text-newTextColor/60 text-center py-4">
        {t('layers_panel_no_elements', 'No elements on this output')}
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-1"
      role="listbox"
      tabIndex={0}
      aria-label={t('layers_panel_layers', 'Layers')}
      onKeyDown={handlePanelKeyDown}
    >
      {reversed.map((el, reversedIdx) => {
        const idx = elements.length - 1 - reversedIdx;
        const isSelected = selectedIds.includes(el.id);
        const isEditing = editingId === el.id;
        return (
          <div
            key={el.id}
            ref={(node) => {
              rowRefs.current[reversedIdx] = node;
            }}
            data-layer-row
            data-index={reversedIdx}
            data-element-id={el.id}
            role="option"
            tabIndex={isEditing ? -1 : 0}
            aria-selected={isSelected}
            aria-label={t('layers_panel_layer_label', 'Layer {{label}}', { label: elementLabel(el, t) })}
            onClick={() => {
              if (!isEditing) {
                selectElement(el.id);
              }
            }}
            onKeyDown={(e) => {
              if (isEditing) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                selectElement(el.id);
              }
            }}
            className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-[12px] transition-all outline-none focus-visible:ring-2 focus-visible:ring-designerAccent ${
              isSelected
                ? 'bg-designerAccent/20 text-textColor'
                : 'text-newTextColor/60 hover:bg-studioBorder/10 hover:text-textColor'
            }`}
          >
            <div className="w-5 h-5 flex items-center justify-center text-[11px] font-bold text-btnPrimaryAccent shrink-0">
              {elementIcon[el.type] || '?'}
            </div>

            {isEditing ? (
              <input
                ref={renameInputRef}
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') {
                    commitRename();
                  } else if (e.key === 'Escape') {
                    cancelRename();
                  }
                }}
                className="flex-1 h-[22px] px-1.5 rounded-[4px] bg-newBgColor border border-designerAccent text-[11px] text-textColor outline-none"
              />
            ) : (
              <div className="flex-1 truncate text-[11px]">{elementLabel(el, t)}</div>
            )}

            {el.originId ? (
              <span title={t('layers_panel_linked_title', 'Linked — edits here update all formats')} className="text-btnPrimaryAccent shrink-0">🔗</span>
            ) : (
              <span title={t('layers_panel_unlinked_title', 'Unlinked — changes stay in this format only')} className="text-gray-500 shrink-0">🔓</span>
            )}

            <div className="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                data-row-action
                onClick={(e) => moveDown(e, idx)}
                className="w-5 h-5 flex items-center justify-center rounded hover:bg-studioBorder/20 text-[10px]"
                title={t('move_down', 'Move down')}
                aria-label={t('layers_panel_move_layer_down', 'Move layer down')}
              >
                ↑
              </button>
              <button
                type="button"
                data-row-action
                onClick={(e) => moveUp(e, idx)}
                className="w-5 h-5 flex items-center justify-center rounded hover:bg-studioBorder/20 text-[10px]"
                title={t('move_up', 'Move up')}
                aria-label={t('layers_panel_move_layer_up', 'Move layer up')}
              >
                ↓
              </button>
            </div>

            <div className="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                data-row-action
                onClick={(e) => toggleVisibility(e, el.id)}
                className={`w-5 h-5 flex items-center justify-center rounded hover:bg-studioBorder/20 text-[11px] ${
                  el.hidden ? 'text-newTextColor/20' : 'text-newTextColor/60'
                }`}
                title={el.hidden ? t('layers_panel_show', 'Show') : t('layers_panel_hide', 'Hide')}
                aria-label={el.hidden ? t('layers_panel_show_layer', 'Show layer') : t('layers_panel_hide_layer', 'Hide layer')}
              >
                {el.hidden ? '◌' : '◎'}
              </button>
              <button
                type="button"
                data-row-action
                onClick={(e) => toggleLock(e, el.id)}
                className={`w-5 h-5 flex items-center justify-center rounded hover:bg-studioBorder/20 text-[10px] ${
                  el.locked ? 'text-btnPrimaryAccent' : 'text-newTextColor/60'
                }`}
                title={el.locked ? t('layers_panel_unlock', 'Unlock') : t('layers_panel_lock', 'Lock')}
                aria-label={el.locked ? t('layers_panel_unlock_layer', 'Unlock layer') : t('layers_panel_lock_layer', 'Lock layer')}
              >
                {el.locked ? '◉' : '○'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
