'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { usePromptModal } from '@postmill-ai/frontend/components/layout/new-modal';
import {
  CHANNEL_PRESETS,
  type ChannelPreset,
} from '@postmill-ai/nestjs-libraries/integrations/social/channel-presets';
import { pageChildren, pageCount } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.pages';
import { FormatThumbnail } from './format-thumbnail';

interface OutputTabsProps {
  store: any;
  onPagesContentAdded?: () => void;
}

const CHANNEL_GROUPS: Record<
  string,
  { label: string; presets: ChannelPreset[]; mode: 'image' | 'video' }
> = {
  instagram: { label: 'Instagram', presets: [], mode: 'image' },
  facebook: { label: 'Facebook', presets: [], mode: 'image' },
  x: { label: 'X (Twitter)', presets: [], mode: 'image' },
  linkedin: { label: 'LinkedIn', presets: [], mode: 'image' },
  threads: { label: 'Threads', presets: [], mode: 'image' },
  tiktok: { label: 'TikTok', presets: [], mode: 'image' },
  youtube: { label: 'YouTube', presets: [], mode: 'image' },
  pinterest: { label: 'Pinterest', presets: [], mode: 'image' },
  custom: { label: 'Custom', presets: [], mode: 'image' },
  video: { label: 'Video', presets: [], mode: 'video' },
};

for (const p of CHANNEL_PRESETS) {
  if (p.id.startsWith('ig-')) CHANNEL_GROUPS.instagram.presets.push(p);
  else if (p.id.startsWith('fb-')) CHANNEL_GROUPS.facebook.presets.push(p);
  else if (p.id === 'x-post') CHANNEL_GROUPS.x.presets.push(p);
  else if (p.id.startsWith('linkedin-'))
    CHANNEL_GROUPS.linkedin.presets.push(p);
  else if (p.id.startsWith('threads-'))
    CHANNEL_GROUPS.threads.presets.push(p);
  else if (p.id === 'tiktok') CHANNEL_GROUPS.tiktok.presets.push(p);
  else if (p.id.startsWith('yt-'))
    CHANNEL_GROUPS.youtube.presets.push(p);
  else if (p.id === 'pinterest-pin')
    CHANNEL_GROUPS.pinterest.presets.push(p);
  else if (p.id === 'custom') CHANNEL_GROUPS.custom.presets.push(p);
  else if (p.category === 'video') CHANNEL_GROUPS.video.presets.push(p);
}

const RECOMMENDED_IDS = ['ig-post', 'ig-story', 'linkedin-post', 'x-post'];

const THUMB_H = 82;
const THUMB_MIN_W = 118;
const REMOVE_UNDO_DURATION_MS = 6000;

type PopoverKind = 'addFormats' | 'overflow' | 'resize' | 'formatActions';

interface PopoverState {
  kind: PopoverKind;
  anchor: HTMLElement;
  resizeIndex?: number;
  outputIndex?: number;
}

interface RemovedFormatState {
  name: string;
  history: unknown[];
  historyIndex: number;
}

interface PortalPopoverProps {
  anchorEl: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  align?: 'left' | 'right';
  children: React.ReactNode;
  className?: string;
}

/**
 * Pick the side of the anchor with more room and cap the popover to it. The
 * old positioning always opened upward with no height limit, so on short
 * viewports the resize/format menu ran off the top of the screen.
 */
export const computePopoverPlacement = (
  anchor: { top: number; bottom: number },
  viewportHeight: number,
  gap = 4
): { side: 'above' | 'below'; maxHeight: number } => {
  const above = anchor.top - gap - 8;
  const below = viewportHeight - anchor.bottom - gap - 8;
  return above >= below
    ? { side: 'above', maxHeight: Math.max(120, above) }
    : { side: 'below', maxHeight: Math.max(120, below) };
};

/**
 * Horizontal placement: 'right' aligns the popover's right edge with the
 * anchor's right edge — using the POPOVER's width, not the anchor's (the old
 * math subtracted the anchor's 40px width, throwing the 288px panel ~250px
 * past the right viewport edge and its Add button off-screen). Either way the
 * result is clamped inside the viewport.
 */
