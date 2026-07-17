'use client';

import React, { FC, useMemo } from 'react';
import { CommonInspector } from './common-inspector';
import { ImageInspector } from './image-inspector';
import { ShapeInspector } from './shape-inspector';
import { IconInspector } from './icon-inspector';
import { TextInspector } from './text-inspector';
import { ClipInspector } from './clip-inspector';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import type { DesignerElement } from '../designer.store';

interface InspectorProps {
  store: any;
}

export const InspectorPanel: FC<InspectorProps> = ({ store }) => {
  const t = useT();
  const doc = store((s: any) => s.doc);
  const currentOutput = store((s: any) => s.currentOutput);
  const selectedIds = store((s: any) => s.selectedIds);
  const setSelectedIds = store((s: any) => s.setSelectedIds);
  const unlinkElement = store((s: any) => s.unlinkElement);
  const relinkElement = store((s: any) => s.relinkElement);
  const selectedClip = store((s: any) => s.selectedClip);
  const setSelectedClip = store((s: any) => s.setSelectedClip);

  const isVideoMode = doc.mode === 'video';

  const selected: DesignerElement[] = useMemo(
    () =>
      isVideoMode ? [] : (doc.outputs[currentOutput]?.children || []).filter(
        (c: DesignerElement) => selectedIds.includes(c.id),
      ),
    [doc, currentOutput, selectedIds, isVideoMode],
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
            className="w-6 h-6 flex items-center justify-center rounded text-textColor/60 hover:bg-studioBorder/30 hover:text-textColor text-[14px] shrink-0"
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

  const primary = selected[0];
  const ids = selected.map((s) => s.id);
  const isMixedType = selected.some((s) => s.type !== primary.type);

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
          {primary.originId ? (
            <span className="text-[11px] text-btnPrimaryAccent shrink-0">{t('designer_linked_formats', '🔗 Linked — edits update all formats')}</span>
          ) : (
            <span className="text-[11px] text-gray-500 shrink-0">{t('designer_format_only', '🔓 This format only')}</span>
          )}
        </div>
        <button
          onClick={() => setSelectedIds([])}
          className="w-6 h-6 flex items-center justify-center rounded text-textColor/60 hover:bg-studioBorder/30 hover:text-textColor text-[14px] shrink-0"
          title={t('designer_clear_selection', 'Clear selection')}
          aria-label={t('designer_clear_selection', 'Clear selection')}
        >
          &times;
        </button>
      </div>

      {primary.originId && (
        <button
          className="w-full text-xs px-2 py-1.5 rounded border border-[#2a2a4a] text-gray-400 hover:text-white hover:border-red-500/50"
          onClick={() => { unlinkElement(primary.id); }}
        >
          {t('designer_unlink', 'Unlink')}
        </button>
      )}

      {!primary.originId && primary.type !== 'icon' && (
        <button
          className="w-full text-xs px-2 py-1.5 rounded border border-designerAccent/30 text-btnPrimaryAccent hover:bg-designerAccent/10"
          onClick={() => {
            const newOriginId = `relink-${Date.now()}`;
            relinkElement(primary.id, newOriginId);
          }}
        >
          {t('designer_apply_to_all_formats', 'Apply to All Formats')}
        </button>
      )}

      {!isMixedType && primary.type === 'text' && (
        <TextInspector store={store} />
      )}

      {!isMixedType && primary.type === 'image' && (
        <ImageInspector element={primary} ids={ids} store={store} />
      )}

      {!isMixedType && primary.type === 'shape' && (
        <ShapeInspector element={primary} ids={ids} store={store} />
      )}

      {!isMixedType && primary.type === 'icon' && (
        <IconInspector element={primary} ids={ids} store={store} />
      )}

      <CommonInspector selected={selected} ids={ids} store={store} />
    </div>
  );
};
