'use client';

import React, { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDebounce } from 'use-debounce';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { StockPreviewModal } from './stock-preview-modal';
import { StockStickerItem, stockSourceLabel } from './stock.types';
import { useStockSearch } from './use-stock-search';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const SUGGESTED_SEARCHES = ['Happy', 'Cat', 'Reaction', 'Celebration', 'Meme'];

interface StockStickersProps {
  mode?: 'browse' | 'select';
  onSelect?: (item: { url: string; width: number; height: number; thumbnail?: string; type: 'image' | 'video' }) => void;
  onSelectFull?: (item: {
    url: string;
    width: number;
    height: number;
    thumbnail?: string;
    type: 'image' | 'video';
    source?: string;
    attribution?: Record<string, unknown>;
    name?: string;
  }) => void;
}

export const StockStickers: FC<StockStickersProps> = ({ mode = 'browse', onSelect, onSelectFull }) => {
  const t = useT();
  const modal = useModals();
  const [query, setQuery] = useState('');
  const [debouncedQuery] = useDebounce(query, 300);

  const filters = useMemo(() => ({}), []);

  const {
    items,
    lastPage,
    error,
    isLoading,
    isValidating,
    size,
    setSize,
    mutate,
  } = useStockSearch<StockStickerItem>('/media/stock/stickers', debouncedQuery, filters);

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

  const openSticker = useCallback(
    (sticker: StockStickerItem) =>
      modal.openModal({
        title: '',
        closeOnClickOutside: true,
        closeOnEscape: true,
        withCloseButton: true,
        classNames: { modal: 'w-[100%] max-w-[1100px] text-textColor' },
        children: <StockPreviewModal item={sticker} type="sticker" />,
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
            placeholder={t('search_stickers_placeholder', 'Search stickers...')}
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
              : t('could_not_reach_sticker_library', "We couldn't reach the sticker library. Give it another go in a moment.")}
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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-[12px]">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="rounded-[8px] overflow-hidden border border-newBorder bg-newBgColorInner">
              <div className="aspect-square bg-newColColor/20 animate-pulse rounded-[8px]" />
              <div className="p-[8px]">
                <div className="h-[11px] bg-newColColor/20 animate-pulse rounded-[4px] w-[60%]" />
              </div>
            </div>
          ))}
        </div>
      ) : showEmpty ? (
        <div className="flex flex-col items-center justify-center h-[320px] gap-[10px] text-center px-[20px]">
          <svg className="w-[44px] h-[44px] text-newTextColor/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.182 15.182a4.5 4.5 0 01-6.364 0M21 12a9 9 0 11-18 0 9 9 0 0118 0zM7.5 9.75c0 .414.168.75.375.75S8.25 10.164 8.25 9.75 8.082 9 7.875 9s-.375.336-.375.75zm7.5 0c0 .414.168.75.375.75s.375-.336.375-.75-.168-.75-.375-.75-.375.336-.375.75z" />
          </svg>
          <div className="text-[15px] font-[600] text-textColor">
            {debouncedQuery
              ? t('no_stickers_for_query', 'No stickers for "{{query}}"', { query: debouncedQuery })
              : t('find_perfect_sticker', 'Find the perfect sticker')}
          </div>
          <div className="text-[13px] text-newTextColor/65 max-w-[340px]">
            {debouncedQuery
              ? t('try_different_keyword', 'Try a different keyword or one of these popular searches.')
              : t('search_free_stickers_giphy', 'Search thousands of free stickers from GIPHY to get started.')}
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
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-[12px]">
            {items.map((sticker) => {
              // role=button div (not <button>) so the author-credit <a> is valid HTML.
              const activate = () => {
                if (mode === 'select' && (onSelect || onSelectFull)) {
                  const isVideo = !!sticker.mp4Url;
                  const type: 'image' | 'video' = isVideo ? 'video' : 'image';
                  const payload = {
                    url: isVideo ? sticker.mp4Url! : sticker.url,
                    width: sticker.width,
                    height: sticker.height,
                    thumbnail: sticker.thumbUrl,
                    type,
                    source: sticker.source,
                    attribution: sticker.attribution,
                    name: sticker.description || undefined,
                  };
                  onSelectFull?.(payload);
                  onSelect?.(payload);
                } else {
                  openSticker(sticker);
                }
              };
              return (
              <div
                key={sticker.id}
                role="button"
                tabIndex={0}
                onClick={activate}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    activate();
                  }
                }}
                className="group text-left rounded-[8px] overflow-hidden border border-newBorder bg-newBgColorInner cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2B5CD3]"
              >
                <div className="aspect-square relative overflow-hidden bg-transparent">
                  {/* eslint-disable-next-line @next/next/no-img-element -- external stock thumbnail */}
                  <img
                    src={sticker.thumbUrl}
                    alt={sticker.description || ''}
                    className="w-full h-full object-contain group-hover:scale-105 transition-transform"
                    loading="lazy"
                  />
                  {sticker.mp4Url && (
                    <div className="absolute bottom-[8px] right-[8px] px-[6px] py-[2px] rounded-[4px] bg-black/70 text-[11px] text-white pointer-events-none z-10">
                      GIF
                    </div>
                  )}
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
                      href={sticker.authorUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-btnPrimaryAccent underline"
                    >
                      {sticker.author}
                    </a>
                    <span className="text-newTextColor/60 ml-[4px]">· {stockSourceLabel(sticker.source)}</span>
                  </div>
                </div>
              </div>
              );
            })}
          </div>

          {hasMore && (
            <div ref={sentinelRef}>
              {!isFirstFetch && isValidating && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-[12px] mt-[12px]">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="rounded-[8px] overflow-hidden border border-newBorder bg-newBgColorInner">
                      <div className="aspect-square bg-newColColor/20 animate-pulse rounded-[8px]" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* GIPHY API ToS requires the "Powered By GIPHY" attribution mark wherever results are shown. */}
          <a
            href="https://giphy.com"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-[4px] self-center text-[11px] text-newTextColor/60 hover:text-newTextColor/70 transition-colors"
          >
            {t('powered_by_giphy_attribution', 'Powered By GIPHY')}
          </a>
        </>
      )}
    </div>
  );
};
