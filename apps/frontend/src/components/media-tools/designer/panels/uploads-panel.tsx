'use client';

import React, { FC, useCallback, useEffect, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useToaster } from '@gitroom/react/toaster/toaster';
import type { DesignerElement, StickerFrame } from '../designer.store';
import { PanelSkeletonGrid, PanelError } from './panel-states';
import { fitWithin } from './fit-within';
import { MediaSelectorModal } from '../../media-selector-modal';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

async function decodeStickerFrames(src: string): Promise<StickerFrame[]> {
  if (typeof window === 'undefined' || !('ImageDecoder' in window)) {
    return [{ url: src, durationMs: Infinity }];
  }
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error('Failed to fetch sticker');
    const buffer = await res.arrayBuffer();
    const mime = /\.webp(\?.*)?$/i.test(src) ? 'image/webp' : 'image/gif';
    const decoder = new (window as any).ImageDecoder({ data: buffer, type: mime });
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack;
    if (!track || track.frameCount <= 1) {
      decoder.close?.();
      return [{ url: src, durationMs: Infinity }];
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No canvas context');

    const frames: StickerFrame[] = [];
    for (let i = 0; i < track.frameCount; i++) {
      const result = await decoder.decode({ frameIndex: i });
      const image = result.image;
      if (i === 0) {
        canvas.width = image.codedWidth || 1;
        canvas.height = image.codedHeight || 1;
      }
      ctx.drawImage(image, 0, 0);
      const durationMs = Math.max(1, Math.round((image.duration || 0) / 1000));
      frames.push({ url: canvas.toDataURL('image/png'), durationMs });
      image.close?.();
    }
    decoder.close?.();
    return frames;
  } catch {
    return [{ url: src, durationMs: Infinity }];
  }
}
import { getDefaultClipEndMs, getVideoDurationMs } from './video-clip-duration';

interface UploadsPanelProps {
  store: ReturnType<typeof import('../designer.store').createDesignerStore>;
  onClose?: () => void;
}

interface FileItem {
  id: string;
  path: string;
  name: string;
  width?: number;
  height?: number;
}

