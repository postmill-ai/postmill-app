'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import {
  CHANNEL_PRESETS,
  type ChannelPreset,
} from '@postmill-ai/nestjs-libraries/integrations/social/channel-presets';
import { pageChildren, pageCount } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.pages';
import { FormatThumbnail } from './format-thumbnail';

interface OutputTabsProps {
  store: any;
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
const THUMB_MIN_W = 100;

type PopoverKind = 'addFormats' | 'overflow' | 'resize';

interface PopoverState {
  kind: PopoverKind;
  anchor: HTMLElement;
  resizeIndex?: number;
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

export const OutputTabs = React.memo(function OutputTabs({ store }: OutputTabsProps) {
  const t = useT();
  const doc = store((s: any) => s.doc);
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

  const scrollRef = useRef<HTMLDivElement>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const overflowBtnRef = useRef<HTMLButtonElement>(null);

  const closePopover = useCallback(() => setPopover(null), []);

  const openPopover = useCallback(
    (kind: PopoverKind, el: HTMLElement, extra?: Partial<Pick<PopoverState, 'resizeIndex'>>) => {
      setPopover({ kind, anchor: el, ...extra });
    },
    [],
  );

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
    if (outputs.length <= 1) return;
    store.getState().removeOutput(i);
  };

  const toggleFormat = (id: string) => {
    setPendingFormats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAddFormats = () => {
    const s = store.getState();
    for (const id of pendingFormats) {
      const preset = CHANNEL_PRESETS.find((p) => p.id === id);
      if (preset)
        s.addOutput({
          formatId: preset.id,
          name: preset.name,
          width: preset.width,
          height: preset.height,
        }, { linkContent });
    }
    setPendingFormats(new Set());
    closePopover();
  };

  const handleAddCustom = () => {
    const w = parseInt(cW, 10);
    const h = parseInt(cH, 10);
    if (w > 0 && h > 0) {
      store.getState().addOutput({
        formatId: 'custom',
        name: `${w}×${h}`,
        width: w,
        height: h,
      }, { linkContent });
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
      store
        .getState()
        .resizeOutput(index, w, h, undefined, `${w}×${h}`);
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

  return (
    <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-t border-studioBorder bg-newBgColorInner">
      <div
        ref={scrollRef}
        className="flex items-center gap-1 overflow-x-auto flex-1 min-w-0"
      >
        {outputs.map((output: any, i: number) => (
          <div
            key={output.id}
            className="relative group shrink-0"
          >
            <button
              onClick={() => store.getState().setCurrentOutput(i)}
              aria-current={i === currentOutput}
              className={`relative rounded-md border-2 flex flex-col items-center justify-center text-center px-2 gap-0.5 transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-designerAccent ${
                i === currentOutput
                  ? 'border-designerAccent bg-designerAccent/10'
                  : 'border-studioBorder hover:border-studioBorder'
              }`}
              style={{ minWidth: THUMB_MIN_W, height: THUMB_H }}
            >
              {i !== currentOutput && Array.isArray(output.children) && output.children.some((c: any) => c?.originId && activeOriginIds.has(c.originId)) && (
                <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-designerAccent" title={t('designer_has_linked_elements', 'Has linked elements')} />
              )}
              {(() => {
                const updatedAt = i !== currentOutput ? linkedUpdateFlash[i] : 0;
                const isUpdated = updatedAt && Date.now() - updatedAt < 1500;
                return isUpdated ? (
                  <div
                    className={`absolute top-1 left-1 w-2 h-2 rounded-full bg-green-400 ${reduceMotion ? '' : 'animate-pulse'}`}
                    title={t('designer_updated_from_another_format', 'Updated from another format')}
                  />
                ) : null;
              })()}
              <FormatThumbnail
                output={output}
                symbols={doc.symbols}
                maxDim={72}
                className="h-[32px] max-w-[54px]"
              />
              <span className="text-[11px] font-medium text-textColor leading-tight truncate max-w-[80px]">
                {output.name}
              </span>
              <span className="text-[9px] text-textColor/50 leading-none">
                {output.width}×{output.height}
              </span>
              {mode === 'image' && pageCount(output) > 1 && (
                <span
                  className="absolute bottom-1 right-1 rounded-sm bg-designerAccent/15 text-btnPrimaryAccent text-[8px] leading-none px-1 py-0.5"
                  title={t('designer_pages_count', '{{count}} pages', { count: pageCount(output) })}
                >
                  {pageCount(output)}p
                </span>
              )}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                store.getState().setOutputFrozen(i, !output.frozen);
              }}
              aria-pressed={output.frozen === true}
              aria-label={output.frozen
                ? t('designer_unfreeze_format', 'Unfreeze format')
                : t('designer_freeze_format', 'Freeze format')}
              title={output.frozen
                ? t('designer_unfreeze_format_hint', 'Allow edits to this format')
                : t('designer_freeze_format_hint', 'Prevent edits to this format')}
              className={`absolute -top-1.5 -left-1.5 z-20 w-5 h-5 flex items-center justify-center rounded-full bg-newBgColorInner border text-[11px] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-designerAccent ${
                output.frozen
                  ? 'border-designerAccent text-btnPrimaryAccent'
                  : 'border-studioBorder text-textColor/40 hover:text-textColor'
              }`}
            >
              ❄
            </button>
            <div className="absolute -top-1.5 -right-1.5 hidden group-hover:flex items-center gap-0.5 z-10">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  openPopover('resize', e.currentTarget as HTMLElement, { resizeIndex: i });
                }}
                disabled={output.frozen === true}
                title={t('designer_resize_change_format_title', 'Resize / change format')}
                aria-label={t('designer_resize_or_change_format_aria', 'Resize or change format')}
                className="w-4 h-4 flex items-center justify-center rounded-full bg-newBgColorInner border border-studioBorder text-[8px] text-textColor/60 hover:text-textColor disabled:opacity-30"
              >
                ⋮
              </button>
              {outputs.length > 1 && (
                <button
                  onClick={(e) => handleRemove(e, i)}
                  disabled={output.frozen === true}
                  title={t('designer_remove_format', 'Remove format')}
                  aria-label={t('designer_remove_format', 'Remove format')}
                  className="w-4 h-4 flex items-center justify-center rounded-full bg-newBgColorInner border border-studioBorder text-[9px] text-dangerText hover:bg-red-500/20 disabled:opacity-30"
                >
                  ×
                </button>
              )}
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
                      onClick={(e) => {
                        e.stopPropagation();
                        openPopover('resize', e.currentTarget as HTMLElement, { resizeIndex: i });
                      }}
                      title={t('designer_resize_change_format_title', 'Resize / change format')}
                      aria-label={t('designer_resize_or_change_format_aria', 'Resize or change format')}
                      className="w-5 h-5 flex items-center justify-center rounded-sm text-[10px] text-textColor/40 hover:text-textColor opacity-0 group-hover/item:opacity-100"
                    >
                      ⋮
                    </button>
                    {outputs.length > 1 && (
                      <button
                        onClick={(e) => {
                          handleRemove(e, i);
                          closePopover();
                        }}
                        aria-label={t('designer_remove_format', 'Remove format')}
                        className="w-5 h-5 flex items-center justify-center rounded-sm text-[10px] text-dangerText hover:bg-red-500/20 opacity-0 group-hover/item:opacity-100"
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

      <button
        onClick={() => store.getState().setEditFormatOnly(!editFormatOnly)}
        aria-pressed={!editFormatOnly}
        aria-label={editFormatOnly
          ? t('designer_link_format_edits', 'Link edits across formats')
          : t('designer_unlink_format_edits', 'Unlink edits between formats')}
        title={editFormatOnly
          ? t('designer_link_format_edits_hint', 'Resume shared element edits; existing element links are preserved')
          : t('designer_unlink_format_edits_hint', 'Edit this format only; existing element links are preserved')}
        className={`shrink-0 rounded-md border px-2 text-[10px] font-medium focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-designerAccent ${
          editFormatOnly
            ? 'border-studioBorder text-textColor/60'
            : 'border-designerAccent bg-designerAccent/10 text-btnPrimaryAccent'
        }`}
        style={{ width: 58, height: THUMB_H }}
      >
        {editFormatOnly
          ? t('designer_link_edits', 'Link')
          : t('designer_unlink_edits', 'Unlink')}
      </button>

      {/* Add-format is available in BOTH modes now: image docs seed linked
          element copies, video docs clone+reflow a full timeline variant. */}
      <div className="relative shrink-0">
        <button
          ref={addBtnRef}
          disabled={outputs[currentOutput]?.frozen === true}
          onClick={(e) => {
            if (popoverKind === 'addFormats') {
              closePopover();
            } else {
              openPopover('addFormats', e.currentTarget as HTMLElement);
            }
          }}
          aria-label={t('designer_add_format_aria', 'Add format')}
          className="shrink-0 flex items-center justify-center rounded-md border-2 border-dashed border-studioBorder text-textColor/50 hover:border-designerAccent hover:text-btnPrimaryAccent text-[18px] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-designerAccent disabled:opacity-30 disabled:hover:border-studioBorder"
          style={{ width: 40, height: THUMB_H }}
        >
          +
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
              {t('designer_output_independent', 'Independent copies (separate edits)')}
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
