'use client';

import React, { FC, useState } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { pageCount } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.pages';
import { MAX_PAGES_PER_OUTPUT } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.limits';
import type { DesignerOutput } from '../designer.store';
import { FormatThumbnail } from '../format-thumbnail';

/**
 * Pages and Carousel are two views of the same image-output pages. Carousel
 * adds after any slide and may promote the next slide when slide 1 is deleted.
 * Lazy, bounded thumbnails never allocate a full-resolution offscreen stage.
 */

interface PagesPanelProps {
  store: ReturnType<typeof import('../designer.store').createDesignerStore>;
  visible: boolean;
}

export const PagesPanel: FC<PagesPanelProps> = ({ store, visible }) => {
  const t = useT();
  const doc = store((s) => s.doc);
  const currentOutput = store((s) => s.currentOutput);
  const currentPage = store((s) => s.currentPage);
  const output = doc.outputs[currentOutput] as DesignerOutput | undefined;

  const count = output && 'children' in output ? pageCount(output) : 1;
  const [view, setView] = useState<'pages' | 'carousel'>('pages');
  const [editingPage, setEditingPage] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const carousel = view === 'carousel';
  const thumbH = carousel ? 96 : 64;

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
      <div className="flex shrink-0 items-center rounded-md border border-studioBorder p-0.5" role="group" aria-label={t('designer_page_view', 'Page view')}>
        {(['pages', 'carousel'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setView(option)}
            aria-pressed={view === option}
            className={`rounded-sm px-2 py-1 text-[10px] font-medium focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-designerAccent ${
              view === option
                ? 'bg-designerAccent/10 text-btnPrimaryAccent'
                : 'text-textColor/50 hover:text-textColor'
            }`}
          >
            {option === 'pages'
              ? t('designer_pages', 'Pages')
              : t('designer_carousel', 'Carousel')}
          </button>
        ))}
      </div>
      {Array.from({ length: count }, (_, i) => (
        <React.Fragment key={i === 0 ? `${output.id}-base` : output.pages?.[i - 1]?.id ?? i}>
        <div
          className={`relative group shrink-0 rounded-md border-2 ${
            i === currentPage
              ? 'border-designerAccent'
              : dropAt === i && dragFrom !== null && dragFrom !== i
                ? 'border-designerAccent/50'
                : 'border-studioBorder'
          }`}
          draggable={editingPage !== i && !output.frozen}
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
            <FormatThumbnail
              output={output}
              symbols={doc.symbols}
              pageNumber={i}
              maxDim={112}
              className={`${carousel ? 'h-[96px]' : 'h-[64px]'} flex items-center justify-center`}
            />
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
              disabled={output.frozen || count >= MAX_PAGES_PER_OUTPUT}
              title={t('designer_duplicate_page', 'Duplicate page')}
              aria-label={t('designer_duplicate_page', 'Duplicate page')}
              className="w-4 h-4 flex items-center justify-center rounded-full bg-newBgColorInner border border-studioBorder text-[8px] text-textColor/60 hover:text-textColor disabled:opacity-30"
            >
              ⧉
            </button>
            {(i > 0 || carousel) && count > 1 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  store.getState().removePage(i, carousel);
                }}
                disabled={output.frozen}
                title={t('designer_delete_page', 'Delete page')}
                aria-label={t('designer_delete_page', 'Delete page')}
                className="w-4 h-4 flex items-center justify-center rounded-full bg-newBgColorInner border border-studioBorder text-[9px] text-dangerText hover:bg-red-500/20 disabled:opacity-30"
              >
                ×
              </button>
            )}
          </div>
        </div>
        {carousel && (
          <button
            type="button"
            onClick={() => store.getState().addPage(undefined, i)}
            disabled={output.frozen || count >= MAX_PAGES_PER_OUTPUT}
            aria-label={t('designer_add_slide_after', 'Add slide after {{number}}', { number: i + 1 })}
            title={t('designer_add_slide_after', 'Add slide after {{number}}', { number: i + 1 })}
            className="shrink-0 flex items-center justify-center rounded-md border-2 border-dashed border-studioBorder text-textColor/50 hover:border-designerAccent hover:text-btnPrimaryAccent text-[16px] disabled:opacity-30 disabled:hover:border-studioBorder focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-designerAccent"
            style={{ width: 32, height: thumbH + 18 }}
          >
            +
          </button>
        )}
        </React.Fragment>
      ))}
      {!carousel && (
        <button
          type="button"
          onClick={() => store.getState().addPage()}
          disabled={output.frozen || count >= MAX_PAGES_PER_OUTPUT}
          aria-label={t('designer_add_page', 'Add page')}
          title={t('designer_add_page', 'Add page')}
          className="shrink-0 flex items-center justify-center rounded-md border-2 border-dashed border-studioBorder text-textColor/50 hover:border-designerAccent hover:text-btnPrimaryAccent text-[16px] disabled:opacity-30 disabled:hover:border-studioBorder focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-designerAccent"
          style={{ width: 32, height: thumbH + 18 }}
        >
          +
        </button>
      )}
    </div>
  );
};

export default PagesPanel;
