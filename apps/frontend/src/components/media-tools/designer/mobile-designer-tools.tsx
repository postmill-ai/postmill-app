'use client';

import React, { FC, ReactNode, useEffect, useRef, useState } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { DeleteLayerIcon, DuplicateClipIcon } from '@postmill-ai/frontend/components/ui/icons/designer-tools';
import { TOOL_GROUPS } from './tools';
import { ToolOptionsBar } from './tool-options-bar';

type Store = ReturnType<typeof import('./designer.store').createDesignerStore>;

const QuickButton: FC<{
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}> = ({ label, onClick, disabled, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    className="min-w-0 min-h-[48px] px-1 py-1 flex flex-col items-center justify-center gap-0.5 rounded-md text-textColor hover:bg-studioBorder/30 disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-designerAccent"
  >
    <span aria-hidden="true" className="text-[17px] leading-none">{children}</span>
    <span className="text-[9px] leading-none">{label}</span>
  </button>
);

export const MobileQuickActions: FC<{
  store: Store;
  onSave: () => void;
  onOpenTools: () => void;
  onToggleInspector: () => void;
}> = ({ store, onSave, onOpenTools, onToggleInspector }) => {
  const t = useT();
  const docMode = store((state) => state.doc.mode);
  const currentOutput = store((state) => state.currentOutput);
  const selectedIds = store((state) => state.selectedIds);
  const selectedClip = store((state) => state.selectedClip);
  const selectedClips = store((state) => state.selectedClips);
  const historyIndex = store((state) => state.historyIndex);
  const historyLength = store((state) => state.history.length);
  const isSaving = store((state) => state.isSaving);
  const hasSelection = docMode === 'video' ? !!selectedClip : selectedIds.length > 0;
  const selectedTrack = store((state) => {
    if (state.doc.mode !== 'video' || !state.selectedClip) return undefined;
    return (state.doc.outputs[state.currentOutput] as any)?.tracks
      ?.find((track: any) => track.id === state.selectedClip!.trackId);
  });

  const duplicate = () => {
    const state = store.getState();
    if (docMode === 'video') {
      if (!selectedClip) return;
      state.duplicateClip(currentOutput, selectedClip.trackId, selectedClip.clipId);
      return;
    }
    state.duplicateElements(selectedIds);
  };
  const remove = () => {
    const state = store.getState();
    if (docMode === 'video') {
      const refs = selectedClips.length
        ? selectedClips
        : selectedClip
          ? [{ trackId: selectedClip.trackId, clipId: selectedClip.clipId }]
          : [];
      if (refs.length) state.removeClips(currentOutput, refs);
      return;
    }
    state.removeElements(selectedIds);
  };

  return (
    <div className="hidden mobile:grid grid-cols-7 gap-1 px-2 py-1.5 border-t border-studioBorder bg-newBgColorInner shrink-0" role="toolbar" aria-label={t('designer_quick_actions', 'Designer quick actions')}>
      <QuickButton label={t('undo', 'Undo')} onClick={() => store.getState().undo()} disabled={historyIndex <= 0}>↩</QuickButton>
      <QuickButton label={t('redo', 'Redo')} onClick={() => store.getState().redo()} disabled={historyIndex >= historyLength - 1}>↪</QuickButton>
      <QuickButton label={t('duplicate', 'Duplicate')} onClick={duplicate} disabled={!hasSelection || !!selectedTrack?.locked}>
        <DuplicateClipIcon size={17} />
      </QuickButton>
      <QuickButton label={t('delete', 'Delete')} onClick={remove} disabled={!hasSelection || !!selectedTrack?.locked}>
        <DeleteLayerIcon size={17} />
      </QuickButton>
      <QuickButton label={t('save', 'Save')} onClick={onSave} disabled={isSaving}>✓</QuickButton>
      <QuickButton label={t('designer_tools', 'Tools')} onClick={onOpenTools}>☰</QuickButton>
      <QuickButton label={t('inspector_panel_label', 'Inspector')} onClick={onToggleInspector}>☷</QuickButton>
    </div>
  );
};

type MobileToolsSheetProps = {
  activeTool: string;
  lastToolPerGroup: Record<string, string>;
  aiAvailable: boolean;
  onSelect: (toolId: string) => void;
  activeToolOptions: Record<string, unknown>;
  onToolOptionChange: (key: string, value: unknown) => void;
  onOpenBrand: () => void;
};

export const MobileToolsSheet: FC<MobileToolsSheetProps> = ({ activeTool, lastToolPerGroup, aiAvailable, onSelect, activeToolOptions, onToolOptionChange, onOpenBrand }) => {
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onOpenBrand} className="col-span-2 min-h-[40px] rounded-md border border-studioBorder text-[12px] text-textColor hover:bg-boxHover">
          {t('brand_label', 'Brand')}
        </button>
        {TOOL_GROUPS.map((group) => {
          const tools = group.tools.filter((tool) => !tool.requiresAi || aiAvailable);
          if (!tools.length) return null;
          const shown = tools.find((tool) => tool.id === lastToolPerGroup[group.id]) || tools[0];
          const Icon = shown.icon;
          return (
            <button
              key={group.id}
              type="button"
              onClick={() => onSelect(shown.id)}
              aria-pressed={tools.some((tool) => tool.id === activeTool)}
              className={`min-h-[52px] px-2 py-2 flex items-center gap-2 rounded-md border text-start ${
                tools.some((tool) => tool.id === activeTool)
                  ? 'border-designerAccent bg-designerAccent/15 text-btnPrimaryAccent'
                  : 'border-studioBorder text-textColor hover:bg-boxHover'
              }`}
            >
              <Icon size={18} />
              <span className="text-[12px]">{t(shown.labelKey, shown.label)}</span>
            </button>
          );
        })}
      </div>
      <ToolOptionsBar activeTool={activeTool} options={activeToolOptions} onChange={onToolOptionChange} />
    </div>
  );
};

