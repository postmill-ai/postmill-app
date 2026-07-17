'use client';

import React, { FC, useCallback, useEffect, useRef, useState } from 'react';
import { useMediaDirectory } from '@gitroom/react/helpers/use.media.directory';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import i18next from '@gitroom/react/translation/i18next';
import type { FileItem } from './file-manager';

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
}> = ({ files, selectedFiles, onToggleSelect, onFileClick, onSelect }) => {
  const t = useT();
  const handleDragStart = useCallback((e: React.DragEvent, fileId: string) => {
    e.dataTransfer.setData('text/plain', fileId);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  if (!files?.length) return null;

  const selectedIds = new Set(selectedFiles.map(f => f.id));

  return (
    <div className="flex flex-wrap gap-[3px]">
      {files.map((file) => {
        const isSelected = selectedIds.has(file.id);
        const tags = file.tags ? JSON.parse(file.tags) : [];

        return (
          <div
            key={file.id}
            role="button"
            tabIndex={0}
            draggable
            onDragStart={(e) => handleDragStart(e, file.id)}
            className={clsx(
              'group relative w-[calc(50%-3px)] sm:w-[calc(33.333%-3px)] md:w-[calc(25%-3px)] lg:w-[calc(16.666%-3px)] xl:w-[calc(12.5%-3px)] min-w-[100px] rounded-[8px] cursor-grab active:cursor-grabbing border-[3px] transition-all',
              isSelected ? 'border-btnPrimary' : 'border-transparent hover:border-btnPrimary/40'
            )}
            onClick={() => {
              if (onSelect) {
                onSelect([file]);
              } else {
                onToggleSelect(file);
              }
            }}
            onDoubleClick={() => !onSelect && onFileClick(file)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (onSelect) {
                  onSelect([file]);
                } else {
                  onToggleSelect(file);
                }
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
              <div
                className="text-[11px] text-textColor truncate"
                title={file.originalName || file.name}
              >
                {file.originalName || file.name}
              </div>
              <div className="text-[10px] text-newTextColor/65 truncate">
                {formatDate(file.createdAt)}
                {file.fileSize ? ` · ${fileSize(file.fileSize, t)}` : ''}
              </div>
              {tags.length > 0 && (
                <div className="flex gap-[4px] mt-[3px] flex-wrap">
                  {tags.slice(0, 2).map((tag: string) => (
                    <span key={tag} className="text-[9px] px-[4px] py-[1px] rounded-[3px] bg-btnPrimary/15 text-btnPrimaryAccent">{tag}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