export const computePopoverLeft = (
  anchor: { left: number; right: number },
  popoverWidth: number,
  viewportWidth: number,
  align: 'left' | 'right',
  gap = 8
): number => {
  const w = popoverWidth || 280;
  const raw = align === 'right' ? anchor.right - w : anchor.left;
  return Math.max(gap, Math.min(raw, viewportWidth - w - gap));
};

const PortalPopover: React.FC<PortalPopoverProps> = ({
  anchorEl,
  open,
  onClose,
  align = 'left',
  children,
  className = '',
}) => {
  const [pos, setPos] = useState({ left: 0, top: 0, bottom: 0 });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !anchorEl) return;

    const updatePos = () => {
      const r = anchorEl.getBoundingClientRect();
      const left = computePopoverLeft(
        { left: r.left, right: r.right },
        ref.current?.offsetWidth || 280,
        window.innerWidth,
        align
      );
      setPos({ left, top: r.top, bottom: r.bottom });
    };

    const raf = requestAnimationFrame(updatePos);
    // Content can resize the panel after first paint (images, async lists) —
    // re-measure so the right-align stays pinned to the anchor.
    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updatePos) : null;
    if (ref.current) ro?.observe(ref.current);
    window.addEventListener('scroll', updatePos, true);
    window.addEventListener('resize', updatePos);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener('scroll', updatePos, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [open, anchorEl, align]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const t = setTimeout(
      () => document.addEventListener('mousedown', handler),
    );
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', handler);
    };
  }, [open, onClose]);

  if (!open || !anchorEl || typeof document === 'undefined') return null;

  const placement = computePopoverPlacement(
    { top: pos.top, bottom: pos.bottom },
    window.innerHeight
  );
  const style: React.CSSProperties = {
    position: 'fixed',
    left: pos.left,
    ...(placement.side === 'above'
      ? { bottom: window.innerHeight - pos.top + 4 }
      : { top: pos.bottom + 4 }),
    maxHeight: placement.maxHeight,
    overflowY: 'auto',
    zIndex: 9999,
  };

  return createPortal(
    <div ref={ref} className={className} style={style}>
      {children}
    </div>,
    document.body,
  );
};

