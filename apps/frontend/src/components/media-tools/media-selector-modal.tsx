'use client';

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { StockAudio } from './stock-audio';
import { StockPhotos } from './stock-photos';
import { StockVideos } from './stock-videos';
import { StockVectors } from './stock-vectors';
import { StockStickers } from './stock-stickers';
import { StockIcons } from './stock-icons';
import { FileManager } from '@postmill-ai/frontend/components/files/file-manager';
import type { FileItem } from '@postmill-ai/frontend/components/files/file-manager';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { useImportStockMedia } from '@postmill-ai/frontend/components/media-tools/media-import';
import { OverflowTabs } from '@postmill-ai/frontend/components/ui/overflow-tabs';

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

// Your own files lead: the picker exists to attach something you already have,
// so it must not open on a stock-photo wall. `activeTab` takes `tabs[0]`, and
// 'My Files' maps to a null kind (below) so it survives every `kinds` filter —
// which makes it the default everywhere without extra logic.
const ALL_TABS = [
  'My Files',
  'Stock Audio',
  'Stock Icons',
  'Stock Photos',
  'Stock Stickers',
  'Stock Vectors',
  'Stock Videos',
] as const;

export type MediaTab = (typeof ALL_TABS)[number];

const TAB_TO_KIND: Record<MediaTab, MediaKind | null> = {
  'My Files': null,
  'Stock Audio': 'audio',
  'Stock Icons': 'image',
  'Stock Photos': 'image',
  'Stock Stickers': 'image',
  'Stock Vectors': 'image',
  'Stock Videos': 'video',
};

// Tabs are compared/keyed by their canonical English value (ALL_TABS) — only the
// displayed label is translated, via this lookup.
const TAB_LABEL_KEYS: Record<MediaTab, string> = {
  'My Files': 'my_files_tab',
  'Stock Audio': 'audio',
  'Stock Icons': 'icons',
  'Stock Photos': 'photos',
  'Stock Stickers': 'stickers',
  'Stock Vectors': 'stock_vectors_tab',
  'Stock Videos': 'videos',
};

/**
 * Displayed labels drop the word "Stock" — the bar carries it once as a group
 * label instead of repeating it on every tab.
 */
const TAB_LABELS: Record<MediaTab, string> = {
  'My Files': 'My Files',
  'Stock Audio': 'Audio',
  'Stock Icons': 'Icons',
  'Stock Photos': 'Photos',
  'Stock Stickers': 'Stickers',
  'Stock Vectors': 'Vectors',
  'Stock Videos': 'Videos',
};

/** Everything but My Files sits under one "Stock" heading. */
const tabSection = (tab: MediaTab): string | undefined =>
  tab === 'My Files' ? undefined : 'Stock';

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

export interface MediaSelectorModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * Contextual heading, e.g. "Background image". Defaults to "Select media".
   * The picker owns its header — never wrap it in `openModal` to add a title.
   */
  title?: React.ReactNode;
  /** Legacy single-select callback. Closes the modal. Default behavior. */
  onSelect?: (item: MediaSelectorItem) => void | Promise<void>;
  /** Multi-select mode: keeps the modal open and accumulates selections. */
  multiple?: boolean;
  /** Multi-select confirmation callback. Receives the accumulated batch. */
  onConfirm?: (items: MediaSelectorItem[]) => void | Promise<void>;
  /**
   * Exactly these tabs, in this order — an allow-list that beats `kinds` and
   * `excludeTabs` when given.
   *
   * `kinds` can't separate the image sub-sources (Photos/Vectors/Stickers/Icons
   * all map to `'image'`), so a caller that wants "My Files and stock photos,
   * nothing else" had to spell it out as three exclusions. This says it once.
   */
  tabs?: readonly MediaTab[];
  /** Restrict visible tabs to post-appropriate kinds. Default = all tabs. */
  kinds?: MediaKind[];
  /**
   * Hide specific tabs by name (e.g. `'Stock Icons'`, `'Stock Stickers'`).
   * `kinds` filters by media kind, which cannot distinguish image sub-sources
   * (Photos/Vectors/Stickers/Icons all map to `'image'`); use this to drop an
   * individual stock tab — e.g. the composer hides Icons (SVG → /files/import 415).
   */
  excludeTabs?: readonly string[];
  /**
   * Guarantee the caller receives a real File: stock picks are imported via
   * `POST /files/import` before `onSelect`/`onConfirm` fire, so every item has
   * a `fileId` and a `/files` path. Callers that persist a reference (settings,
   * studios, HeyGen) want this; it replaces six hand-rolled copies of the same
   * fallback. Do NOT combine with a caller that imports the batch itself.
   */
  requireFile?: boolean;
  /** File name used when `requireFile` imports a stock pick. */
  importName?: string;
}

