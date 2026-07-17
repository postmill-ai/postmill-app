'use client';

import React, { FC, useCallback, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useDebounce } from 'use-debounce';
import type { DesignerElement } from '../designer.store';
import { PanelSkeletonGrid, PanelError } from './panel-states';
import { fitWithin } from './fit-within';
import { MediaSelectorModal } from '../../media-selector-modal';
import { getDefaultClipEndMs, getVideoDurationMs } from './video-clip-duration';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface PhotosPanelProps {
  store: ReturnType<typeof import('../designer.store').createDesignerStore>;
  onClose?: () => void;
}

interface StockPhotoItem {
  id: string;
  url: string;
  thumbUrl: string;
  description: string | null;
  author: string;
  authorUrl: string;
  width: number;
  height: number;
}

interface StockVideoItem {
  id: string;
  url: string;
  thumbUrl: string;
  description: string | null;
  author: string;
  authorUrl: string;
  width: number;
  height: number;
  duration?: number;
}

type TabType = 'photos' | 'videos';

export const PhotosPanel: FC<PhotosPanelProps> = ({ store, onClose }) => {
  const fetch = useFetch();
  const t = useT();
  const [tab, setTab] = useState<TabType>('photos');
  const [query, setQuery] = useState('');
  const [debouncedQuery] = useDebounce(query, 300);
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);

  const params = new URLSearchParams();
  if (debouncedQuery) params.set('query', debouncedQuery);
  params.set('page', String(page));

  const key = tab === 'photos' ? 'stock-photos' : 'stock-videos';
  const endpoint = tab === 'photos' ? '/media/stock/photos' : '/media/stock/videos';

  const { data, error, isLoading, mutate } = useSWR(
    `${key}-${debouncedQuery}-${page}`,
    async () => {
      const res = await fetch(`${endpoint}?${params}`);
      if (!res.ok) throw new Error('Failed to load');
      return res.json();
    },
    { keepPreviousData: true }
  );

  const addToCanvas = useCallback((item: StockPhotoItem | StockVideoItem) => {
    const state = store.getState();
    const out = state.doc.outputs[state.currentOutput];

    if (state.doc.mode === 'video') {
      const vo = out as any;
      const isVideo = tab === 'videos';
      const trackType = isVideo ? 'video' : 'image';
      let track = vo.tracks?.find((t: any) => t.type === trackType);
      if (!track) {
        state.addTrack(state.currentOutput, trackType);
        track = (store.getState().doc.outputs[state.currentOutput] as any).tracks.find((t: any) => t.type === trackType);
      }
      if (!track) return;
      const state2 = store.getState();
      const cVo = state2.doc.outputs[state2.currentOutput] as any;
      const startMs = state2.playheadMs;
      const outputDurationMs = cVo.durationMs ?? 60000;
      const sourceDurationMs = isVideo && (item as StockVideoItem).duration
        ? (item as StockVideoItem).duration * 1000
        : undefined;
      const endMs = isVideo
        ? getDefaultClipEndMs(startMs, sourceDurationMs, cVo.formatId, outputDurationMs)
        : Math.min(startMs + 3000, outputDurationMs);
      const clip = {
        id: '',
        startMs,
        endMs,
        // Full-resolution source for placement/export; the grid uses thumbUrl.
        src: item.url,
        width: out.width,
        height: out.height,
        naturalWidth: item.width,
        naturalHeight: item.height,
      };
      store.getState().addClip(state2.currentOutput, track.id, clip as any);
      onClose?.();
      return;
    }

    const { width: imgW, height: imgH } = fitWithin(
      item.width || 400,
      item.height || 400,
      out.width * 0.8,
      out.height * 0.8
    );
    const cx = (out.width - imgW) / 2;
    const cy = (out.height - imgH) / 2;

    const el: DesignerElement = {
      id: '',
      type: 'image',
      x: cx,
      y: cy,
      width: imgW,
      height: imgH,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      // Full-resolution source so a large export isn't a blurry ~200px thumb.
      src: item.url,
      naturalWidth: item.width || undefined,
      naturalHeight: item.height || undefined,
    };

    state.addElement(el);
    onClose?.();
  }, [store, onClose, tab]);

  const handleModalSelect = useCallback(async (item: {
    source: 'stock' | 'file';
    url: string;
    fileId?: string;
    width: number;
    height: number;
    type: 'image' | 'video' | 'audio';
  }) => {
    const state = store.getState();
    const out = state.doc.outputs[state.currentOutput];

    if (state.doc.mode === 'video') {
      const vo = out as any;
      const trackType = item.type === 'video' ? 'video' : 'image';
      let track = vo.tracks?.find((t: any) => t.type === trackType);
      if (!track) {
        state.addTrack(state.currentOutput, trackType);
        track = (store.getState().doc.outputs[state.currentOutput] as any).tracks.find((t: any) => t.type === trackType);
      }
      if (!track) return;
      const state2 = store.getState();
      const cVo = state2.doc.outputs[state2.currentOutput] as any;
      const startMs = state2.playheadMs;
      const outputDurationMs = cVo.durationMs ?? 60000;
      const sourceDurationMs = item.type === 'video'
        ? await getVideoDurationMs(item.url)
        : undefined;
      const endMs = item.type === 'video'
        ? getDefaultClipEndMs(startMs, sourceDurationMs, cVo.formatId, outputDurationMs)
        : Math.min(startMs + 3000, outputDurationMs);
      const clip = {
        id: '',
        startMs,
        endMs,
        src: item.url,
        fileId: item.fileId,
        width: out.width,
        height: out.height,
        naturalWidth: item.width || out.width,
        naturalHeight: item.height || out.height,
      };
      store.getState().addClip(state2.currentOutput, track.id, clip as any);
      setModalOpen(false);
      onClose?.();
      return;
    }

    const { width: imgW, height: imgH } = fitWithin(
      item.width || 400,
      item.height || 400,
      out.width * 0.8,
      out.height * 0.8
    );
    const cx = (out.width - imgW) / 2;
    const cy = (out.height - imgH) / 2;

    const el: DesignerElement = {
      id: '',
      type: 'image',
      x: cx,
      y: cy,
      width: imgW,
      height: imgH,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      src: item.url,
      fileId: item.fileId,
      naturalWidth: item.width || undefined,
      naturalHeight: item.height || undefined,
    };

    state.addElement(el);
    setModalOpen(false);
    onClose?.();
  }, [store, onClose]);

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="w-full px-3 py-2 rounded-lg text-[12px] font-medium bg-designerAccent text-white hover:bg-designerAccent/80"
      >
        {t('browse_media_library', 'Browse media library…')}
      </button>

      <MediaSelectorModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSelect={handleModalSelect}
      />

      <div className="flex gap-1 bg-studioBorder/10 rounded-lg p-1">
        <button
          onClick={() => { setTab('photos'); setPage(1); }}
          className={`flex-1 py-1.5 rounded-md text-[12px] font-medium transition-all ${
            tab === 'photos' ? 'bg-designerAccent text-white' : 'text-textColor/60 hover:text-textColor'
          }`}
        >
          {t('photos', 'Photos')}
        </button>
        <button
          onClick={() => { setTab('videos'); setPage(1); }}
          className={`flex-1 py-1.5 rounded-md text-[12px] font-medium transition-all ${
            tab === 'videos' ? 'bg-designerAccent text-white' : 'text-textColor/60 hover:text-textColor'
          }`}
        >
          {t('videos', 'Videos')}
        </button>
      </div>

      <input
        type="text"
        value={query}
        onChange={e => { setQuery(e.target.value); setPage(1); }}
        placeholder={t('photos_panel_search_tab_placeholder', 'Search {{tab}}...', { tab })}
        className="w-full h-[36px] px-3 rounded-lg bg-newBgColorInner border border-studioBorder text-[13px] outline-none focus:border-designerAccent text-textColor"
      />

      {isLoading && !data ? (
        <PanelSkeletonGrid count={6} />
      ) : error && !data ? (
        <PanelError message={t('photos_panel_couldnt_load_tab', "Couldn't load {{tab}}", { tab })} onRetry={() => mutate()} />
      ) : data && !data.configured ? (
        <div className="text-[12px] text-newTextColor/60 text-center py-4">
          {t('photos_panel_stock_browsing_not_configured', "Stock browsing isn't configured")}
        </div>
      ) : !(data?.results || []).length ? (
        <div className="text-[12px] text-newTextColor/60 text-center py-4">
          {debouncedQuery
            ? t('photos_panel_no_tab_found_for_query', 'No {{tab}} found for "{{query}}"', { tab, query: debouncedQuery })
            : t('photos_panel_no_tab_found', 'No {{tab}} found', { tab })}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {(data?.results || []).map((item: StockPhotoItem | StockVideoItem) => (
            <button
              key={item.id}
              onClick={() => addToCanvas(item)}
              draggable
              onDragStart={(e) => {
                const state = store.getState();
                const out = state.doc.outputs[state.currentOutput];
                const fit = fitWithin(
                  item.width || 400,
                  item.height || 400,
                  out.width * 0.8,
                  out.height * 0.8
                );
                e.dataTransfer.setData(
                  'application/x-designer-element',
                  JSON.stringify({
                    type: 'image',
                    src: item.url,
                    naturalWidth: item.width,
                    naturalHeight: item.height,
                    width: fit.width,
                    height: fit.height,
                  })
                );
              }}
              className="group rounded-lg overflow-hidden border border-studioBorder bg-newBgColorInner hover:border-designerAccent transition-all"
            >
              <div className="aspect-[4/3] relative overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element -- external stock thumbnail */}
                <img
                  src={item.thumbUrl}
                  alt={item.description || ''}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                  loading="lazy"
                />
              </div>
              <div className="p-1.5">
                <div className="text-[10px] text-newTextColor/60 truncate">
                  {t('photos_panel_by', 'by')}{' '}
                  <a href={item.authorUrl} target="_blank" rel="noopener noreferrer" className="text-btnPrimaryAccent hover:underline">
                    {item.author}
                  </a>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {(data?.totalPages || 0) > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
            className="px-3 py-1 rounded border border-studioBorder text-[12px] text-textColor hover:bg-boxHover disabled:opacity-30"
          >
            {t('photos_panel_prev', 'Prev')}
          </button>
          <span className="text-[11px] text-newTextColor/60">{page} / {data?.totalPages || 1}</span>
          <button
            disabled={page >= (data?.totalPages || 1)}
            onClick={() => setPage(p => p + 1)}
            className="px-3 py-1 rounded border border-studioBorder text-[12px] text-textColor hover:bg-boxHover disabled:opacity-30"
          >
            {t('next', 'Next')}
          </button>
        </div>
      )}
    </div>
  );
};
