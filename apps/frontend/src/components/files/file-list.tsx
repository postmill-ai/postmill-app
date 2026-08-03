'use client';

import React, { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMediaDirectory } from '@postmill-ai/react/helpers/use.media.directory';
import { hasExtension } from '@postmill-ai/helpers/utils/has.extension';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import i18next from '@postmill-ai/react/translation/i18next';
import clsx from 'clsx';
import type { FileItem } from './file-manager';
import type { FolderItem } from './folder.utils';
import { DataTable } from '@postmill-ai/frontend/components/ui/data-table';
import type { Column } from '@postmill-ai/frontend/components/ui/data-table';
import { useLongPress } from '@postmill-ai/frontend/components/ui/use-long-press';

/** Shape `useContextMenu().openAt` accepts. */
type MenuEvent = {
  clientX: number;
  clientY: number;
  currentTarget: EventTarget | null;
  preventDefault?: () => void;
};

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
  /** Subfolders of the current folder, rendered ahead of the files. */
  folders?: FolderItem[];
  onFolderOpen?: (folderId: string) => void;
  folderDropProps?: (folderId: string | null) => Record<string, unknown>;
  isFolderOver?: (folderId: string | null) => boolean;
  onFileMenu?: (e: MenuEvent, file: FileItem) => void;
  onFolderMenu?: (e: MenuEvent, folder: FolderItem) => void;
  /** Revalidate after a rename — without it the row keeps the old name. */
  onRefresh?: () => void;
}> = ({
  files,
  selectedFiles,
  onToggleSelect,
  onFileClick,
  sortField,
  sortOrder,
  onSort,
  folders = [],
  onFolderOpen,
  folderDropProps,
  isFolderOver,
  onFileMenu,
  onFolderMenu,
  onRefresh,
}) => {
  const mediaDirectory = useMediaDirectory();
  const fetch = useFetch();
  const toaster = useToaster();
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
  const savingRef = useRef(false);

  const handleRename = useCallback(async (id: string) => {
    // Enter fires this and then blurs the input, which fires it again — without
    // the guard every rename sent two PUTs.
    if (savingRef.current) return;
    const name = renamingNameRef.current.trim();
    setRenamingId(null);
    if (!name) return;
    savingRef.current = true;
    try {
      const res = await fetch(`/files/${id}/rename`, {
        method: 'PUT',
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        toaster.show(t('failed_to_rename_file', 'Failed to rename file'), 'warning');
        return;
      }
      onRefresh?.();
    } finally {
      savingRef.current = false;
    }
  }, [fetch, onRefresh, toaster, t]);

  const startRename = useCallback((file: FileItem) => {
    setRenamingId(file.id);
    // Seed from the displayed value; `file.name` is the randomized storage
    // filename the user never sees.
    const displayName = file.originalName || file.name;
    setRenamingName(displayName);
    renamingNameRef.current = displayName;
  }, []);

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
            onDoubleClick={() => startRename(file)}
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
  ], [renamingId, renamingName, mediaDirectory, handleRename, startRename, t]);

  // One hook instance serves every row — only one touch press exists at a time.
  const fileLongPress = useLongPress<FileItem>((point, file) =>
    onFileMenu?.({ ...point, currentTarget: null, preventDefault: () => undefined }, file)
  );
  const folderLongPress = useLongPress<FolderItem>((point, folder) =>
    onFolderMenu?.({ ...point, currentTarget: null, preventDefault: () => undefined }, folder)
  );

  // Folders ride along as leading rows rather than entering `data`, so they stay
  // out of the file selection and sort model while still sharing one table.
  const folderRows = folders.length
    ? folders.map((folder) => (
        <tr
          key={folder.id}
          {...(folderDropProps?.(folder.id) ?? {})}
          {...(onFolderMenu
            ? {
                onContextMenu: (e: React.MouseEvent) => onFolderMenu(e, folder),
                style: { WebkitTouchCallout: 'none' as const },
                ...folderLongPress.bind(folder),
              }
            : {})}
          onClick={() => onFolderOpen?.(folder.id)}
          className={clsx(
            'border-b border-newTableBorder/60 hover:bg-boxHover transition-colors cursor-pointer',
            'mobile:flex mobile:flex-col mobile:gap-[6px] mobile:p-[14px] mobile:rounded-[10px] mobile:border mobile:border-newTableBorder mobile:mb-[10px]',
            isFolderOver?.(folder.id) && 'bg-btnPrimary/10'
          )}
        >
          {/* Empty cell keeps the folder row aligned with the selection column. */}
          <td className="py-[14px] px-[16px] mobile:hidden" />
          <td className="py-[10px] px-[16px] mobile:hidden">
            <svg width="22" height="22" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M2 4.5C2 3.39543 2.89543 2.5 4 2.5H5.93934C6.46977 2.5 6.97848 2.71071 7.35355 3.08579L8 3.73223C8.18935 3.92156 8.44705 4.02708 8.71573 4.02708H12C13.1046 4.02708 14 4.92251 14 6.02708V11.5C14 12.6046 13.1046 13.5 12 13.5H4C2.89543 13.5 2 12.6046 2 11.5V4.5Z"
                fill={folder.color || '#2B5CD3'}
                fillOpacity="0.25"
                stroke={folder.color || '#2B5CD3'}
                strokeWidth="1.3"
              />
            </svg>
          </td>
          <td className="py-[10px] px-[16px]" data-label={t('name', 'Name')}>
            <span className="text-[13px] text-textColor truncate">{folder.name}</span>
          </td>
          <td className="py-[10px] px-[16px]" data-label={t('type', 'Type')}>
            <span className="text-[12px] text-textColor/60">{t('folder', 'Folder')}</span>
          </td>
          <td className="py-[10px] px-[16px]" data-label={t('size', 'Size')}>
            <span className="text-[12px] text-textColor/60">-</span>
          </td>
          <td className="py-[10px] px-[16px]" data-label={t('folder', 'Folder')}>
            <span className="text-[12px] text-textColor/60">
              {t('items_count', '{{count}} items', { count: folder._count?.files || 0 })}
            </span>
          </td>
          <td className="py-[10px] px-[16px]" data-label={t('created', 'Created')}>
            <span className="text-[12px] text-textColor/60">-</span>
          </td>
        </tr>
      ))
    : null;

  return (
    <DataTable
      columns={columns}
      data={files}
      leadingRows={folderRows}
      rowProps={(file: FileItem) =>
        onFileMenu
          ? {
              onContextMenu: (e: React.MouseEvent) => onFileMenu(e, file),
              style: { WebkitTouchCallout: 'none' },
              ...fileLongPress.bind(file),
            }
          : {}
      }
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
