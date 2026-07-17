'use client';

import React, { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMediaDirectory } from '@gitroom/react/helpers/use.media.directory';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import i18next from '@gitroom/react/translation/i18next';
import type { FileItem } from './file-manager';
import { DataTable } from '@gitroom/frontend/components/ui/data-table';
import type { Column } from '@gitroom/frontend/components/ui/data-table';

const formatDate = (dateStr: string) => {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString(i18next.resolvedLanguage || 'en', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '';
  }
};

const fileSize = (bytes: number, t: ReturnType<typeof useT>) => {
  if (!bytes) return '-';
  if (bytes < 1024) return t('file_size_bytes', '{{size}} B', { size: bytes });
  if (bytes < 1024 * 1024)
    return t('file_size_kb', '{{size}} KB', { size: (bytes / 1024).toFixed(1) });
  return t('file_size_mb', '{{size}} MB', { size: (bytes / (1024 * 1024)).toFixed(1) });
};

export const FileList: FC<{
  files: FileItem[];
  selectedFiles: FileItem[];
  onToggleSelect: (file: FileItem) => void;
  onFileClick: (file: FileItem) => void;
  sortField: string;
  sortOrder: string;
  onSort: (field: string) => void;
}> = ({ files, selectedFiles, onToggleSelect, onFileClick, sortField, sortOrder, onSort }) => {
  const mediaDirectory = useMediaDirectory();
  const fetch = useFetch();
  const t = useT();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId) {
      renameInputRef.current?.focus();
    }
  }, [renamingId]);

  const renamingNameRef = useRef(renamingName);

  const handleRename = useCallback(async (id: string) => {
    const name = renamingNameRef.current.trim();
    if (!name) return;
    await fetch(`/files/${id}/rename`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    });
    setRenamingId(null);
  }, [fetch]);

  const columns: Column<FileItem>[] = useMemo(() => [
    {
      key: 'preview',
      header: '',
      width: '40px',
      render: (file: FileItem) => {
        const isVideo = hasExtension(file.path, 'mp4');
        const isAudio = hasExtension(file.path, 'mp3', 'wav', 'ogg', 'm4a');
        return (
          <div className="w-[36px] h-[36px] rounded-[6px] overflow-hidden bg-newBgColorInner">
            {isAudio ? (
              <div className="flex items-center justify-center w-full h-full">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-textColor/60">
                  <path d="M2 10V14C2 15.1046 2.89543 16 4 16H6L11.2929 20.2929C11.7458 20.7458 12.5 20.4243 12.5 19.8047V4.19534C12.5 3.57571 11.7458 3.25419 11.2929 3.70711L6 8H4C2.89543 8 2 8.89543 2 10Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M15.5355 8.46448C16.4684 9.39734 16.9948 10.6611 17 11.9927C17.0052 13.3243 16.4888 14.5921 15.564 15.5355" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M19.6569 5.17157C21.1494 6.66412 21.9952 8.69168 22 10.8487C22.0048 13.0058 21.1692 15.0372 19.6845 16.5372" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            ) : isVideo ? (
              <video src={mediaDirectory.set(file.path)} className="w-full h-full object-cover" muted preload="metadata">
                <track kind="captions" src="" label={t('no_captions', 'No captions')} default />
              </video>
            ) : (
              // Remote upload URLs cannot be pre-configured in next/image domains; use native img for thumbnails.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={mediaDirectory.set(file.path)} alt="" className="w-full h-full object-cover" loading="lazy" />
            )}
          </div>
        );
      },
    },
    {
      key: 'name',
      header: t('name', 'Name'),
      sortable: true,
      render: (file: FileItem) => {
        if (renamingId === file.id) {
          return (
            <input
              ref={renameInputRef}
              value={renamingName}
              onChange={(e) => {
                setRenamingName(e.target.value);
                renamingNameRef.current = e.target.value;
              }}
              onBlur={() => handleRename(file.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename(file.id);
                if (e.key === 'Escape') setRenamingId(null);
              }}
              className="bg-transparent border-b border-[#2B5CD3] text-[13px] text-textColor outline-none"
            />
          );
        }
        return (
          <button
            type="button"
            className="text-[13px] text-textColor cursor-pointer hover:text-btnPrimaryAccent truncate max-w-[200px] text-left"
            onDoubleClick={() => { setRenamingId(file.id); setRenamingName(file.name); }}
          >
            {file.originalName || file.name}
          </button>
        );
      },
    },
    { key: 'type', header: t('type', 'Type'), sortable: true, render: (file: FileItem) => {
      const ext = file.name?.split('.').pop()?.toUpperCase() || file.type?.toUpperCase();
      return <span className="text-[12px] text-textColor/60">{ext}</span>;
    }},
    { key: 'size', header: t('size', 'Size'), sortable: true, render: (file: FileItem) => (
      <span className="text-[12px] text-textColor/60">{fileSize(file.fileSize, t)}</span>
    )},
    { key: 'folder', header: t('folder', 'Folder'), render: (file: FileItem) => (
      <span className="text-[12px] text-textColor/60">{file.folder?.name || '-'}</span>
    )},
    { key: 'createdAt', header: t('created', 'Created'), sortable: true, render: (file: FileItem) => (
      <span className="text-[12px] text-textColor/60 whitespace-nowrap">{formatDate(file.createdAt)}</span>
    )},
  ], [renamingId, renamingName, mediaDirectory, handleRename, t]);

  return (
    <DataTable
      columns={columns}
      data={files}
      keyExtractor={(file: FileItem) => file.id}
      selectedIds={selectedFiles.map((f) => f.id)}
      onSelectionChange={(ids) => {
        const toRemove = selectedFiles.filter((sf) => !ids.includes(sf.id));
        const toAdd = files.filter((f) => ids.includes(f.id) && !selectedFiles.find((sf) => sf.id === f.id));
        toRemove.forEach((f) => onToggleSelect(f));
        toAdd.forEach((f) => onToggleSelect(f));
      }}
      sortKey={sortField}
      sortDir={sortOrder as 'asc' | 'desc'}
      onSort={(key) => onSort(key)}
      onRowClick={(file: FileItem) => onToggleSelect(file)}
      emptyState={{ title: t('no_files_found', 'No files found') }}
    />
  );
};
