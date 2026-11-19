'use client';

import React, { FC, useMemo } from 'react';
import { CommonInspector } from './common-inspector';
import { ImageInspector } from './image-inspector';
import { ShapeInspector } from './shape-inspector';
import { IconInspector } from './icon-inspector';
import { TextInspector } from './text-inspector';
import { ClipInspector } from './clip-inspector';
import { SymbolInspector } from './symbol-inspector';
import { FillLayerInspector } from './fill-layer-inspector';
import { AdjustmentInspector } from './adjustment-inspector';
import { EffectsList } from './effects-list';
import {
  InspectorSectionsProvider,
  InspectorTabGroup,
  commonStyleTabFor,
  effectsTabFor,
  useInspectorTabState,
  type InspectorCategory,
  type InspectorTabKey,
} from './inspector-tabs';
import { OverflowTabs } from '@postmill-ai/frontend/components/ui/overflow-tabs';
import { useUser } from '@postmill-ai/frontend/components/layout/user.context';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import type { DesignerElement } from '../designer.store';
import { pageChildren } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.pages';

interface InspectorProps {
  store: any;
}

export const InspectorPanel: FC<InspectorProps> = ({ store }) => {
  const t = useT();
  const user = useUser();
  const tabIdPrefix = React.useId();
  const doc = store((s: any) => s.doc);
  const currentOutput = store((s: any) => s.currentOutput);
  const currentPage = store((s: any) => s.currentPage);
  const selectedIds = store((s: any) => s.selectedIds);
  const setSelectedIds = store((s: any) => s.setSelectedIds);
  const unlinkElement = store((s: any) => s.unlinkElement);
  const relinkElement = store((s: any) => s.relinkElement);
  const selectedClip = store((s: any) => s.selectedClip);
  const setSelectedClip = store((s: any) => s.setSelectedClip);

  const isVideoMode = doc.mode === 'video';

  const selected: DesignerElement[] = useMemo(
    () =>
      isVideoMode ? [] : pageChildren(doc.outputs[currentOutput] as any, currentPage).filter(
        (c: DesignerElement) => selectedIds.includes(c.id),
      ),
    [doc, currentOutput, currentPage, selectedIds, isVideoMode],
  );

  const primary = selected[0];
  const isMixedType = !!primary && selected.some((s) => s.type !== primary.type);
  const category: InspectorCategory = !primary
    ? 'mixed'
    : isMixedType
      ? 'mixed'
      : (primary.type as InspectorCategory);

  // Tab + section state is keyed by category, never written on selection
  // changes — selecting another element of the same category keeps the tab,
  // and switching categories restores that category's last tab.
  const { tabs, tab, setTab, sectionOpen, toggleSection } = useInspectorTabState(
    category,
    user?.orgId,
  );

  if (!selected.length && !selectedClip) return null;

  // Video clip inspector
  if (isVideoMode && selectedClip) {
    const sel = selectedClip as { outputIndex: number; trackId: string; clipId: string };
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className="text-[11px] text-textColor/40 truncate">
              {t('designer_clip_id', 'Clip {{id}}', { id: sel.clipId.substring(0, 8) })}
            </div>
          </div>
          <button
            onClick={() => setSelectedClip(null)}
            className="w-6 h-6 flex items-center justify-center rounded-sm text-textColor/60 hover:bg-studioBorder/30 hover:text-textColor text-[14px] shrink-0"
            title={t('designer_clear_selection', 'Clear selection')}
            aria-label={t('designer_clear_selection', 'Clear selection')}
          >
            &times;
          </button>
        </div>
        <ClipInspector
          store={store}
          outputIndex={sel.outputIndex}
          trackId={sel.trackId}
          clipId={sel.clipId}
        />
      </div>
    );
  }

  if (!selected.length) return null;

  const ids = selected.map((s) => s.id);
  const isLinked = currentPage === 0 && !!primary.originId;
  const commonStyleTab = commonStyleTabFor(category);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className="text-[11px] text-textColor/40 truncate">
            {selected.length > 1
              ? t('designer_n_selected_type', '{{count}} selected — {{type}}', {
                  count: selected.length,
                  type: isMixedType
                    ? t('designer_mixed', 'mixed')
                    : t(`designer_element_type_${primary.type}`, primary.type),
                })
              : t(`designer_element_type_${primary.type}`, primary.type)}
          </div>
          {isLinked ? (
            <span className="text-[11px] text-btnPrimaryAccent shrink-0">{t('designer_linked_formats', '🔗 Linked — edits update all formats')}</span>
          ) : (
            <span className="text-[11px] text-newTableText shrink-0">{t('designer_format_only', '🔓 This format only')}</span>
          )}
        </div>
        <button
          onClick={() => setSelectedIds([])}
          className="w-6 h-6 flex items-center justify-center rounded-sm text-textColor/60 hover:bg-studioBorder/30 hover:text-textColor text-[14px] shrink-0"
          title={t('designer_clear_selection', 'Clear selection')}
          aria-label={t('designer_clear_selection', 'Clear selection')}
        >
          &times;
        </button>
      </div>

      {isLinked && (
        <button
          className="w-full text-xs px-2 py-1.5 rounded-sm border border-designerAccent/30 text-btnPrimaryAccent hover:bg-designerAccent/10 hover:border-designerAccent"
          onClick={() => { unlinkElement(primary.id); }}
        >
          {t('designer_unlink', 'Unlink')}
        </button>
      )}

      {currentPage === 0 && !isLinked && primary.type !== 'icon' && (
        <button
          className="w-full text-xs px-2 py-1.5 rounded-sm border border-designerAccent/30 text-btnPrimaryAccent hover:bg-designerAccent/10"
          onClick={() => {
            const newOriginId = `relink-${Date.now()}`;
            relinkElement(primary.id, newOriginId);
          }}
        >
          {t('designer_apply_to_all_formats', 'Apply to All Formats')}
        </button>
      )}

      {/* The bar sticks to the top of the scrolling host (desktop dock and
          mobile sheet both pad with p-3), so switching tasks never needs a
          full-panel scroll. */}
      <div className="sticky -top-3 z-10 -mx-3 px-3 bg-newBgColorInner">
        <OverflowTabs
          items={tabs.map((descriptor) => ({
            key: descriptor.key,
            id: `${tabIdPrefix}-${descriptor.key}-tab`,
            label: t(descriptor.labelKey, descriptor.fallback),
          }))}
          activeKey={tab}
          onSelect={(key) => setTab(key as InspectorTabKey)}
          variant="underline"
          semantics="tabs"
          ariaLabel={t('designer_inspector_tabs', 'Inspector sections')}
          listAriaLabel={t('designer_inspector_tabs', 'Inspector sections')}
          className="[&_button]:px-[10px] [&_button]:text-[12px]"
        />
      </div>

      <InspectorSectionsProvider value={{ tabIdPrefix, sectionOpen, toggleSection }}>
        <div className="space-y-3">
          {category === 'text' && (
            <TextInspector store={store} tab={tab} />
          )}

          {category === 'image' && (
            <ImageInspector element={primary} ids={ids} store={store} tab={tab} />
          )}

          {/* Pen and Pathfinder output styles through the same fill/stroke controls;
              ShapeInspector hides the shape-only ones for a path. */}
          {(category === 'shape' || category === 'path') && (
            <ShapeInspector element={primary} ids={ids} store={store} tab={tab} />
          )}

          {category === 'icon' && (
            <IconInspector element={primary} ids={ids} store={store} tab={tab} />
          )}

          {/* A symbol instance (the CTA lockup) edits per-child content through
              its overrides, not through the child's own inspector. */}
          {category === 'symbol' && (
            <SymbolInspector element={primary} store={store} tab={tab} />
          )}

          {/* A fill layer used to route to nothing: addable, never editable. */}
          {category === 'fill' && (
            <FillLayerInspector element={primary} ids={ids} store={store} tab={tab} />
          )}

          {/* Settings apply to the one layer — averaging two Curves is meaningless. */}
          {selected.length === 1 && primary.type === 'adjustment' && (
            <AdjustmentInspector element={primary} store={store} tab={tab} />
          )}

          {/* Effects are painted from the layer's alpha, so they apply to every
              element type — including images, which the old partial mapping
              silently skipped. Text gives them their own tab; every other
              category keeps them under Style. */}
          {!isMixedType && primary.type !== 'adjustment' && (
            <InspectorTabGroup for={effectsTabFor(category)} active={tab}>
              <EffectsList element={primary} ids={ids} store={store} />
            </InspectorTabGroup>
          )}

          <CommonInspector selected={selected} ids={ids} store={store} tab={tab} styleTab={commonStyleTab} />
        </div>
      </InspectorSectionsProvider>
    </div>
  );
};
