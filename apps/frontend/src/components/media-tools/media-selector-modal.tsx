'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { StockPhotos } from './stock-photos';
import { StockVideos } from './stock-videos';
import { StockVectors } from './stock-vectors';
import { StockStickers } from './stock-stickers';
import { StockIcons } from './stock-icons';
import { FileManager } from '@gitroom/frontend/components/files/file-manager';
import type { FileItem } from '@gitroom/frontend/components/files/file-manager';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export type MediaKind = 'image' | 'video' | 'audio';

export interface MediaSelectorItem {
  source: 'stock' | 'file';
  url: string;
  fileId?: string;
  width: number;
  height: number;
  type: MediaKind;
  name?: string;
  thumbnail?: string;
  /** Stock-only metadata used when importing into /files. */
  stockSource?: string;
  attribution?: Record<string, unknown>;
  downloadLocation?: string | null;
}

const ALL_TABS = [
  'Stock Photos',
  'Stock Videos',
  'Stock Vectors',
  'Stock Stickers',
  'Stock Icons',
  'My Files',
] as const;

const TAB_TO_KIND: Record<(typeof ALL_TABS)[number], MediaKind | null> = {
  'Stock Photos': 'image',
  'Stock Videos': 'video',
  'Stock Vectors': 'image',
  'Stock Stickers': 'image',
  'Stock Icons': 'image',
  'My Files': null,
};

// Tabs are compared/keyed by their canonical English value (ALL_TABS) — only the
// displayed label is translated, via this lookup.
const TAB_LABEL_KEYS: Record<(typeof ALL_TABS)[number], string> = {
  'Stock Photos': 'stock_photos_tab',
  'Stock Videos': 'stock_videos_tab',
  'Stock Vectors': 'stock_vectors_tab',
  'Stock Stickers': 'stock_stickers_tab',
  'Stock Icons': 'stock_icons_tab',
  'My Files': 'my_files_tab',
};

const useFocusTrap = (
  containerRef: React.RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void
) => {
  const returnRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnRef.current = document.activeElement as HTMLElement | null;
    const el = containerRef.current;
    if (!el) return;
    const focusable = el.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0] as HTMLElement | undefined;
    const last = focusable[focusable.length - 1] as HTMLElement | undefined;

    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };

    el.addEventListener('keydown', keyHandler);
    const t = setTimeout(() => first?.focus(), 0);
    return () => {
      clearTimeout(t);
      el.removeEventListener('keydown', keyHandler);
      returnRef.current?.focus?.();
    };
  }, [open, onClose, containerRef]);
};

interface MediaSelectorModalProps {
  open: boolean;
  onClose: () => void;
  /** Legacy single-select callback. Closes the modal. Default behavior. */
  onSelect?: (item: MediaSelectorItem) => void;
  /** Multi-select mode: keeps the modal open and accumulates selections. */
  multiple?: boolean;
  /** Multi-select confirmation callback. Receives the accumulated batch. */
  onConfirm?: (items: MediaSelectorItem[]) => void;
  /** Restrict visible tabs to post-appropriate kinds. Default = all tabs. */
  kinds?: MediaKind[];
  /**
   * Hide specific tabs by name (e.g. `'Stock Icons'`, `'Stock Stickers'`).
   * `kinds` filters by media kind, which cannot distinguish image sub-sources
   * (Photos/Vectors/Stickers/Icons all map to `'image'`); use this to drop an
   * individual stock tab — e.g. the composer hides Icons (SVG → /files/import 415).
   */
  excludeTabs?: readonly string[];
}

