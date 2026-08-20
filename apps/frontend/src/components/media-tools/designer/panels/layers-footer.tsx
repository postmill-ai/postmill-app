'use client';

import React, { FC, useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import type { DesignerElement, DesignerOutput } from '../designer.store';
import { layerActions } from '../layer-actions';
import type { DesignerAction } from '../actions';
import {
  LinkLayersIcon,
  LayerStyleIcon,
  LayerMaskIcon,
  ClippingMaskIcon,
  FillAdjustmentIcon,
  NewGroupIcon,
  NewLayerIcon,
  DeleteLayerIcon,
} from '@postmill-ai/frontend/components/ui/icons/designer-tools';

interface LayersFooterProps {
  store: ReturnType<typeof import('../designer.store').createDesignerStore>;
}

/**
 * The Layers panel's action row, in Photoshop's order:
 *
 *   link · fx · mask · fill/adjustment · group · new · delete
 *
 * Two of those have no literal equivalent here, so they take the nearest real
 * thing: the chain toggles the CROSS-FORMAT link (the 🔗 already on each row —
 * edits propagate to the other formats), and the mask slot toggles a clipping
 * mask, since the document model has clipping masks but not layer masks.
 *
 * Every button routes through `layerActions` — the same list the Layer menu is
 * built from — so the two can never disagree about what is enabled or what a
 * command does.
 */

/** A footer button that opens a small menu of actions above itself. */
/**
 * A 1x1 opaque white PNG — a mask that reveals everything.
 *
 * Inlined rather than uploaded: a fresh mask has no painted content yet, and the
 * first stroke replaces it with a real upload through `commitBuffer`.
 */
const WHITE_MASK =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const MenuButton: FC<{
  label: string;
  icon: FC<{ size?: number; className?: string }>;
  actions: DesignerAction[];
}> = ({ label, icon: Icon, actions }) => {
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const ref = useRef<HTMLButtonElement>(null);

  const toggle = useCallback(() => {
    if (pos) {
      setPos(null);
      return;
    }
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    // Opens UPWARD: the row sits at the bottom of the panel, so a downward menu
    // would run off the viewport.
    setPos({ left: r.left, bottom: window.innerHeight - r.top + 4 });
  }, [pos]);

  const enabled = actions.filter((a) => (a.enabled ? a.enabled() : true));

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={toggle}
        disabled={!enabled.length}
        aria-haspopup="menu"
        aria-expanded={!!pos}
        aria-label={label}
        title={label}
        className="w-7 h-7 flex items-center justify-center rounded-md text-textColor/70 hover:bg-studioBorder/30 hover:text-textColor disabled:text-textColor/25 disabled:hover:bg-transparent transition-colors"
      >
        <Icon size={15} />
      </button>

      {pos &&
        typeof document !== 'undefined' &&
        createPortal(
          <>
            {/* Dismiss layer: a click anywhere else closes the menu. */}
            <div className="fixed inset-0 z-399" onClick={() => setPos(null)} />
            <div
              role="menu"
              aria-label={label}
              style={{ left: pos.left, bottom: pos.bottom }}
              className="fixed z-400 min-w-[200px] max-h-[60vh] overflow-y-auto py-1 rounded-lg border border-studioBorder bg-newBgColorInner shadow-2xl"
            >
              {enabled.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    action.run();
                    setPos(null);
                  }}
                  className="w-full px-3 py-1.5 text-[13px] text-start text-textColor hover:bg-studioBorder/30 transition-colors"
                >
                  {typeof action.label === 'function' ? action.label() : action.label}
                </button>
              ))}
            </div>
          </>,
          document.body
        )}
    </>
  );
};