export type MobileSheetSnap = 'half' | 'expanded';

export const MobileSheetHeader: FC<{
  title: string;
  snap: MobileSheetSnap;
  onSnapChange: (snap: MobileSheetSnap) => void;
  onClose: () => void;
}> = ({ title, snap, onSnapChange, onClose }) => {
  const t = useT();
  const dragStartY = useRef<number | null>(null);
  return (
    <div className="flex items-center gap-2 border-b border-studioBorder px-3 py-2 shrink-0">
      <div
        role="button"
        tabIndex={0}
        aria-label={t('designer_resize_sheet', 'Resize {{title}} panel', { title })}
        className="hidden mobile:flex h-8 w-8 cursor-row-resize touch-none items-center justify-center text-textColor/50"
        onPointerDown={(event) => {
          dragStartY.current = event.clientY;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerUp={(event) => {
          const startY = dragStartY.current;
          dragStartY.current = null;
          if (startY === null) return;
          const delta = event.clientY - startY;
          if (delta < -32) onSnapChange('expanded');
          else if (delta > 32) {
            if (snap === 'expanded') onSnapChange('half');
            else onClose();
          }
        }}
        onPointerCancel={() => { dragStartY.current = null; }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            onSnapChange('expanded');
          } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (snap === 'expanded') onSnapChange('half');
            else onClose();
          }
        }}
      >
        <span aria-hidden="true" className="h-1 w-6 rounded-full bg-studioBorder" />
      </div>
      <div className="flex-1 truncate text-[12px] font-medium uppercase tracking-wider text-textColor/60">
        {title}
      </div>
      <div className="hidden mobile:flex items-center gap-1">
        <button
          type="button"
          aria-pressed={snap === 'half'}
          onClick={() => onSnapChange('half')}
          className="min-h-[32px] rounded-sm px-2 text-[11px] text-textColor/70 hover:bg-studioBorder/30"
        >
          {t('designer_sheet_half', 'Half')}
        </button>
        <button
          type="button"
          aria-pressed={snap === 'expanded'}
          onClick={() => onSnapChange('expanded')}
          className="min-h-[32px] rounded-sm px-2 text-[11px] text-textColor/70 hover:bg-studioBorder/30"
        >
          {t('designer_sheet_expand', 'Expand')}
        </button>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label={t('collapse_panel', 'Collapse panel')}
        title={t('collapse_panel', 'Collapse panel')}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-textColor/60 hover:bg-studioBorder/30 hover:text-textColor"
      >
        <span className="mobile:hidden">›</span>
        <span className="hidden mobile:inline">⌄</span>
      </button>
    </div>
  );
};

type MobileWorkspaceSheetProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
};

const MobileWorkspaceSheetContent: FC<MobileWorkspaceSheetProps> = ({ open, title, onClose, children }) => {
  const [snap, setSnap] = useState<MobileSheetSnap>('half');
  if (!open) return null;
  return (
    <section
      aria-label={title}
      className={`hidden mobile:flex min-h-0 shrink-0 flex-col border-t border-studioBorder bg-newBgColorInner ${snap === 'half' ? 'h-[32dvh]' : 'h-[65dvh]'}`}
    >
      <MobileSheetHeader title={title} snap={snap} onSnapChange={setSnap} onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
    </section>
  );
};

export const MobileWorkspaceSheet: FC<MobileWorkspaceSheetProps> = (props) => (
  <MobileWorkspaceSheetContent key={props.open ? 'open' : 'closed'} {...props} />
);

export const MobileToolsDialog: FC<MobileToolsSheetProps & {
  open: boolean;
  onClose: () => void;
}> = ({ open, onClose, ...sheetProps }) => {
  const t = useT();
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  return (
    <MobileWorkspaceSheet open={open} title={t('designer_tools', 'Tools')} onClose={onClose}>
      <MobileToolsSheet {...sheetProps} />
    </MobileWorkspaceSheet>
  );
};
