'use client';

import React, { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDebounce } from 'use-debounce';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { StockPreviewModal } from './stock-preview-modal';
import { StockVectorItem, stockSourceLabel } from './stock.types';
import { useStockSearch } from './use-stock-search';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

// Values must match Pixabay's `colors` parameter exactly
// (https://pixabay.com/api/docs/) — e.g. `grayscale`/`lilac`, not `black_and_white`/`purple`.
const COLOR_SWATCHES: { value: string; label: string; swatch: string }[] = [
  { value: 'grayscale', label: 'B&W', swatch: 'linear-gradient(90deg, #000000 50%, #FFFFFF 50%)' },
  { value: 'transparent', label: 'Transparent', swatch: 'repeating-conic-gradient(#bbb 0% 25%, #fff 0% 50%) 50% / 10px 10px' },
  { value: 'black', label: 'Black', swatch: '#000000' },
  { value: 'white', label: 'White', swatch: '#FFFFFF' },
  { value: 'gray', label: 'Gray', swatch: '#9E9E9E' },
  { value: 'red', label: 'Red', swatch: '#F44336' },
  { value: 'orange', label: 'Orange', swatch: '#FF5722' },
  { value: 'yellow', label: 'Yellow', swatch: '#FFEB3B' },
  { value: 'green', label: 'Green', swatch: '#8BC34A' },
  { value: 'turquoise', label: 'Turquoise', swatch: '#1ABC9C' },
  { value: 'blue', label: 'Blue', swatch: '#2196F3' },
  { value: 'lilac', label: 'Lilac', swatch: '#9C27B0' },
  { value: 'pink', label: 'Pink', swatch: '#EC407A' },
  { value: 'brown', label: 'Brown', swatch: '#795548' },
];

// Maps a swatch's stable API `value` to its translation key (labels themselves
// live at module scope and can't call the translation hook).
const COLOR_KEY: Record<string, string> = {
  grayscale: 'color_bw',
  transparent: 'color_transparent',
  black: 'color_black',
  white: 'color_white',
  gray: 'color_gray',
  red: 'color_red',
  orange: 'orange',
  yellow: 'color_yellow',
  green: 'green',
  turquoise: 'color_turquoise',
  blue: 'blue',
  lilac: 'color_lilac',
  pink: 'color_pink',
  brown: 'color_brown',
};

const SUGGESTED_SEARCHES = ['Business', 'Nature', 'Abstract', 'Technology', 'People'];

interface StockVectorsProps {
  mode?: 'browse' | 'select';
  onSelect?: (item: { url: string; width: number; height: number; thumbnail?: string; type: 'image' | 'video' | 'audio' }) => void;
  onSelectFull?: (item: {
    url: string;
    width: number;
    height: number;
    thumbnail?: string;
    type: 'image' | 'video' | 'audio';
    source?: string;
    attribution?: Record<string, unknown>;
    name?: string;
  }) => void;
}