export const UploadsPanel: FC<UploadsPanelProps> = ({ store, onClose }) => {
  const fetch = useFetch();
  const user = useUser();
  const toaster = useToaster();
  const t = useT();
  const [modalOpen, setModalOpen] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);

  const { data, error, isLoading, mutate } = useSWR(
    `uploads-${user.orgId}-page-1`,
    async () => {
      const res = await fetch('/files?page=1&limit=100');
      if (!res.ok) throw new Error('Failed to load files');
      return res.json() as Promise<{ pages: number; results: FileItem[] }>;
    },
    { keepPreviousData: true }
  );

  const { data: stockAudio } = useSWR(
    `stock-audio-${user.orgId}`,
    async () => {
      const res = await fetch('/media/stock/audio?page=1');
      if (!res.ok) throw new Error('Failed to load stock audio');
      return res.json() as Promise<{ results: { id: string; url: string; name: string; duration: number; author: string }[]; configured: boolean }>;
    },
    { revalidateOnFocus: false }
  );

  // Surface the load failure from an effect, not inline in render.
  useEffect(() => {
    if (error && !data) toaster.show(t('uploads_panel_couldnt_load_uploads', "Couldn't load uploads"), 'warning');
  }, [error, data, toaster, t]);

  const imageFiles = data?.results?.filter((f) => {
    const ext = f.name.split('.').pop()?.toLowerCase() || '';
    return !['mp3','wav','aac','ogg','m4a','flac','gif','webp'].includes(ext);
  }) || [];
  const audioFiles = data?.results?.filter((f) => /\.(mp3|wav|aac|ogg|m4a|flac)$/i.test(f.path)) || [];
  const stickerFiles = data?.results?.filter((f) => /\.(gif|webp)$/i.test(f.path)) || [];

  const addToCanvas = useCallback(async (file: FileItem) => {
    const state = store.getState();
    const out = state.doc.outputs[state.currentOutput];

    if (state.doc.mode === 'video') {
      const vo = out as any;
      const isVideo = /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(file.path);
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
      const sourceDurationMs = isVideo
        ? await getVideoDurationMs(file.path)
        : undefined;
      const endMs = isVideo
        ? getDefaultClipEndMs(startMs, sourceDurationMs, cVo.formatId, outputDurationMs)
        : Math.min(startMs + 3000, outputDurationMs);
      const clip = {
        id: '',
        startMs,
        endMs,
        src: file.path,
        fileId: file.id,
        width: out.width,
        height: out.height,
      };
      store.getState().addClip(state2.currentOutput, track.id, clip as any);
      onClose?.();
      return;
    }

    const { width: w, height: h } = fitWithin(
      file.width || 400,
      file.height || 400,
      out.width * 0.8,
      out.height * 0.8
    );
    const cx = (out.width - w) / 2;
    const cy = (out.height - h) / 2;

    const el: DesignerElement = {
      id: '',
      type: 'image',
      x: cx,
      y: cy,
      width: w,
      height: h,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      src: file.path,
      fileId: file.id,
    };

    state.addElement(el);
    onClose?.();
  }, [store, onClose]);

  const addStickerClip = useCallback(async (file: FileItem) => {
    const state = store.getState();
    const out = state.doc.outputs[state.currentOutput];
    if (state.doc.mode !== 'video') return;
    const vo = out as any;
    let stickerTrack = vo.tracks?.find((t: any) => t.type === 'sticker');
    if (!stickerTrack) {
      state.addTrack(state.currentOutput, 'sticker');
      stickerTrack = (store.getState().doc.outputs[state.currentOutput] as any).tracks.find((t: any) => t.type === 'sticker');
    }
    if (!stickerTrack) return;
    const remainingMs = (vo?.durationMs || 10000) - state.playheadMs;
    const frames = await decodeStickerFrames(file.path);
    const clip = {
      id: '',
      startMs: state.playheadMs,
      endMs: state.playheadMs + Math.max(1000, remainingMs),
      src: file.path,
      fileId: file.id,
      width: 200,
      height: 200,
      x: ((out as any).width - 200) / 2,
      y: ((out as any).height - 200) / 2,
      volume: 0,
      frames,
    };
    store.getState().addClip(state.currentOutput, stickerTrack.id, clip as any);
    onClose?.();
  }, [store, onClose]);

  const addStockAudioClip = useCallback((item: { id: string; url: string; name: string; duration: number }) => {
    const state = store.getState();
    const out = state.doc.outputs[state.currentOutput];
    if (state.doc.mode !== 'video') return;
    const vo = out as any;
    let audioTrack = vo.tracks?.find((t: any) => t.type === 'audio');
    if (!audioTrack) {
      state.addTrack(state.currentOutput, 'audio');
      audioTrack = (store.getState().doc.outputs[state.currentOutput] as any).tracks.find((t: any) => t.type === 'audio');
    }
    if (!audioTrack) return;
    const remainingMs = (vo?.durationMs || 10000) - state.playheadMs;
    const durationMs = Math.min(item.duration * 1000, Math.max(1000, remainingMs));
    const clip = {
      id: '',
      startMs: state.playheadMs,
      endMs: state.playheadMs + durationMs,
      src: item.url,
      fileId: item.id,
      volume: 1,
      fadeInMs: 0,
      fadeOutMs: 0,
    };
    store.getState().addClip(state.currentOutput, audioTrack.id, clip as any);
    onClose?.();
  }, [store, onClose]);

  const addAudioClip = useCallback((file: FileItem) => {
    const state = store.getState();
    const out = state.doc.outputs[state.currentOutput];
    if (state.doc.mode !== 'video') return;
    const vo = out as any;
    let audioTrack = vo.tracks?.find((t: any) => t.type === 'audio');
    if (!audioTrack) {
      state.addTrack(state.currentOutput, 'audio');
      audioTrack = (store.getState().doc.outputs[state.currentOutput] as any).tracks.find((t: any) => t.type === 'audio');
    }
    if (!audioTrack) return;
    const remainingMs = (vo?.durationMs || 10000) - state.playheadMs;
    const clip = {
      id: '',
      startMs: state.playheadMs,
      endMs: state.playheadMs + Math.max(1000, remainingMs),
      src: file.path,
      fileId: file.id,
      volume: 1,
      fadeInMs: 0,
      fadeOutMs: 0,
    };
    store.getState().addClip(state.currentOutput, audioTrack.id, clip as any);
    onClose?.();
  }, [store, onClose]);

  const handleAudioUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingFile(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/files/upload-simple', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Upload failed');
      const uploaded = await res.json() as FileItem;
      mutate();
      addAudioClip(uploaded);
    } catch {
      toaster.show(t('uploads_panel_audio_upload_failed', 'Audio upload failed'), 'warning');
    } finally {
      setUploadingFile(false);
    }
  }, [addAudioClip, mutate, toaster, t, fetch]);

  const handleStickerUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!ext || !['gif','webp'].includes(ext)) {
      toaster.show(t('uploads_panel_stickers_must_be_gif_or_webp', 'Stickers must be GIF or WebP'), 'warning');
      return;
    }
    setUploadingFile(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/files/upload-simple', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Upload failed');
      const uploaded = await res.json() as FileItem;
      mutate();
      addStickerClip(uploaded);
    } catch {
      toaster.show(t('uploads_panel_sticker_upload_failed', 'Sticker upload failed'), 'warning');
    } finally {
      setUploadingFile(false);
    }
  }, [addStickerClip, mutate, toaster, t, fetch]);

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
      };
      store.getState().addClip(state2.currentOutput, track.id, clip as any);
      setModalOpen(false);
      onClose?.();
      return;
    }

    const { width: w, height: h } = fitWithin(
      item.width || 400,
      item.height || 400,
      out.width * 0.8,
      out.height * 0.8
    );
    const cx = (out.width - w) / 2;
    const cy = (out.height - h) / 2;

    const el: DesignerElement = {
      id: '',
      type: 'image',
      x: cx,
      y: cy,
      width: w,
      height: h,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      src: item.url,
      fileId: item.fileId,
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

      {isLoading && !data ? (
        <PanelSkeletonGrid count={6} />
      ) : error && !data ? (
        <PanelError message={t('uploads_panel_couldnt_load_uploads', "Couldn't load uploads")} onRetry={() => mutate()} />
      ) : !data?.results?.length ? (
        <div className="text-[12px] text-newTextColor/60 text-center py-4">
          {t('uploads_panel_no_uploaded_files_found', 'No uploaded files found')}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {imageFiles.map((file) => (
            <button
              key={file.id}
              onClick={() => addToCanvas(file)}
              draggable
              onDragStart={(e) =>
                e.dataTransfer.setData(
                  'application/x-designer-element',
                  JSON.stringify({
                    type: 'image',
                    src: file.path,
                    fileId: file.id,
                    width: file.width || 400,
                    height: file.height || 400,
                  })
                )
              }
              className="group rounded-lg overflow-hidden border border-studioBorder bg-newBgColorInner hover:border-designerAccent transition-all"
            >
              <div className="aspect-[4/3] relative overflow-hidden bg-studioBorder/10">
                {/* eslint-disable-next-line @next/next/no-img-element -- external media file */}
                <img
                  src={file.path}
                  alt={file.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                  loading="lazy"
                />
              </div>
              <div className="p-1.5">
                <div className="text-[10px] text-newTextColor/60 truncate">{file.name}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {audioFiles.length > 0 && (
        <div className="flex flex-col gap-2 pt-2 border-t border-studioBorder">
          <div className="text-[11px] text-newTextColor/65 uppercase tracking-wider">{t('audio', 'Audio')}</div>
          {audioFiles.map((file) => (
            <button
              key={file.id}
              onClick={() => addAudioClip(file)}
              className="flex items-center gap-2 px-2 py-1.5 rounded border border-studioBorder bg-newBgColorInner hover:border-designerAccent transition-all text-left"
            >
              <span className="text-[12px]">🔊</span>
              <span className="text-[11px] text-textColor truncate flex-1">{file.name}</span>
              <span className="text-[10px] text-btnPrimaryAccent">{t('add', 'Add')}</span>
            </button>
          ))}
        </div>
      )}

      {stickerFiles.length > 0 && (
        <div className="flex flex-col gap-2 pt-2 border-t border-studioBorder">
          <div className="text-[11px] text-newTextColor/65 uppercase tracking-wider">{t('uploads_panel_stickers', 'Stickers')}</div>
          <div className="grid grid-cols-3 gap-2">
            {stickerFiles.map((file) => (
              <button
                key={file.id}
                onClick={() => addStickerClip(file)}
                className="group aspect-square rounded-lg overflow-hidden border border-studioBorder bg-newBgColorInner hover:border-designerAccent transition-all"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- external media file */}
                <img
                  src={file.path}
                  alt={file.name}
                  className="w-full h-full object-contain p-1"
                  loading="lazy"
                />
              </button>
            ))}
          </div>
        </div>
      )}

      {stockAudio && (
        <div className="flex flex-col gap-2 pt-2 border-t border-studioBorder">
          <div className="text-[11px] text-newTextColor/65 uppercase tracking-wider">{t('uploads_panel_stock_audio', 'Stock audio')}</div>
          {!stockAudio.configured ? (
            <div className="text-[11px] text-newTextColor/60 space-y-1">
              <p>{t('uploads_panel_stock_audio_not_configured', "Stock audio isn't configured.")}</p>
              <p>
                {t('uploads_panel_set_env_prefix', 'Set')}{' '}
                <code className="text-textColor/60">JAMENDO_CLIENT_ID</code>{' '}
                {t('uploads_panel_set_env_suffix', 'to enable stock audio.')}
              </p>
            </div>
          ) : stockAudio.results?.length === 0 ? (
            <div className="text-[11px] text-newTextColor/60">
              {t('uploads_panel_no_stock_audio_found', 'No stock audio found')}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {stockAudio.results.map((item) => (
                <button
                  key={item.id}
                  onClick={() => addStockAudioClip(item)}
                  className="flex items-center gap-2 px-2 py-1.5 rounded border border-studioBorder bg-newBgColorInner hover:border-designerAccent transition-all text-left"
                >
                  <span className="text-[12px]">🎵</span>
                  <span className="text-[11px] text-textColor truncate flex-1">{item.name}</span>
                  <span className="text-[10px] text-btnPrimaryAccent">{t('add', 'Add')}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2 pt-2 border-t border-studioBorder">
        <div className="text-[11px] text-newTextColor/65 uppercase tracking-wider">{t('uploads_panel_upload_audio', 'Upload audio')}</div>
        <input
          type="file"
          accept="audio/*"
          onChange={handleAudioUpload}
          disabled={uploadingFile}
          className="text-[11px] text-textColor file:mr-2 file:px-2 file:py-1 file:rounded file:border-0 file:bg-designerAccent file:text-white"
        />
      </div>

      <div className="flex flex-col gap-2 pt-2 border-t border-studioBorder">
        <div className="text-[11px] text-newTextColor/65 uppercase tracking-wider">{t('uploads_panel_upload_sticker', 'Upload sticker')}</div>
        <input
          type="file"
          accept="image/gif,image/webp"
          onChange={handleStickerUpload}
          disabled={uploadingFile}
          className="text-[11px] text-textColor file:mr-2 file:px-2 file:py-1 file:rounded file:border-0 file:bg-designerAccent file:text-white"
        />
      </div>
    </div>
  );
};