export const MediaSelectorModal: React.FC<MediaSelectorModalProps> = ({
  open,
  onClose,
  onSelect,
  multiple,
  onConfirm,
  kinds,
  excludeTabs,
}) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const tabs = useMemo(() => {
    const kindFiltered = !kinds?.length
      ? ALL_TABS
      : ALL_TABS.filter((tab) => {
          const kind = TAB_TO_KIND[tab];
          return kind === null || kinds.includes(kind);
        });
    if (!excludeTabs?.length) return kindFiltered;
    return kindFiltered.filter((tab) => !excludeTabs.includes(tab));
  }, [kinds, excludeTabs]);
  const [activeTab, setActiveTab] = useState<string>(tabs[0]);
  const [selection, setSelection] = useState<MediaSelectorItem[]>([]);
  const [myFilesFolderId, setMyFilesFolderId] = useState<string | null>(null);
  const [myFilesRefreshKey, setMyFilesRefreshKey] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(containerRef, open, onClose);

  // Reset selection when modal opens.
  useEffect(() => {
    if (open) setSelection([]);
  }, [open]);

  // Keep active tab valid when kinds filter changes the tab list.
  useEffect(() => {
    if (!tabs.includes(activeTab as any)) {
      setActiveTab(tabs[0]);
    }
  }, [tabs, activeTab]);

  if (!open) return null;

  const finalize = (item: MediaSelectorItem) => {
    if (multiple) {
      setSelection((prev) => {
        const exists = prev.some(
          (p) => p.source === item.source && p.url === item.url
        );
        if (exists) return prev;
        return [...prev, item];
      });
      return;
    }
    onSelect?.(item);
    onClose();
  };

  const handleStockSelect = (item: {
    url: string;
    width: number;
    height: number;
    thumbnail?: string;
    type: MediaKind;
    name?: string;
    source?: string;
    attribution?: Record<string, unknown>;
    downloadLocation?: string | null;
  }) => {
    finalize({
      source: 'stock',
      url: item.url,
      width: item.width,
      height: item.height,
      thumbnail: item.thumbnail,
      type: item.type,
      name: item.name,
      stockSource: item.source,
      attribution: item.attribution,
      downloadLocation: item.downloadLocation,
    });
  };

  const handleFileSelect = (items: FileItem[]) => {
    const item = items[0];
    if (!item) return;
    finalize({
      source: 'file',
      url: item.path,
      fileId: item.id,
      width: 0,
      height: 0,
      type: item.type?.startsWith('audio')
        ? 'audio'
        : item.type?.startsWith('video')
        ? 'video'
        : /\.(mp3|wav|ogg|m4a)$/i.test(item.name || '')
        ? 'audio'
        : 'image',
      name: item.name,
      thumbnail: item.thumbnail || undefined,
    });
  };

  const removeSelection = (index: number) => {
    setSelection((prev) => prev.filter((_, i) => i !== index));
  };

  const confirmSelection = () => {
    if (selection.length === 0) return;
    onConfirm?.(selection);
    onClose();
  };

  const uploadFiles = async (files: FileList | null) => {
    const fileList = files ? Array.from(files) : [];
    if (fileList.length === 0) return;
    setIsUploading(true);
    try {
      for (const file of fileList) {
        const formData = new FormData();
        formData.append('file', file);
        if (myFilesFolderId) {
          formData.append('folderId', myFilesFolderId);
        }
        const res = await fetch('/files/upload-simple', {
          method: 'POST',
          body: formData,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => t('upload_failed', 'Upload failed'));
          throw new Error(text);
        }
      }
      toaster.show(
        t('uploaded_n_files', 'Uploaded {{count}} file', {
          count: fileList.length,
        }),
        'success'
      );
      setMyFilesRefreshKey((k) => k + 1);
    } catch (err) {
      toaster.show((err as Error).message || t('upload_failed', 'Upload failed'), 'warning');
    } finally {
      setIsUploading(false);
      setIsDragOver(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    uploadFiles(e.target.files);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    uploadFiles(e.dataTransfer.files);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('select_media_aria', 'Select media')}
        className={clsx(
          'bg-newBgColor border border-studioBorder rounded-xl flex flex-col',
          multiple ? 'w-[760px] max-h-[680px]' : 'w-[720px] max-h-[600px]'
        )}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-studioBorder">
          <div className="flex gap-1" role="tablist" aria-label={t('media_source_aria', 'Media source')}>
            {tabs.map((tab) => (
              <button
                key={tab}
                role="tab"
                aria-selected={activeTab === tab}
                aria-label={t(TAB_LABEL_KEYS[tab], tab)}
                className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                  activeTab === tab
                    ? 'bg-[#2B5CD3] text-white'
                    : 'text-newTextColor/60 hover:text-textColor'
                }`}
                onClick={() => setActiveTab(tab)}
              >
                {t(TAB_LABEL_KEYS[tab], tab)}
              </button>
            ))}
          </div>
          <button
            className="text-newTextColor/60 hover:text-textColor text-lg"
            onClick={onClose}
            aria-label={t('close_media_selector', 'Close media selector')}
            title={t('close_media_selector', 'Close media selector')}
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'Stock Photos' && (
            <StockPhotos mode="select" onSelectFull={handleStockSelect} />
          )}
          {activeTab === 'Stock Videos' && (
            <StockVideos mode="select" onSelectFull={handleStockSelect} />
          )}
          {activeTab === 'Stock Vectors' && (
            <StockVectors mode="select" onSelectFull={handleStockSelect} />
          )}
          {activeTab === 'Stock Stickers' && (
            <StockStickers mode="select" onSelectFull={handleStockSelect} />
          )}
          {activeTab === 'Stock Icons' && (
            <StockIcons mode="select" onSelectFull={handleStockSelect} />
          )}
          {activeTab === 'My Files' && (
            <div className="flex flex-col gap-3">
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => !isUploading && fileInputRef.current?.click()}
                className={`relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center cursor-pointer transition-colors ${
                  isDragOver
                    ? 'border-designerAccent bg-designerAccent/10'
                    : 'border-newColColor bg-newBgColorInner hover:border-designerAccent/60'
                } ${isUploading ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleFileInputChange}
                  disabled={isUploading}
                />
                {isUploading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm text-textColor">{t('uploading_ellipsis', 'Uploading…')}</span>
                  </>
                ) : (
                  <>
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      className="text-newTextColor/60"
                    >
                      <path
                        d="M12 16V4M12 4L7 9M12 4L17 9"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M20 16V18C20 19.1046 19.1046 20 18 20H6C4.89543 20 4 19.1046 4 18V16"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span className="text-sm text-textColor">
                      {t('drop_files_click_upload', 'Drop files here or click to upload')}
                    </span>
                    <span className="text-xs text-newTextColor/65">
                      {myFilesFolderId
                        ? t('uploading_to_selected_folder', 'Uploading to the selected folder')
                        : t('uploading_to_all_files', 'Uploading to All Files')}
                    </span>
                  </>
                )}
              </div>
              <FileManager
                onSelect={handleFileSelect}
                onFolderChange={setMyFilesFolderId}
                refreshKey={myFilesRefreshKey}
              />
            </div>
          )}
        </div>

        {multiple && (
          <div className="border-t border-studioBorder px-5 py-3 flex items-center gap-3">
            <div className="flex-1 flex items-center gap-2 overflow-x-auto">
              {selection.length === 0 && (
                <span className="text-sm text-newTextColor/65">
                  {t('click_items_to_select', 'Click items to select them')}
                </span>
              )}
              {selection.map((item, index) => (
                <div
                  key={`${item.source}-${item.url}-${index}`}
                  className="flex items-center gap-2 px-2 py-1 rounded bg-newBgColorInner border border-newColColor shrink-0"
                >
                  {item.thumbnail || item.source === 'stock' ? (
                    // eslint-disable-next-line @next/next/no-img-element -- external media thumbnail
                    <img
                      src={item.thumbnail || item.url}
                      alt=""
                      className="w-6 h-6 rounded object-cover"
                    />
                  ) : (
                    <div className="w-6 h-6 rounded bg-newColColor" />
                  )}
                  <span className="text-xs text-textColor truncate max-w-[120px]">
                    {item.name || item.url.split('/').pop() || t('selected', 'Selected')}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeSelection(index)}
                    className="text-newTextColor/60 hover:text-textColor"
                    aria-label={t('remove', 'Remove')}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              disabled={selection.length === 0}
              onClick={confirmSelection}
              className="px-4 py-2 rounded bg-[#2B5CD3] text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('confirm_count', 'Confirm ({{count}})', {
                count: selection.length,
              })}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