export const MediaSelectorModal: React.FC<MediaSelectorModalProps> = ({
  open,
  onClose,
  title,
  onSelect,
  multiple,
  onConfirm,
  tabs: tabsProp,
  kinds,
  excludeTabs,
  requireFile,
  importName,
}) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const importStockMedia = useImportStockMedia();
  const titleId = useId();
  const tabs = useMemo(() => {
    // An explicit list is the caller being specific; honour it verbatim.
    if (tabsProp?.length) return tabsProp.filter((tab) => ALL_TABS.includes(tab));
    const kindFiltered = !kinds?.length
      ? ALL_TABS
      : ALL_TABS.filter((tab) => {
          const kind = TAB_TO_KIND[tab];
          return kind === null || kinds.includes(kind);
        });
    if (!excludeTabs?.length) return kindFiltered;
    return kindFiltered.filter((tab) => !excludeTabs.includes(tab));
  }, [tabsProp, kinds, excludeTabs]);

  /**
   * The one kind this picker accepts, if it accepts exactly one — either stated
   * outright via `kinds`, or implied by a tab list that only has one kind in it.
   * My Files is filtered to that, so you can't pick a file the caller rejects.
   */
  const lockedKind = useMemo((): MediaKind | undefined => {
    if (kinds?.length === 1) return kinds[0];
    const fromTabs = new Set(
      tabs.map((tab) => TAB_TO_KIND[tab as MediaTab]).filter(Boolean) as MediaKind[]
    );
    return fromTabs.size === 1 ? [...fromTabs][0] : undefined;
  }, [kinds, tabs]);
  const [activeTab, setActiveTab] = useState<string>(tabs[0]);
  const [selection, setSelection] = useState<MediaSelectorItem[]>([]);
  const [myFilesFolderId, setMyFilesFolderId] = useState<string | null>(null);
  const [myFilesRefreshKey, setMyFilesRefreshKey] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
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

  // `requireFile` turns a stock pick into a real File before the caller sees it,
  // so no caller has to hand-roll the import fallback. Failure keeps the dialog
  // open — silently handing back a fileId-less item is what used to strand picks.
  const resolveItems = async (items: MediaSelectorItem[]) => {
    if (!requireFile) return items;
    setIsResolving(true);
    try {
      return await Promise.all(
        items.map((item) => importStockMedia(item, { name: importName }))
      );
    } catch (err) {
      toaster.show(
        (err as Error).message || t('import_failed', 'Import failed'),
        'warning'
      );
      return null;
    } finally {
      setIsResolving(false);
    }
  };

  const finalize = async (item: MediaSelectorItem) => {
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
    const resolved = await resolveItems([item]);
    if (!resolved) return;
    // Close as soon as *our* work is done. Callers do their own async work
    // (folder-scoped imports, uploads) behind placeholder UI and expect the
    // dialog to be gone by then.
    onClose();
    await onSelect?.(resolved[0]);
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

  const confirmSelection = async () => {
    if (selection.length === 0) return;
    const resolved = await resolveItems(selection);
    if (!resolved) return;
    onClose();
    await onConfirm?.(resolved);
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
      className="fixed inset-0 z-100 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="media-picker"
        // One size on every surface. The multi-select tray is a band inside this
        // fixed height, not a different dialog — resizing per mode is how the
        // picker came to look like a different component per caller.
        className="bg-newBgColor border border-studioBorder rounded-xl flex flex-col w-[880px] max-w-[calc(100vw-24px)] h-[min(700px,calc(100vh-80px))]"
      >
        <div className="px-5 pt-4 border-b border-studioBorder shrink-0">
          <div className="flex items-start justify-between gap-4">
            <h2
              id={titleId}
              className="text-[18px] font-[600] text-textColor truncate min-w-0"
            >
              {title ?? t('select_media', 'Select media')}
            </h2>
            {/* Single-select + requireFile imports after the click with no
                confirm button to hang a spinner on — say so, or the dialog just
                sits there. */}
            {isResolving && (
              <span
                role="status"
                className="flex items-center gap-2 text-[12px] text-newTextColor/65 shrink-0"
              >
                <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                {t('importing_media', 'Importing…')}
              </span>
            )}
            <button
              className="text-newTextColor/60 hover:text-textColor text-lg shrink-0 leading-none"
              onClick={onClose}
              aria-label={t('close_media_selector', 'Close media selector')}
              title={t('close_media_selector', 'Close media selector')}
            >
              ✕
            </button>
          </div>
          <OverflowTabs
            items={tabs.map((tab) => ({
              key: tab,
              label: t(TAB_LABEL_KEYS[tab], TAB_LABELS[tab]),
              section: tabSection(tab),
            }))}
            activeKey={activeTab}
            onSelect={setActiveTab}
            showSectionLabels
            ariaLabel={t('more_media_sources', 'More media sources')}
            listAriaLabel={t('media_source_aria', 'Media source')}
            className="mt-3 pb-2"
            renderItem={(item, { active, slotProps }) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={active}
                data-overflow-slot={slotProps['data-overflow-slot']}
                className={clsx(
                  'px-4 py-1.5 rounded-sm text-sm font-medium whitespace-nowrap transition-colors',
                  slotProps.className,
                  active
                    ? 'bg-[#2B5CD3] text-white'
                    : 'text-newTextColor/60 hover:text-textColor'
                )}
                onClick={() => setActiveTab(item.key)}
              >
                {item.label}
              </button>
            )}
          />
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'Stock Audio' && (
            <StockAudio mode="select" onSelectFull={handleStockSelect} />
          )}
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
                sidebarMode="drawer"
                lockedType={lockedKind}
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
                  className="flex items-center gap-2 px-2 py-1 rounded-sm bg-newBgColorInner border border-newColColor shrink-0"
                >
                  {item.thumbnail || item.source === 'stock' ? (
                    // eslint-disable-next-line @next/next/no-img-element -- external media thumbnail
                    <img
                      src={item.thumbnail || item.url}
                      alt=""
                      className="w-6 h-6 rounded-sm object-cover"
                    />
                  ) : (
                    <div className="w-6 h-6 rounded-sm bg-newColColor" />
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
              disabled={selection.length === 0 || isResolving}
              onClick={confirmSelection}
              className="px-4 py-2 rounded-sm bg-[#2B5CD3] text-white text-sm font-medium shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isResolving
                ? t('importing_media', 'Importing…')
                : t('confirm_count', 'Confirm ({{count}})', {
                    count: selection.length,
                  })}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
