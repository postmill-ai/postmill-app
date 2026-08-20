'use client';

import React, { FC, useCallback, useEffect, useRef, useState } from 'react';
import { useMediaDirectory } from '@postmill-ai/react/helpers/use.media.directory';
import { hasExtension } from '@postmill-ai/helpers/utils/has.extension';
import clsx from 'clsx';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import i18next from '@postmill-ai/react/translation/i18next';
import type { FileItem } from './file-manager';
import type { FolderItem } from './folder.utils';
import { useLongPress } from '@postmill-ai/frontend/components/ui/use-long-press';

/** Shape `useContextMenu().openAt` accepts — a real event or a synthesized point. */
type MenuEvent = {
  clientX: number;
  clientY: number;
  currentTarget: EventTarget | null;
  preventDefault?: () => void;
};

// Tile width per breakpoint, shared by folder and file tiles so the two sections
// line up as one grid. Desktop shows 4/5/6 per row.
const TILE_WIDTH =
  'w-[calc(50%-3px)] sm:w-[calc(33.333%-3px)] md:w-[calc(25%-3px)] lg:w-[calc(25%-3px)] xl:w-[calc(20%-3px)] 2xl:w-[calc(16.666%-3px)] min-w-[100px]';

const SectionHeading: FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="w-full text-[11px] font-[600] uppercase tracking-wide text-newTextColor/60 mt-[6px] mb-[4px] first:mt-0">
    {children}
  </div>
);

// Thumbnail with a graceful fallback: prefer a still thumbnail (doubles as a
// video poster), fall back to the raw image path / video first-frame, and show
// a placeholder icon when the source is missing/unrenderable (broken image).
const Thumb: FC<{ file: FileItem }> = ({ file }) => {
  const mediaDirectory = useMediaDirectory();
  const t = useT();
  const [broken, setBroken] = useState(false);
  const isVideo = hasExtension(file.path, 'mp4');
  const isAudio = hasExtension(file.path, 'mp3', 'wav', 'ogg', 'm4a');
  const thumb = file.thumbnail
    ? mediaDirectory.set(file.thumbnail)
    : !isVideo && !isAudio
    ? mediaDirectory.set(file.path)
    : '';
  const thumbRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const img = thumbRef.current;
    if (!img) return;
    const onError = () => setBroken(true);
    img.addEventListener('error', onError);
    return () => img.removeEventListener('error', onError);
  }, [thumb]);

  if (isAudio) {
    // Compact audio tile; the full waveform player opens in the modal.
    return (
      <div className="flex flex-col items-center justify-center gap-[10px] w-full h-full bg-newBgColorInner text-newTextColor/70">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
        <div className="flex items-end gap-[2px] h-[18px]">
          {[6, 12, 9, 16, 8, 14, 5, 11, 7].map((h, i) => (
            <span key={i} style={{ height: h }} className="w-[3px] rounded-full bg-btnPrimary/60" />
          ))}
        </div>
      </div>
    );
  }

  if (thumb && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        ref={thumbRef}
        src={thumb}
        alt={file.alt || file.name}
        className="w-full h-full object-cover"
        loading="lazy"
      />
    );
  }
  if (isVideo && !broken) {
    return (
      <video
        src={mediaDirectory.set(file.path)}
        className="w-full h-full object-cover"
        muted
        preload="metadata"
      >
        <track kind="captions" src="" label={t('no_captions', 'No captions')} default />
      </video>
    );
  }
  return (
    <div className="flex items-center justify-center w-full h-full text-newTextColor/60">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="9" cy="9" r="2" />
        <path d="M21 15l-5-5L5 21" />
      </svg>
    </div>
  );
};

