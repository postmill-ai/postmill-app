'use client';

import React, { FC, useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import {
  pageChildren,
  pageBackground,
  pageCount,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.pages';
import { MAX_PAGES_PER_OUTPUT } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.limits';
import type { DesignerOutput } from '../designer.store';
import { renderOutputThumbnail } from '../export-dialog';

/**
 * Multi-page strip (doc v8, image mode only): one thumbnail per page of the
 * CURRENT output — add / duplicate / rename / reorder / delete. Page 1 is the
 * output's own `children` and can be renamed only via the output tab (and
 * never deleted). Thumbnails render off the shared Konva stage into an
 * off-screen host (renderOutputThumbnail, the export pipeline's renderer), so
 * the strip never steals the main stage.
 */

interface PagesPanelProps {
  store: ReturnType<typeof import('../designer.store').createDesignerStore>;
  /** View ▸ Pages visibility (image mode only) — hidden by default, toggled
   *  per org, auto-visible when the active output has extra pages. */
  visible: boolean;
}

const THUMB_H = 64;

export const PagesPanel: FC<PagesPanelProps> = ({ store, visible }) => {
  const t = useT();
  const doc = store((s) => s.doc);
  const currentOutput = store((s) => s.currentOutput);
  const currentPage = store((s) => s.currentPage);
  const output = doc.outputs[currentOutput] as DesignerOutput | undefined;

  const count = output && 'children' in output ? pageCount(output) : 1;

  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [editingPage, setEditingPage] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const renderSeq = useRef(0);

  // A doc fingerprint per page so an unrelated edit (another output, a video
  // tick) doesn't re-render every thumbnail.
  const pageKeys = useMemo(() => {
    if (!output || !('children' in output)) return [] as string[];
    return Array.from({ length: count }, (_, i) =>
      JSON.stringify({
        c: pageChildren(output, i),
        b: pageBackground(output, i),
        w: output.width,
        h: output.height,
      }).length
    );
  }, [output, count]);
  const pageKey = pageKeys.join('|');

  useEffect(() => {
    if (!output || !('children' in output)) return;
    const seq = ++renderSeq.current;
    const out = output;
    let cancelled = false;
    (async () => {
      const next: Record<number, string> = {};
      for (let i = 0; i < count; i++) {
        if (cancelled || renderSeq.current !== seq) return;
        const view: DesignerOutput = {
          ...out,
          bg: pageBackground(out, i),
          children: pageChildren(out, i),
        };
        const dataUrl = await renderOutputThumbnail(view, doc.symbols as never).catch(
          () => undefined
        );
        if (dataUrl) next[i] = dataUrl;
      }
      if (!cancelled && renderSeq.current === seq) setThumbs(next);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pageKey IS the doc-derived dep; output/doc are read for the render inputs it summarizes.
  }, [pageKey, currentOutput, count]);

  if (!visible || !output || doc.mode !== 'image' || !('children' in output)) return null;

  const nameOf = (i: number) =>
    (i > 0 && output.pages?.[i - 1]?.name) ||
    t('designer_page_number', 'Page {{number}}', { number: i + 1 });

  const commitRename = (i: number) => {
    if (editingPage === null) return;
    store.getState().renamePage(i, editingName);
    setEditingPage(null);
  };

  return (
    <div
      className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-t border-studioBorder bg-newBgColorInner overflow-x-auto"
      aria-label={t('designer_pages', 'Pages')}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-textColor/40 shrink-0">
        {t('designer_pages', 'Pages')}
      </span>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i === 0 ? `${output.id}-base` : output.pages?.[i - 1]?.id ?? i}
          className={`relative group shrink-0 rounded-md border-2 ${
            i === currentPage
              ? 'border-designerAccent'
              : dropAt === i && dragFrom !== null && dragFrom !== i
                ? 'border-designerAccent/50'
                : 'border-studioBorder'
          }`}
          draggable={editingPage !== i}
          onDragStart={() => setDragFrom(i)}
          onDragOver={(e) => {
            e.preventDefault();
            setDropAt(i);
          }}
          onDragLeave={() => setDropAt((cur) => (cur === i ? null : cur))}
          onDrop={(e) => {
            e.preventDefault();
            if (dragFrom !== null && dragFrom !== i) {
              store.getState().reorderPage(dragFrom, i);
            }
            setDragFrom(null);
            setDropAt(null);
          }}
          onDragEnd={() => {
            setDragFrom(null);
            setDropAt(null);
          }}
        >
          <button
            type="button"
            onClick={() => store.getState().setCurrentPage(i)}
            onDoubleClick={() => {
              if (i === 0) return;
              setEditingPage(i);
              setEditingName(output.pages?.[i - 1]?.name ?? '');
            }}
            className="flex flex-col items-center gap-0.5 p-1 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-designerAccent"
            aria-label={nameOf(i)}
            aria-current={i === currentPage}
            title={t('designer_page_double_click_rename', 'Double-click to rename')}
          >
            <span
              className="block rounded-sm bg-white overflow-hidden flex items-center justify-center"
              style={{ height: THUMB_H, aspectRatio: `${output.width} / ${output.height}` }}
            >
              {thumbs[i] ? (
                // eslint-disable-next-line @next/next/no-img-element -- data URL thumb rendered off the Konva stage
                <img src={thumbs[i]} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="w-full h-full bg-studioBorder/20" />
              )}
            </span>
            {editingPage === i ? (
              <input
                autoFocus
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onBlur={() => commitRename(i)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename(i);
                  if (e.key === 'Escape') setEditingPage(null);
                }}
                onClick={(e) => e.stopPropagation()}
                className="w-20 h-5 rounded-sm border border-designerAccent bg-newBgColor px-1 text-[10px] text-textColor text-center outline-hidden"
                aria-label={t('designer_rename_page', 'Rename page')}
              />
            ) : (
              <span className="text-[10px] text-textColor/70 leading-none max-w-[76px] truncate">
                {nameOf(i)}
              </span>
            )}
          </button>
          <div className="absolute -top-1.5 -right-1.5 hidden group-hover:flex items-center gap-0.5 z-10">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                store.getState().duplicatePage(i);
              }}
              disabled={count >= MAX_PAGES_PER_OUTPUT}
              title={t('designer_duplicate_page', 'Duplicate page')}
              aria-label={t('designer_duplicate_page', 'Duplicate page')}
              className="w-4 h-4 flex items-center justify-center rounded-full bg-newBgColorInner border border-studioBorder text-[8px] text-textColor/60 hover:text-textColor"
            >
              ⧉
            </button>
            {i > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  store.getState().removePage(i);
                }}
                title={t('designer_delete_page', 'Delete page')}
                aria-label={t('designer_delete_page', 'Delete page')}
                className="w-4 h-4 flex items-center justify-center rounded-full bg-newBgColorInner border border-studioBorder text-[9px] text-dangerText hover:bg-red-500/20"
              >
                ×
              </button>
            )}
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => store.getState().addPage()}
        disabled={count >= MAX_PAGES_PER_OUTPUT}
        aria-label={t('designer_add_page', 'Add page')}
        title={t('designer_add_page', 'Add page')}
        className="shrink-0 flex items-center justify-center rounded-md border-2 border-dashed border-studioBorder text-textColor/50 hover:border-designerAccent hover:text-btnPrimaryAccent text-[16px] disabled:opacity-30 disabled:hover:border-studioBorder focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-designerAccent"
        style={{ width: 32, height: THUMB_H + 18 }}
      >
        +
      </button>
    </div>
  );
};

export default PagesPanel;