export const StockVectors: FC<StockVectorsProps> = ({ mode = 'browse', onSelect, onSelectFull }) => {
  const t = useT();
  const modal = useModals();
  const [query, setQuery] = useState('');
  const [debouncedQuery] = useDebounce(query, 300);
  const [orientation, setOrientation] = useState('');
  const [color, setColor] = useState('');

  const filters = useMemo(
    () => ({ orientation, color }),
    [orientation, color]
  );

  const {
    items,
    lastPage,
    error,
    isLoading,
    isValidating,
    size,
    setSize,
    mutate,
  } = useStockSearch<StockVectorItem>('/media/stock/vectors', debouncedQuery, filters);

  const totalPages = lastPage?.totalPages || 1;
  const hasMore = size < totalPages;

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || isLoading || isValidating) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setSize((s) => s + 1);
      },
      { rootMargin: '400px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, isLoading, isValidating, setSize, items.length]);

  const openVector = useCallback(
    (vector: StockVectorItem) =>
      modal.openModal({
        title: '',
        closeOnClickOutside: true,
        closeOnEscape: true,
        withCloseButton: true,
        classNames: { modal: 'w-[100%] max-w-[1100px] text-textColor' },
        children: <StockPreviewModal item={vector} type="vector" />,
        size: '80%',
      }),
    [modal]
  );

  const initialLoading = isLoading && items.length === 0 && !error;
  const showEmpty = !initialLoading && !error && items.length === 0;
  const isFirstFetch = size === 1;

  if (lastPage && !lastPage.configured) {
    return (
      <div className="flex items-center justify-center h-full text-newTextColor/60">
        {t('stock_browsing_not_configured', "Stock browsing isn't configured")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[15px]">
      <div className="flex flex-col sm:flex-row sm:items-center gap-[12px]">
        <div className="relative flex-1">
          <svg className="absolute left-[14px] top-1/2 -translate-y-1/2 w-[16px] h-[16px] text-newTextColor/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search_vectors_placeholder', 'Search vectors...')}
            className="w-full h-[44px] pl-[38px] pr-[34px] rounded-[8px] bg-newBgColorInner border border-newColColor text-[14px] outline-none focus:border-[#2B5CD3] text-textColor"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label={t('clear_search', 'Clear search')}
              className="absolute right-[10px] top-1/2 -translate-y-1/2 w-[20px] h-[20px] flex items-center justify-center text-newTextColor/60 hover:text-newTextColor rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2B5CD3]"
            >
              ✕
            </button>
          )}
        </div>
        <div className="relative">
          <select
            value={orientation}
            onChange={(e) => setOrientation(e.target.value)}
            aria-label={t('filter_by_orientation', 'Filter by orientation')}
            className="appearance-none h-[44px] w-full sm:w-auto pl-[12px] pr-[32px] rounded-[8px] bg-newBgColorInner border border-newColColor text-[13px] text-textColor outline-none cursor-pointer"
          >
            <option value="">{t('all_orientations', 'All orientations')}</option>
            <option value="horizontal">{t('horizontal', 'Horizontal')}</option>
            <option value="vertical">{t('vertical', 'Vertical')}</option>
          </select>
          <svg className="absolute right-[10px] top-1/2 -translate-y-1/2 w-[14px] h-[14px] text-newTextColor/60 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      <div className="flex items-center flex-wrap gap-[8px]">
        <button
          type="button"
          onClick={() => setColor('')}
          aria-pressed={color === ''}
          className={`h-[30px] px-[12px] rounded-full border text-[12px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2B5CD3] ${
            color === ''
              ? 'border-[#2B5CD3] bg-[#2B5CD3]/15 text-btnPrimaryAccent font-[500]'
              : 'border-newColColor text-newTextColor/70 hover:text-textColor hover:border-newTextColor/40'
          }`}
        >
          {t('all', 'All')}
        </button>
        {COLOR_SWATCHES.map((c) => {
          const colorLabel = t(COLOR_KEY[c.value] ?? c.value, c.label);
          return (
          <button
            key={c.value}
            type="button"
            onClick={() => setColor((cur) => (cur === c.value ? '' : c.value))}
            aria-pressed={color === c.value}
            aria-label={t('color_name', 'Color: {{color}}', { color: colorLabel })}
            title={colorLabel}
            className={`relative w-[30px] h-[30px] rounded-full border transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2B5CD3] hover:scale-110 ${
              color === c.value ? 'border-[#2B5CD3] ring-2 ring-[#2B5CD3]/40' : 'border-newColColor'
            }`}
          >
            <span className="absolute inset-[3px] rounded-full" style={{ background: c.swatch }} />
          </button>
          );
        })}
      </div>

      {error && items.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-[320px] gap-[10px] text-center px-[20px]">
          <svg className="w-[44px] h-[44px] text-newTextColor/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0 3.75h.008M10.34 3.94l-7.5 12.99A1.5 1.5 0 004.14 19.5h15.72a1.5 1.5 0 001.3-2.25l-7.5-12.99a1.5 1.5 0 00-2.6 0z" />
          </svg>
          <div className="text-[15px] font-[600] text-textColor">
            {t('something_went_wrong', 'Something went wrong')}{error.status ? ` (HTTP ${error.status})` : ''}
          </div>
          <div className="text-[13px] text-newTextColor/65 max-w-[320px]">
            {error.status === 401 || error.status === 403
              ? t('session_may_have_expired', 'Your session may have expired — try signing in again.')
              : t('could_not_reach_vector_library', "We couldn't reach the vector library. Give it another go in a moment.")}
          </div>
          <button
            type="button"
            onClick={() => mutate()}
            className="mt-[6px] px-[16px] h-[36px] rounded-[8px] bg-[#2B5CD3] text-white text-[13px] hover:bg-[#1e4ab5] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2B5CD3]"
          >
            {t('try_again', 'Try again')}
          </button>
        </div>
      ) : initialLoading ? (
        <div className="columns-2 sm:columns-3 lg:columns-4 xl:columns-5 gap-[12px]">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="mb-[12px] break-inside-avoid rounded-[8px] overflow-hidden border border-newBorder bg-newBgColorInner">
              <div
                className="bg-newColColor/20 animate-pulse rounded-[8px]"
                style={{ aspectRatio: i % 3 === 0 ? '3 / 4' : i % 3 === 1 ? '4 / 3' : '1 / 1' }}
              />
              <div className="p-[8px]">
                <div className="h-[11px] bg-newColColor/20 animate-pulse rounded-[4px] w-[60%]" />
              </div>
            </div>
          ))}
        </div>
      ) : showEmpty ? (
        <div className="flex flex-col items-center justify-center h-[320px] gap-[10px] text-center px-[20px]">
          <svg className="w-[44px] h-[44px] text-newTextColor/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M18 4.5h.008v.008H18V4.5zm.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15A2.25 2.25 0 002.25 6.75v10.5A2.25 2.25 0 004.5 19.5z" />
          </svg>
          <div className="text-[15px] font-[600] text-textColor">
            {debouncedQuery
              ? t('no_vectors_for_query', 'No vectors for "{{query}}"', { query: debouncedQuery })
              : t('find_perfect_vector', 'Find the perfect vector')}
          </div>
          <div className="text-[13px] text-newTextColor/65 max-w-[340px]">
            {debouncedQuery
              ? t('try_different_keyword', 'Try a different keyword or one of these popular searches.')
              : t('search_free_vectors_pixabay', 'Search millions of free vector illustrations from Pixabay to get started.')}
          </div>
          <div className="flex items-center flex-wrap justify-center gap-[8px] mt-[4px]">
            {SUGGESTED_SEARCHES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setQuery(s)}
                className="h-[30px] px-[14px] rounded-full border border-newColColor text-[12px] text-newTextColor/70 hover:text-btnPrimaryAccent hover:border-[#2B5CD3] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2B5CD3]"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="columns-2 sm:columns-3 lg:columns-4 xl:columns-5 gap-[12px]">
            {items.map((vector) => {
              // role=button div (not <button>) so the author-credit <a> is valid HTML.
              const activate = () => {
                if (mode === 'select' && (onSelect || onSelectFull)) {
                  const payload = {
                    url: vector.url,
                    width: vector.width,
                    height: vector.height,
                    thumbnail: vector.thumbUrl,
                    type: 'image' as const,
                    source: vector.source,
                    attribution: vector.attribution,
                    name: vector.description || undefined,
                  };
                  onSelectFull?.(payload);
                  onSelect?.(payload);
                } else {
                  openVector(vector);
                }
              };
              return (
              <div
                key={vector.id}
                role="button"
                tabIndex={0}
                onClick={activate}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    activate();
                  }
                }}
                className="group block w-full mb-[12px] break-inside-avoid text-left rounded-[8px] overflow-hidden border border-newBorder bg-newBgColorInner cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2B5CD3]"
              >
                <div
                  className="relative overflow-hidden"
                  style={{ aspectRatio: vector.width && vector.height ? `${vector.width} / ${vector.height}` : '4 / 3' }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- external stock thumbnail */}
                  <img
                    src={vector.thumbUrl}
                    alt={vector.description || ''}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute bottom-0 left-0 right-0 h-[70px] bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="absolute bottom-[8px] right-[8px] opacity-0 group-hover:opacity-100 transition-opacity">
                      <svg className="w-[18px] h-[18px] text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                      </svg>
                    </div>
                  </div>
                </div>
                <div className="p-[8px]">
                  <div className="text-[11px] text-newTextColor/60 truncate">
                    {t('by', 'by')}{' '}
                    <a
                      href={vector.authorUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-btnPrimaryAccent underline"
                    >
                      {vector.author}
                    </a>
                    <span className="text-newTextColor/60 ml-[4px]">· {stockSourceLabel(vector.source)}</span>
                  </div>
                </div>
              </div>
              );
            })}
          </div>

          {hasMore && (
            <div ref={sentinelRef}>
              {!isFirstFetch && isValidating && (
                <div className="columns-2 sm:columns-3 lg:columns-4 xl:columns-5 gap-[12px]">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="mb-[12px] break-inside-avoid rounded-[8px] overflow-hidden border border-newBorder bg-newBgColorInner">
                      <div
                        className="bg-newColColor/20 animate-pulse rounded-[8px]"
                        style={{ aspectRatio: i % 2 === 0 ? '3 / 4' : '4 / 3' }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