export const OutputTabs = React.memo(function OutputTabs({ store, onPagesContentAdded }: OutputTabsProps) {
  const t = useT();
  const toaster = useToaster();
  const promptModal = usePromptModal();
  const doc = store((s: any) => s.doc);
  const history = store((s: any) => s.history);
  const historyIndex = store((s: any) => s.historyIndex);
  const currentHistoryDoc = history[historyIndex];
  const currentOutput = store((s: any) => s.currentOutput);
  const currentPage = store((s: any) => s.currentPage ?? 0);
  const editFormatOnly = store((s: any) => s.editFormatOnly);
  const outputs: any[] = doc.outputs;
  const mode: 'image' | 'video' = doc.mode || 'image';

  const activeOriginIds = new Set(
    (pageChildren(outputs[currentOutput], currentPage) || []).filter((c: any) => c?.originId).map((c: any) => c.originId)
  );

  const linkedUpdateFlash: Record<number, number> = store((s: any) => s.linkedUpdateFlash) || {};

  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [pendingFormats, setPendingFormats] = useState<Set<string>>(
    new Set(),
  );
  const [cW, setCW] = useState('1080');
  const [cH, setCH] = useState('1080');
  const [linkContent, setLinkContent] = useState(true);
  const [removedFormat, setRemovedFormat] = useState<RemovedFormatState | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const overflowBtnRef = useRef<HTMLButtonElement>(null);

  const closePopover = useCallback(() => setPopover(null), []);

  const openPopover = useCallback(
    (kind: PopoverKind, el: HTMLElement, extra?: Partial<Pick<PopoverState, 'resizeIndex' | 'outputIndex'>>) => {
      setPopover({ kind, anchor: el, ...extra });
    },
    [],
  );

  useEffect(() => {
    if (!removedFormat) return;
    const timeout = window.setTimeout(() => {
      setRemovedFormat((current) => current === removedFormat ? null : current);
    }, REMOVE_UNDO_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [removedFormat]);

  useEffect(() => {
    if (!scrollRef.current) return;
    const tab = scrollRef.current.children[currentOutput] as HTMLElement;
    if (tab) {
      tab.scrollIntoView({
        behavior: reduceMotion ? 'auto' : 'smooth',
        block: 'nearest',
        inline: 'nearest',
      });
    }
  }, [currentOutput, reduceMotion]);

  const handleRemove = (e: React.MouseEvent, i: number) => {
    e.stopPropagation();
    const state = store.getState();
    const output = state.doc.outputs[i];
    if (!output || state.doc.outputs.length <= 1 || output.frozen) return;
    const beforeDoc = state.doc;
    state.removeOutput(i);
    const nextState = store.getState();
    if (nextState.doc === beforeDoc) return;
    setRemovedFormat({
      name: output.name,
      history: nextState.history,
      historyIndex: nextState.historyIndex,
    });
  };

  const handleUndoRemove = () => {
    const state = store.getState();
    if (
      removedFormat &&
      state.history === removedFormat.history &&
      state.historyIndex === removedFormat.historyIndex &&
      state.doc === state.history[state.historyIndex]
    ) {
      state.undo();
    }
    setRemovedFormat(null);
  };

  const handleRename = async (index: number) => {
    const output = store.getState().doc.outputs[index];
    if (!output || output.frozen) return;
    closePopover();
    const name = await promptModal.open({
      title: t('designer_rename_format', 'Rename format'),
      label: t('designer_format_name', 'Format name'),
      initialValue: output.name,
      approveLabel: t('save', 'Save'),
      cancelLabel: t('cancel', 'Cancel'),
    });
    if (name === null) return;
    const currentIndex = store.getState().doc.outputs.findIndex(
      (candidate: any) => candidate.id === output.id
    );
    if (currentIndex >= 0) store.getState().renameOutput(currentIndex, name);
  };

  const handleToggleFormatLink = (index: number) => {
    const state = store.getState();
    const shouldLink = state.editFormatOnly;
    state.setCurrentOutput(index);
    state.setEditFormatOnly(!shouldLink);
    closePopover();
  };

  const visibleRemoval = removedFormat?.history === history &&
    removedFormat.historyIndex === historyIndex &&
    doc === currentHistoryDoc
    ? removedFormat
    : null;

  const toggleFormat = (id: string) => {
    setPendingFormats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const notifyPagesContentAdded = () => {
    const state = store.getState();
    const output = state.doc.outputs[state.currentOutput];
    if (output && 'children' in output && pageCount(output) > 1) {
      onPagesContentAdded?.();
    }
  };

  const handleAddFormats = () => {
    const s = store.getState();
    const applied: string[] = [];
    for (const id of pendingFormats) {
      const preset = CHANNEL_PRESETS.find((p) => p.id === id);
      if (preset && !s.addOutput({
        formatId: preset.id,
        name: preset.name,
        width: preset.width,
        height: preset.height,
      }, { linkContent })) {
        setPendingFormats((current) => {
          const next = new Set(current);
          applied.forEach((addedId) => next.delete(addedId));
          return next;
        });
        const sourceFrozen = !!s.doc.outputs[s.currentOutput]?.frozen;
        toaster.show(
          sourceFrozen
            ? t('designer_frozen_read_only', 'This format is frozen. Unfreeze it to edit.')
            : t('something_went_wrong', 'Something went wrong'),
          'warning'
        );
        return;
      }
      if (preset) applied.push(id);
    }
    setPendingFormats(new Set());
    notifyPagesContentAdded();
    closePopover();
  };

  const handleAddCustom = () => {
    const w = parseInt(cW, 10);
    const h = parseInt(cH, 10);
    if (w > 0 && h > 0) {
      const added = store.getState().addOutput({
        formatId: 'custom',
        name: t('designer_custom_size_name', 'Custom size'),
        width: w,
        height: h,
      }, { linkContent });
      if (!added) {
        const state = store.getState();
        toaster.show(
          state.doc.outputs[state.currentOutput]?.frozen
            ? t('designer_frozen_read_only', 'This format is frozen. Unfreeze it to edit.')
            : t('something_went_wrong', 'Something went wrong'),
          'warning'
        );
        return;
      }
      notifyPagesContentAdded();
      closePopover();
      setCW('1080');
      setCH('1080');
    }
  };

  const handleResize = (index: number, preset: ChannelPreset) => {
    store
      .getState()
      .resizeOutput(index, preset.width, preset.height, preset.id, preset.name);
    closePopover();
  };

  const handleResizeCustom = (index: number) => {
    const w = parseInt(cW, 10);
    const h = parseInt(cH, 10);
    if (w > 0 && h > 0) {
      const output = store.getState().doc.outputs[index];
      const legacyDimensionName = output?.formatId === 'custom' &&
        /^\d+×\d+(?: \d+)?$/.test(output.name);
      const name = output?.formatId === 'custom' && !legacyDimensionName
        ? output.name
        : t('designer_custom_size_name', 'Custom size');
      store
        .getState()
        .resizeOutput(index, w, h, 'custom', name);
      closePopover();
      setCW('1080');
      setCH('1080');
    }
  };

  const showOverflow = outputs.length > 6;

  const popoverKind = popover?.kind ?? null;
  const popoverAnchor = popover?.anchor ?? null;
  const resizeIndex = popover?.resizeIndex ?? null;
  const showAddFormats = popoverKind === 'addFormats';
  const showOverflowMenu = popoverKind === 'overflow';
  const showResize = popoverKind === 'resize';
  const showFormatActions = popoverKind === 'formatActions';
  const formatActionsIndex = popover?.outputIndex ?? null;
  const formatActionsOutput = formatActionsIndex === null
    ? null
    : outputs[formatActionsIndex];

  return (
    <div className="relative shrink-0 flex items-center gap-2 px-3 py-2 border-t border-studioBorder bg-newBgColorInner">
      {visibleRemoval && (
        <div
          role="status"
          className="absolute bottom-full end-3 z-30 mb-2 flex items-center gap-3 rounded-md border border-studioBorder bg-newBgColorInner px-3 py-2 text-[12px] text-textColor shadow-menu"
        >
          <span>{t('designer_format_removed', 'Format “{{name}}” removed', { name: visibleRemoval.name })}</span>
          <button
            type="button"
            onClick={handleUndoRemove}
            aria-label={t('undo', 'Undo')}
            className="min-h-7 rounded-sm px-2 font-medium text-btnPrimaryAccent hover:bg-designerAccent/10 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-designerAccent"
          >
            {t('undo', 'Undo')}
          </button>
        </div>
      )}
      <div
        ref={scrollRef}
        className="flex items-center gap-3 overflow-x-auto flex-1 min-w-0 px-1"
      >
        {outputs.map((output: any, i: number) => (
          <div
            key={output.id}
            data-format-card={output.id}
            className={`relative group shrink-0 rounded-md border-2 transition-colors ${
              i === currentOutput
                ? 'border-designerAccent bg-designerAccent/10'
                : 'border-studioBorder'
            }`}
            style={{ minWidth: THUMB_MIN_W, height: THUMB_H }}
          >
            <button
              type="button"
              data-format-select={output.id}
              onClick={() => store.getState().setCurrentOutput(i)}
              aria-current={i === currentOutput}
              className="absolute inset-0 flex flex-col items-center justify-start text-center px-2 pb-1 pt-8 gap-0 rounded-[4px] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-designerAccent"
            >
              {i !== currentOutput && Array.isArray(output.children) && output.children.some((c: any) => c?.originId && activeOriginIds.has(c.originId)) && (
                <div className="absolute top-9 end-1 w-2 h-2 rounded-full bg-designerAccent" title={t('designer_has_linked_elements', 'Has linked elements')} />
              )}
              {(() => {
                const updatedAt = i !== currentOutput ? linkedUpdateFlash[i] : 0;
                const isUpdated = updatedAt && Date.now() - updatedAt < 1500;
                return isUpdated ? (
                  <div
                    className={`absolute top-9 start-1 w-2 h-2 rounded-full bg-green-400 ${reduceMotion ? '' : 'animate-pulse'}`}
                    title={t('designer_updated_from_another_format', 'Updated from another format')}
                  />
                ) : null;
              })()}
              <FormatThumbnail
                output={output}
                symbols={doc.symbols}
                maxDim={72}
                className="h-[20px] max-w-[40px]"
              />
              <span className="text-[11px] font-medium text-textColor leading-tight truncate max-w-[94px]">
                {output.name}
              </span>
              <span className="text-[9px] text-textColor/50 leading-none">
                {output.width}×{output.height}
              </span>
              {mode === 'image' && pageCount(output) > 1 && (
                <span
                  className="absolute bottom-1 end-1 rounded-sm bg-designerAccent/15 text-btnPrimaryAccent text-[8px] leading-none px-1 py-0.5"
                  title={t('designer_pages_count', '{{count}} pages', { count: pageCount(output) })}
                >
                  {pageCount(output)}p
                </span>
              )}
            </button>
            <div className="absolute top-1 inset-x-1 z-20 flex items-center justify-between pointer-events-none">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  store.getState().setOutputFrozen(i, !output.frozen);
                }}
                aria-pressed={output.frozen === true}
                aria-label={output.frozen
                  ? t('designer_unfreeze_format', 'Unfreeze format')
                  : t('designer_freeze_format', 'Freeze format')}
                data-tooltip-id="tooltip"
                data-tooltip-content={output.frozen
                  ? t('designer_unfreeze_format_hint', 'Allow edits to this format')
                  : t('designer_freeze_format_hint', 'Prevent edits to this format')}
                className={`pointer-events-auto w-7 h-7 flex items-center justify-center rounded-full bg-newBgColorInner border text-[13px] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-designerAccent ${
                  output.frozen
                    ? 'border-designerAccent text-btnPrimaryAccent'
                    : 'border-studioBorder text-textColor/40 hover:text-textColor'
                }`}
              >
                ❄
              </button>
              <div className="flex items-center gap-1 pointer-events-none">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openPopover('formatActions', e.currentTarget as HTMLElement, { outputIndex: i });
                  }}
                  data-tooltip-id="tooltip"
                  data-tooltip-content={t('designer_format_actions', 'Format actions')}
                  aria-label={t('designer_format_actions_for', 'Format actions for {{name}}', { name: output.name })}
                  className="pointer-events-auto w-7 h-7 flex items-center justify-center rounded-full bg-newBgColorInner border border-studioBorder text-[13px] text-textColor/60 hover:text-textColor focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-designerAccent"
                >
                  ⋮
                </button>
                {outputs.length > 1 && (
                  <button
                    type="button"
                    onClick={(e) => handleRemove(e, i)}
                    disabled={output.frozen === true}
                    data-tooltip-id="tooltip"
                    data-tooltip-content={t('designer_remove_format', 'Remove format')}
                    aria-label={t('designer_remove_format', 'Remove format')}
                    className={`pointer-events-auto w-7 h-7 flex items-center justify-center rounded-full bg-newBgColorInner border border-studioBorder text-[14px] text-dangerText hover:bg-red-500/20 disabled:opacity-30 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-designerAccent ${
                      i === currentOutput
                        ? 'visible'
                        : 'invisible group-hover:visible group-focus-within:visible'
                    }`}
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}

        {showOverflow && (
          <div className="relative shrink-0">
            <button
              ref={overflowBtnRef}
              onClick={(e) => {
                if (popoverKind === 'overflow') {
                  closePopover();
                } else {
                  openPopover('overflow', e.currentTarget as HTMLElement);
                }
              }}
              aria-label={t('designer_more_formats_aria', 'More formats')}
              className="flex items-center justify-center rounded-md border border-studioBorder text-textColor/60 hover:border-studioBorder hover:text-textColor text-[13px] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-designerAccent"
              style={{ width: 32, height: THUMB_H }}
            >
              …
            </button>
            <PortalPopover
              anchorEl={showOverflowMenu ? popoverAnchor : null}
              open={showOverflowMenu}
              onClose={closePopover}
              className="bg-newBgColorInner border border-studioBorder rounded-lg shadow-xl overflow-hidden"
            >
              <div className="max-h-60 overflow-y-auto w-52">
                {outputs.map((output: any, i: number) => (
                  <div
                    key={output.id}
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-studioBorder/10 group/item"
                  >
                    <button
                      onClick={() => {
                        store.getState().setCurrentOutput(i);
                        closePopover();
                      }}
                      className={`flex-1 text-left text-[12px] ${
                        i === currentOutput
                          ? 'text-btnPrimaryAccent font-medium'
                          : 'text-textColor'
                      }`}
                    >
                      <span>{output.name}</span>
                      <span className="text-[10px] text-textColor/50 ml-1">
                        {output.width}×{output.height}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (overflowBtnRef.current) {
                          openPopover('formatActions', overflowBtnRef.current, { outputIndex: i });
                        }
                      }}
                      data-tooltip-id="tooltip"
                      data-tooltip-content={t('designer_format_actions', 'Format actions')}
                      aria-label={t('designer_format_actions_for', 'Format actions for {{name}}', { name: output.name })}
                      className="w-7 h-7 flex items-center justify-center rounded-sm text-[13px] text-textColor/40 hover:text-textColor opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100"
                    >
                      ⋮
                    </button>
                    {outputs.length > 1 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          handleRemove(e, i);
                          closePopover();
                        }}
                        disabled={output.frozen === true}
                        data-tooltip-id="tooltip"
                        data-tooltip-content={t('designer_remove_format', 'Remove format')}
                        aria-label={t('designer_remove_format', 'Remove format')}
                        className={`w-7 h-7 flex items-center justify-center rounded-sm text-[14px] text-dangerText hover:bg-red-500/20 disabled:opacity-30 group-hover/item:opacity-100 focus-visible:opacity-100 ${
                          i === currentOutput ? 'opacity-100' : 'opacity-0'
                        }`}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </PortalPopover>
          </div>
        )}
      </div>

      {editFormatOnly && (
        <button
          type="button"
          onClick={() => store.getState().setEditFormatOnly(false)}
          aria-label={t('designer_resume_linked_editing', 'Resume linked editing')}
          data-tooltip-id="tooltip"
          data-tooltip-content={t('designer_format_only_editing_hint', 'Edits stay local on whichever format is active. Click to resume linked editing.')}
          className="h-7 shrink-0 rounded-md border border-designerAccent bg-designerAccent/10 px-2 text-[10px] font-medium text-btnPrimaryAccent hover:bg-designerAccent/15 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-designerAccent"
        >
          {t('designer_format_only_editing', 'Format-only editing')}
        </button>
      )}

      {/* Add-format is available in BOTH modes now: image docs seed linked
          element copies, video docs clone+reflow a full timeline variant. */}
      <div className="relative shrink-0">
        <button
          ref={addBtnRef}
          type="button"
          onClick={(e) => {
            if (popoverKind === 'addFormats') {
              closePopover();
            } else {
              openPopover('addFormats', e.currentTarget as HTMLElement);
            }
          }}
          aria-label={t('designer_add_format_aria', 'Add format')}
          data-tooltip-id="tooltip"
          data-tooltip-content={t('designer_add_format_aria', 'Add format')}
          className="shrink-0 flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-studioBorder px-2 text-textColor/50 hover:border-designerAccent hover:text-btnPrimaryAccent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-designerAccent disabled:opacity-30 disabled:hover:border-studioBorder"
          style={{ minWidth: 96, height: THUMB_H }}
        >
          <span className="text-[22px] leading-none">+</span>
          <span className="text-[11px] font-medium">{t('designer_add_format_aria', 'Add format')}</span>
        </button>

        <PortalPopover
          anchorEl={showAddFormats ? popoverAnchor : null}
          open={showAddFormats}
          onClose={closePopover}
          align="right"
          className="bg-newBgColorInner border border-studioBorder rounded-lg shadow-xl overflow-hidden w-72 p-3"
        >
          <div className="text-[12px] font-medium text-textColor mb-2">
            {mode === 'video'
              ? t('designer_add_video_format_heading', 'Add Video Format')
              : t('designer_add_formats_heading', 'Add Formats')}
          </div>

          <fieldset className="mb-2 rounded-md border border-studioBorder p-2">
            <legend className="px-1 text-[10px] text-textColor/60">{t('designer_output_content_mode', 'Content')}</legend>
            <label className="flex items-center gap-2 px-1 py-1 text-[11px] text-textColor">
              <input
                type="radio"
                name="output-content-mode"
                checked={linkContent}
                onChange={() => setLinkContent(true)}
                className="accent-designerAccent"
              />
              {t('designer_output_linked', 'Linked formats (shared edits)')}
            </label>
            <label className="flex items-center gap-2 px-1 py-1 text-[11px] text-textColor">
              <input
                type="radio"
                name="output-content-mode"
                checked={!linkContent}
                onChange={() => setLinkContent(false)}
                className="accent-designerAccent"
              />
              {t('designer_output_independent', 'Independent copies (carousel / pages)')}
            </label>
          </fieldset>

          {mode === 'image' && (
          <button
            onClick={() => {
              setPendingFormats(new Set(RECOMMENDED_IDS.filter(
                (id) => !outputs.some((output) => output.formatId === id)
              )));
            }}
            className="w-full text-left px-2 py-1.5 rounded-sm text-[11px] text-btnPrimaryAccent hover:bg-designerAccent/10 mb-2 border border-designerAccent/30"
          >
            {t('designer_recommended_set_description', 'Recommended set (IG Post + Story + LinkedIn + X)')}
          </button>
          )}

          <div className="max-h-52 overflow-y-auto space-y-0.5">
            {Object.entries(CHANNEL_GROUPS).map(
              ([key, group]) => {
                if (group.presets.length === 0) return null;
                // Video docs clone timeline variants — only video-category
                // presets fit; image docs keep the image preset groups.
                if (mode === 'video' ? group.mode !== 'video' : group.mode === 'video') return null;
                return (
                  <div key={key}>
                    <div className="text-[10px] font-semibold text-textColor/30 uppercase tracking-wider px-1 py-1">
                      {key === 'custom' ? t('designer_group_custom', 'Custom') : group.label}
                    </div>
                    {group.presets.map((p) => {
                      return (
                        <label
                          key={p.id}
                          className={`flex items-center gap-2 px-2 py-1.5 rounded text-[12px] ${
                            pendingFormats.has(p.id)
                              ? 'text-btnPrimaryAccent bg-designerAccent/10 cursor-pointer hover:bg-designerAccent/15'
                              : 'text-textColor cursor-pointer hover:bg-studioBorder/10'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={pendingFormats.has(p.id)}
                            onChange={() => toggleFormat(p.id)}
                            className="w-3.5 h-3.5 accent-designerAccent disabled:opacity-30 shrink-0"
                          />
                          <span className="flex-1 truncate">
                            {p.name}
                          </span>
                          <span className="text-[10px] text-textColor/40">
                            {p.width}×{p.height}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                );
              },
            )}
          </div>

          <div className="border-t border-studioBorder mt-2 pt-2">
            <div className="text-[10px] font-semibold text-textColor/30 uppercase tracking-wider px-1 mb-1">
              {t('designer_custom_size_heading', 'Custom Size')}
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                value={cW}
                onChange={(e) => setCW(e.target.value)}
                placeholder={t('designer_width_short', 'W')}
                className="w-16 h-7 rounded-sm border border-studioBorder bg-newBgColor px-2 text-[11px] text-textColor text-center outline-hidden focus:border-designerAccent"
              />
              <span className="text-textColor/30 text-[12px]">
                ×
              </span>
              <input
                type="number"
                value={cH}
                onChange={(e) => setCH(e.target.value)}
                placeholder={t('designer_height_short', 'H')}
                className="w-16 h-7 rounded-sm border border-studioBorder bg-newBgColor px-2 text-[11px] text-textColor text-center outline-hidden focus:border-designerAccent"
              />
              <button
                onClick={handleAddCustom}
                className="h-7 px-2 rounded-sm text-[11px] border border-designerAccent text-btnPrimaryAccent hover:bg-designerAccent/10 shrink-0"
              >
                {t('designer_add_custom_size', 'Add custom size')}
              </button>
            </div>
          </div>

          {pendingFormats.size > 0 && (
            <div className="border-t border-studioBorder mt-2 pt-2">
              <button
                onClick={handleAddFormats}
                className="w-full py-1.5 rounded-sm text-[12px] bg-designerAccent text-white hover:bg-designerAccent/80 font-medium"
              >
                {t('designer_add_n_formats', 'Add {{count}} format', { count: pendingFormats.size })}
              </button>
            </div>
          )}
        </PortalPopover>
      </div>

      <PortalPopover
        anchorEl={showFormatActions && formatActionsOutput ? popoverAnchor : null}
        open={showFormatActions && !!formatActionsOutput}
        onClose={closePopover}
        className="bg-newBgColorInner border border-studioBorder rounded-lg shadow-xl overflow-hidden w-72 p-1.5"
      >
        {formatActionsOutput && formatActionsIndex !== null && (
          <div className="space-y-0.5" aria-label={formatActionsOutput.name}>
            <div className="px-2 py-1.5 text-[11px] font-medium text-textColor/60 truncate">
              {formatActionsOutput.name}
            </div>
            <button
              type="button"
              disabled={formatActionsOutput.frozen === true}
              onClick={() => {
                if (popoverAnchor) {
                  openPopover('resize', popoverAnchor, { resizeIndex: formatActionsIndex });
                }
              }}
              className="w-full min-h-9 rounded-sm px-2 py-1.5 text-start text-[12px] text-textColor hover:bg-studioBorder/10 disabled:opacity-30"
            >
              {t('designer_resize_change_format_title', 'Resize / change format')}
            </button>
            <button
              type="button"
              disabled={formatActionsOutput.frozen === true}
              onClick={() => void handleRename(formatActionsIndex)}
              className="w-full min-h-9 rounded-sm px-2 py-1.5 text-start text-[12px] text-textColor hover:bg-studioBorder/10 disabled:opacity-30"
            >
              {t('designer_rename_format', 'Rename format')}
            </button>
            <button
              type="button"
              aria-pressed={editFormatOnly}
              onClick={() => handleToggleFormatLink(formatActionsIndex)}
              className="w-full rounded-sm px-2 py-1.5 text-start hover:bg-studioBorder/10"
            >
              <span className="block text-[12px] text-textColor">
                {editFormatOnly
                  ? t('designer_link_format_edits', 'Link edits across formats')
                  : t('designer_unlink_format_edits', 'Unlink edits between formats')}
              </span>
              <span className="mt-0.5 block text-[10px] leading-snug text-textColor/50">
                {editFormatOnly
                  ? t('designer_link_format_edits_hint', 'Resume shared element edits; existing element links are preserved')
                  : t('designer_unlink_format_edits_hint', 'Edit whichever format is active without syncing linked elements; existing links are preserved')}
              </span>
            </button>
          </div>
        )}
      </PortalPopover>

      <PortalPopover
        anchorEl={showResize ? popoverAnchor : null}
        open={showResize}
        onClose={closePopover}
        className="bg-newBgColorInner border border-studioBorder rounded-lg shadow-xl overflow-hidden w-64 p-3"
      >
        <div className="text-[12px] font-medium text-textColor mb-2">
          {t('designer_resize_format_heading', 'Resize Format')}
        </div>
        <div className="max-h-48 overflow-y-auto space-y-0.5">
          {CHANNEL_PRESETS.filter(
            (p) => p.id !== 'custom' && (mode === 'image' ? p.category !== 'video' : p.category === 'video')
          ).map(
            (p) => (
              <button
                key={p.id}
                onClick={() =>
                  handleResize(resizeIndex!, p)
                }
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-left text-[12px] text-textColor hover:bg-studioBorder/10"
              >
                <span className="flex-1">{p.name}</span>
                <span className="text-[10px] text-textColor/40">
                  {p.width}×{p.height}
                </span>
              </button>
            ),
          )}
        </div>
        <div className="border-t border-studioBorder mt-2 pt-2">
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              value={cW}
              onChange={(e) => setCW(e.target.value)}
              placeholder={t('designer_width_short', 'W')}
              className="w-16 h-7 rounded-sm border border-studioBorder bg-newBgColor px-2 text-[11px] text-textColor text-center outline-hidden focus:border-designerAccent"
            />
            <span className="text-textColor/30 text-[12px]">
              ×
            </span>
            <input
              type="number"
              value={cH}
              onChange={(e) => setCH(e.target.value)}
              placeholder={t('designer_height_short', 'H')}
              className="w-16 h-7 rounded-sm border border-studioBorder bg-newBgColor px-2 text-[11px] text-textColor text-center outline-hidden focus:border-designerAccent"
            />
            <button
              onClick={() =>
                handleResizeCustom(resizeIndex!)
              }
              className="h-7 px-2 rounded-sm text-[11px] bg-designerAccent text-white hover:bg-designerAccent/80 shrink-0"
            >
              {t('apply', 'Apply')}
            </button>
          </div>
        </div>
      </PortalPopover>
    </div>
  );
});

export default OutputTabs;