const ActionButton: FC<{
  label: string;
  icon: FC<{ size?: number; className?: string }>;
  disabled?: boolean;
  onClick: () => void;
}> = ({ label, icon: Icon, disabled, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    title={label}
    className="w-7 h-7 flex items-center justify-center rounded-md text-textColor/70 hover:bg-studioBorder/30 hover:text-textColor disabled:text-textColor/25 disabled:hover:bg-transparent transition-colors"
  >
    <Icon size={15} />
  </button>
);

export const LayersFooter: FC<LayersFooterProps> = ({ store }) => {
  const t = useT();
  const output = store((s) => s.doc.outputs[s.currentOutput] as DesignerOutput | undefined);
  const selectedIds = store((s) => s.selectedIds);
  const isVideo = store((s) => s.doc.mode === 'video');

  const elements: DesignerElement[] = output?.children || [];
  const selectedEls = elements.filter((el) => selectedIds.includes(el.id));
  const hasSelection = selectedEls.length > 0;

  // Rebuilt per render rather than memoised: the actions close over the live
  // selection, and a stale closure here would run a command against the wrong
  // layers. Building ~40 plain objects costs nothing next to the panel's list.
  const actions = layerActions(store as never, () => ({
    selectedEls,
    hasSelection,
    children: elements,
  }));
  const byPath = (name: string) =>
    actions.filter((a) => a.submenuPath?.[0] === name);
  const byId = (id: string) => actions.find((a) => a.id === id);

  const clip = byId('layer-clip');
  const group = byId('group');
  const newLayer = byId('layer-new-layer');

  // Linked = this layer's edits propagate to the other formats. Mixed
  // selections resolve to "link them all", matching the inspector.
  const allLinked = hasSelection && selectedEls.every((el) => !!el.originId);
  const toggleLink = useCallback(() => {
    const st = store.getState();
    for (const el of selectedEls) {
      if (allLinked) st.unlinkElement(el.id);
      else if (!el.originId) st.relinkElement(el.id, `relink-${el.id}`);
    }
  }, [store, selectedEls, allLinked]);

  return (
    <div className="flex items-center justify-between gap-0.5 px-2 py-1.5">
      <ActionButton
        label={allLinked ? t('designer_unlink', 'Unlink') : t('designer_apply_to_all_formats', 'Apply to All Formats')}
        icon={LinkLayersIcon}
        disabled={!hasSelection || isVideo}
        onClick={toggleLink}
      />
      <MenuButton
        label={t('layer_style', 'Layer Style')}
        icon={LayerStyleIcon}
        actions={byPath('Layer Style')}
      />
      <ActionButton
        label={t('designer_add_layer_mask', 'Add Layer Mask')}
        icon={LayerMaskIcon}
        disabled={!hasSelection}
        onClick={() => {
          // A blank white mask reveals everything — you then paint black to
          // hide, which is the direction Photoshop starts you in.
          const st = store.getState();
          for (const el of selectedEls) {
            if (el.maskSrc) continue;
            st.updateElement(el.id, { maskEnabled: true, maskSrc: WHITE_MASK });
          }
          st.pushHistory();
          if (selectedEls[0]) st.setMaskTarget(selectedEls[0].id);
        }}
      />
      <ActionButton
        label={t('designer_create_clipping_mask', 'Create Clipping Mask')}
        icon={ClippingMaskIcon}
        disabled={!clip || (clip.enabled ? !clip.enabled() : false)}
        onClick={() => clip?.run()}
      />
      <MenuButton
        label={t('designer_new_fill_adjustment', 'New Fill or Adjustment Layer')}
        icon={FillAdjustmentIcon}
        actions={[...byPath('New Fill Layer'), ...byPath('New Adjustment Layer')]}
      />
      <ActionButton
        label={t('designer_new_group', 'New Group')}
        icon={NewGroupIcon}
        disabled={!group || (group.enabled ? !group.enabled() : false)}
        onClick={() => group?.run()}
      />
      <ActionButton
        label={t('designer_new_layer', 'New Layer')}
        icon={NewLayerIcon}
        disabled={!newLayer || isVideo}
        onClick={() => newLayer?.run()}
      />
      <ActionButton
        label={t('delete', 'Delete')}
        icon={DeleteLayerIcon}
        disabled={!hasSelection}
        onClick={() => {
          const st = store.getState();
          st.removeElements(selectedIds);
        }}
      />
    </div>
  );
};