const formatDate = (d: string) => {
  try {
    return new Date(d).toLocaleDateString(i18next.resolvedLanguage || 'en', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '';
  }
};

const fileSize = (bytes: number, t: ReturnType<typeof useT>) => {
  if (!bytes) return '';
  if (bytes < 1024) return t('file_size_bytes', '{{size}} B', { size: bytes });
  if (bytes < 1024 * 1024)
    return t('file_size_kb', '{{size}} KB', { size: (bytes / 1024).toFixed(0) });
  return t('file_size_mb', '{{size}} MB', { size: (bytes / (1024 * 1024)).toFixed(1) });
};

export const FileGrid: FC<{
  files: FileItem[];
  selectedFiles: FileItem[];
  onToggleSelect: (file: FileItem) => void;
  onFileClick: (file: FileItem) => void;
  standalone?: boolean;
  onSelect?: (items: FileItem[]) => void;
  /** Subfolders of the current folder, rendered ahead of the files. */
  folders?: FolderItem[];
  onFolderOpen?: (folderId: string) => void;
  /** Drop-target props for a folder tile, from `useFolderDropTarget`. */
  folderDropProps?: (folderId: string | null) => Record<string, unknown>;
  isFolderOver?: (folderId: string | null) => boolean;
  onFileMenu?: (e: MenuEvent, file: FileItem) => void;
  onFolderMenu?: (e: MenuEvent, folder: FolderItem) => void;
}> = ({
  files,
  selectedFiles,
  onToggleSelect,
  onFileClick,
  onSelect,
  folders = [],
  onFolderOpen,
  folderDropProps,
  isFolderOver,
  onFileMenu,
  onFolderMenu,
}) => {
  const t = useT();
  const handleDragStart = useCallback((e: React.DragEvent, fileId: string) => {
    e.dataTransfer.setData('text/plain', fileId);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  // One hook instance per grid: only one touch press can be in flight at a time.
  const fileLongPress = useLongPress<FileItem>((point, file) =>
    onFileMenu?.({ ...point, currentTarget: null, preventDefault: () => undefined }, file)
  );
  const folderLongPress = useLongPress<FolderItem>((point, folder) =>
    onFolderMenu?.({ ...point, currentTarget: null, preventDefault: () => undefined }, folder)
  );

  if (!files?.length && !folders.length) return null;

  const selectedIds = new Set(selectedFiles.map(f => f.id));
  // Only label the sections when both are present; a single section needs no heading.
  const showHeadings = folders.length > 0 && files.length > 0;

  return (
    <div className="flex flex-col gap-[3px]">
      {folders.length > 0 && (
        <>
          {showHeadings && <SectionHeading>{t('folders', 'Folders')}</SectionHeading>}
          {/* Folder tiles are shorter than file tiles, so they get their own wrap
              container — sharing one would leave ragged rows. */}
          <div className="flex flex-wrap gap-[3px]">
            {folders.map((folder) => (
              <FolderTile
                key={folder.id}
                folder={folder}
                onOpen={() => onFolderOpen?.(folder.id)}
                isOver={!!isFolderOver?.(folder.id)}
                dropProps={folderDropProps?.(folder.id)}
                onMenu={onFolderMenu ? (e) => onFolderMenu(e, folder) : undefined}
                longPress={onFolderMenu ? folderLongPress.bind(folder) : undefined}
                t={t}
              />
            ))}
          </div>
        </>
      )}

      {showHeadings && <SectionHeading>{t('files', 'Files')}</SectionHeading>}
      <div className="flex flex-wrap gap-[3px]">
        {files.map((file) => (
          <FileTile
            key={file.id}
            file={file}
            isSelected={selectedIds.has(file.id)}
            onDragStart={handleDragStart}
            onActivate={() => (onSelect ? onSelect([file]) : onToggleSelect(file))}
            onPreview={!onSelect ? () => onFileClick(file) : undefined}
            onMenu={onFileMenu ? (e) => onFileMenu(e, file) : undefined}
            longPress={onFileMenu ? fileLongPress.bind(file) : undefined}
            t={t}
          />
        ))}
      </div>
    </div>
  );
};

const FileTile: FC<{
  file: FileItem;
  isSelected: boolean;
  onDragStart: (e: React.DragEvent, fileId: string) => void;
  onActivate: () => void;
  onPreview?: () => void;
  onMenu?: (e: MenuEvent) => void;
  longPress?: Record<string, unknown>;
  t: ReturnType<typeof useT>;
}> = ({ file, isSelected, onDragStart, onActivate, onPreview, onMenu, longPress, t }) => {
  const tags: string[] = file.tags ? JSON.parse(file.tags) : [];

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => onDragStart(e, file.id)}
      className={clsx(
        'group relative rounded-[8px] cursor-grab active:cursor-grabbing border-[3px] transition-all select-none',
        TILE_WIDTH,
        isSelected ? 'border-btnPrimary' : 'border-transparent hover:border-btnPrimary/40'
      )}
      // iOS Safari fires contextmenu on long-press and shows the callout menu.
      style={{ WebkitTouchCallout: 'none' }}
      onContextMenu={onMenu}
      {...longPress}
      onClick={onActivate}
      onDoubleClick={onPreview}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onActivate();
        }
      }}
    >
      <div className="w-full aspect-square overflow-hidden rounded-t-[5px] bg-newBgColorInner relative">
        <Thumb file={file} />

        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all pointer-events-none" />

        {isSelected && (
          <div className="absolute top-[6px] right-[6px] w-[22px] h-[22px] bg-btnPrimary rounded-full flex items-center justify-center">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        )}
      </div>

      <div className="px-[7px] py-[6px] bg-newBgColorInner rounded-b-[5px] border-t border-newBorder">
        <div className="text-[11px] text-textColor truncate" title={file.originalName || file.name}>
          {file.originalName || file.name}
        </div>
        <div className="text-[10px] text-newTextColor/65 truncate">
          {formatDate(file.createdAt)}
          {file.fileSize ? ` · ${fileSize(file.fileSize, t)}` : ''}
        </div>
        {tags.length > 0 && (
          <div className="flex gap-[4px] mt-[3px] flex-wrap">
            {tags.slice(0, 2).map((tag: string) => (
              <span key={tag} className="text-[9px] px-[4px] py-px rounded-[3px] bg-btnPrimary/15 text-btnPrimaryAccent">{tag}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const FolderTile: FC<{
  folder: FolderItem;
  onOpen: () => void;
  isOver: boolean;
  dropProps?: Record<string, unknown>;
  onMenu?: (e: MenuEvent) => void;
  longPress?: Record<string, unknown>;
  t: ReturnType<typeof useT>;
}> = ({ folder, onOpen, isOver, dropProps, onMenu, longPress, t }) => {
  return (
  <div
    role="button"
    tabIndex={0}
    aria-label={t('open_folder_named', 'Open folder {{name}}', { name: folder.name })}
    onClick={onOpen}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onOpen();
      }
    }}
    onContextMenu={onMenu}
    {...longPress}
    {...dropProps}
    style={{ WebkitTouchCallout: 'none' }}
    className={clsx(
      'group relative rounded-[8px] cursor-pointer border-[3px] transition-all select-none',
      TILE_WIDTH,
      isOver ? 'border-btnPrimary' : 'border-transparent hover:border-btnPrimary/40'
    )}
  >
    <div
      className={clsx(
        'flex items-center gap-[8px] px-[10px] py-[12px] rounded-[5px] bg-newBgColorInner border border-newBorder transition-colors',
        isOver && 'bg-btnPrimary/15'
      )}
    >
      <svg width="22" height="22" viewBox="0 0 16 16" fill="none" className="shrink-0" aria-hidden="true">
        <path
          d="M2 4.5C2 3.39543 2.89543 2.5 4 2.5H5.93934C6.46977 2.5 6.97848 2.71071 7.35355 3.08579L8 3.73223C8.18935 3.92156 8.44705 4.02708 8.71573 4.02708H12C13.1046 4.02708 14 4.92251 14 6.02708V11.5C14 12.6046 13.1046 13.5 12 13.5H4C2.89543 13.5 2 12.6046 2 11.5V4.5Z"
          fill={folder.color || '#2B5CD3'}
          fillOpacity="0.25"
          stroke={folder.color || '#2B5CD3'}
          strokeWidth="1.3"
        />
      </svg>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] text-textColor truncate" title={folder.name}>
          {folder.name}
        </div>
        <div className="text-[10px] text-newTextColor/65">
          {t('items_count', '{{count}} items', { count: folder._count?.files || 0 })}
        </div>
      </div>
    </div>
  </div>
  );
};
