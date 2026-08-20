'use client';

import React, { FC, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import useSWR from 'swr';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useDebounce } from 'use-debounce';
import { FolderTree } from '@postmill-ai/frontend/components/files/folder-tree';
import { FileGrid } from '@postmill-ai/frontend/components/files/file-grid';
import { FileList } from '@postmill-ai/frontend/components/files/file-list';
import { FileDetailsPanel } from '@postmill-ai/frontend/components/files/file-details-panel';
import { FilePreviewModal } from '@postmill-ai/frontend/components/files/file-preview-modal';
import { BulkToolbar } from '@postmill-ai/frontend/components/files/bulk-toolbar';
import { useModals } from '@postmill-ai/frontend/components/layout/new-modal';
import { FileUploader } from '@postmill-ai/frontend/components/files/file-uploader';
import { LoadingComponent } from '@postmill-ai/frontend/components/layout/loading';
import { TrashComponent } from '@postmill-ai/frontend/components/files/trash.component';
import clsx from 'clsx';
import { PageHeader } from '@postmill-ai/frontend/components/ui/page-header';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { ancestorsOf, childrenOf, resolveFolderPath, useFolderDropTarget, type FolderItem } from '@postmill-ai/frontend/components/files/folder.utils';
import { FolderBreadcrumb } from '@postmill-ai/frontend/components/files/folder-breadcrumb';
import { ContextMenu, type ContextMenuItem } from '@postmill-ai/frontend/components/ui/context-menu';
import { useContextMenu } from '@postmill-ai/frontend/components/ui/use-context-menu';
import { RenameDialog } from '@postmill-ai/frontend/components/files/rename-dialog';
import { useMediaDirectory } from '@postmill-ai/react/helpers/use.media.directory';
import { hasExtension } from '@postmill-ai/helpers/utils/has.extension';
import { openInDesigner } from '@postmill-ai/frontend/components/media-tools/open-in-designer';
import { usePathname, useRouter } from 'next/navigation';

type ViewMode = 'grid' | 'list';

/** The library's own route — the base every synced folder path hangs off. */
const FILES_ROUTE = '/files';

// One control for field + direction: the pair is what a user actually picks
// ("newest first"), and two selects would only make them assemble it. The list
// view's column headers set the same two pieces of state.
const SORT_OPTIONS: { field: string; order: string; key: string; label: string }[] = [
  { field: 'createdAt', order: 'desc', key: 'newest_first', label: 'Newest first' },
  { field: 'createdAt', order: 'asc', key: 'oldest_first', label: 'Oldest first' },
  { field: 'name', order: 'asc', key: 'name_a_z', label: 'Name A–Z' },
  { field: 'name', order: 'desc', key: 'name_z_a', label: 'Name Z–A' },
  { field: 'size', order: 'desc', key: 'largest_first', label: 'Largest first' },
  { field: 'size', order: 'asc', key: 'smallest_first', label: 'Smallest first' },
  { field: 'type', order: 'asc', key: 'type', label: 'Type' },
];

const GridIcon: FC<{ className?: string }> = ({ className }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={className}>
    <rect x="1" y="1" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.5" />
    <rect x="9.5" y="1" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.5" />
    <rect x="1" y="9.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.5" />
    <rect x="9.5" y="9.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

const FolderIcon: FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const ListViewIcon: FC<{ className?: string }> = ({ className }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={className}>
    <rect x="1" y="1" width="14" height="3.5" rx="1" stroke="currentColor" strokeWidth="1.5" />
    <rect x="1" y="6.25" width="14" height="3.5" rx="1" stroke="currentColor" strokeWidth="1.5" />
    <rect x="1" y="11.5" width="14" height="3.5" rx="1" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

export type FileItem = {
  id: string;
  name: string;
  originalName: string | null;
  path: string;
  thumbnail: string | null;
  alt: string | null;
  thumbnailTimestamp: number | null;
  fileSize: number;
  type: string;
  tags: string | null;
  description: string | null;
  folderId: string | null;
  createdAt: string;
  folder?: { id: string; name: string } | null;
};

const SIDEBAR_STORAGE_KEY = 'files:sidebar';

const readStoredSidebar = () => {
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) !== 'collapsed';
  } catch {
    return true;
  }
};

// Other tabs are the only external writer; `storage` is enough to stay in sync.
const subscribeToStorage = (onChange: () => void) => {
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
};

export const FileManager: FC<{
  standalone?: boolean;
  onSelect?: (items: FileItem[]) => void;
  onFolderChange?: (folderId: string | null) => void;
  refreshKey?: number | string;
  /**
   * `inline` keeps the 240px folder column beside the grid (the /files page);
   * `drawer` drops it entirely and reaches folders through the overlay drawer.
   * Modal hosts must use `drawer`: the inline column is gated on `lg:` — a
   * *viewport* query — so inside a 720px dialog it would still render on any
   * desktop and leave ~440px for the browse area.
   */
  sidebarMode?: 'inline' | 'drawer';
  /**
   * Pin the type filter and hide its control.
   *
   * For a host that has already decided what it can accept — a picker opened as
   * "insert a video" — offering an All-types escape hatch only lets you choose a
   * file the caller must then reject.
   */
  lockedType?: 'image' | 'video' | 'audio' | 'document';
  /**
   * Mirror the open folder into the address bar as `/files/<name>/<name>`, and
   * follow the URL back on deep links and browser Back. Opt-in: only the /files
   * page owns that route — a picker modal must never rewrite the location.
   */
  urlSync?: boolean;
}> = ({
  standalone,
  onSelect,
  onFolderChange,
  refreshKey,
  sidebarMode,
  lockedType,
  urlSync,
}) => {
  const fetch = useFetch();
  const t = useT();
  const toaster = useToaster();
  const modals = useModals();
  const router = useRouter();
  const pathname = usePathname();
  const mediaDirectory = useMediaDirectory();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [debouncedSearch] = useDebounce(search, 300);
  // Only a host without `urlSync` keeps the open folder in state; with it, the
  // URL is the one source of truth (see `selectedFolderId` below).
  const [manualFolderId, setManualFolderId] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<FileItem[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [sortField, setSortField] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');
  const [filterType, setFilterType] = useState(lockedType || '');
  const [filterTag, setFilterTag] = useState('');
  const [detailsFile, setDetailsFile] = useState<FileItem | null>(null);
  const [showTrash, setShowTrash] = useState(false);
  const [folderDrawerOpen, setFolderDrawerOpen] = useState(false);
  // `undefined` until the stored preference is read. The component is
  // server-rendered, so reading localStorage in the useState initializer would
  // be a hydration mismatch; `useSyncExternalStore` gives the server/first-paint
  // value and the client value without a setState-in-effect cascade.
  const storedSidebar = useSyncExternalStore(
    subscribeToStorage,
    readStoredSidebar,
    () => true
  );
  const [sidebarOverride, setSidebarOverride] = useState<boolean | null>(null);
  const sidebarOpen = sidebarOverride ?? storedSidebar;

  const resolvedSidebarMode = sidebarMode ?? (standalone ? 'inline' : 'drawer');
  const inlineSidebar = resolvedSidebarMode === 'inline';

  const toggleSidebar = useCallback(() => {
    const next = !sidebarOpen;
    setSidebarOverride(next);
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? 'expanded' : 'collapsed');
    } catch {
      // Storage can be unavailable (private mode, blocked cookies) — the
      // preference simply won't persist.
    }
  }, [sidebarOpen]);

  const setSearchAndReset = useCallback((value: string) => {
    setSearch(value);
    setPage(0);
  }, []);

  const setFilterTypeAndReset = useCallback((value: string) => {
    setFilterType(value);
    setPage(0);
  }, []);

  // Reordering the whole result set invalidates the page you were on — page 3
  // of "newest first" holds nothing in common with page 3 of "name A–Z".
  const setSortAndReset = useCallback((field: string, order: string) => {
    setSortField(field);
    setSortOrder(order);
    setPage(0);
  }, []);

  const { data: foldersData, mutate: mutateFolders } = useSWR(
    'files-folders',
    async () => (await fetch('/files/folders')).json()
  );

  // '/files/Brand%20assets/Logos' → ['Brand assets', 'Logos']
  const urlSegments = useMemo(
    () =>
      urlSync && pathname?.startsWith(FILES_ROUTE)
        ? pathname
            .slice(FILES_ROUTE.length)
            .split('/')
            .filter(Boolean)
            .map(decodeURIComponent)
        : [],
    [urlSync, pathname]
  );

  // With `urlSync` the open folder is read straight out of the address bar,
  // which makes deep links and browser Back/Forward work with no state to keep
  // in step. Only the tree can map a path of folder *names* to an id, so until
  // it has loaded the answer is the root.
  const selectedFolderId = urlSync
    ? foldersData
      ? resolveFolderPath(foldersData, urlSegments)
      : null
    : manualFolderId;

  // Whichever way the folder changed — a click, a deep link, Back — the browse
  // state it belonged to is stale. Adjusting during render (rather than in an
  // effect) keeps the request that follows from ever using the old page.
  const [lastFolderId, setLastFolderId] = useState(selectedFolderId);
  if (lastFolderId !== selectedFolderId) {
    setLastFolderId(selectedFolderId);
    setSelectedFiles([]);
    setDetailsFile(null);
    setPage(0);
  }

  useEffect(() => {
    onFolderChange?.(selectedFolderId);
  }, [selectedFolderId, onFolderChange]);

  // A path that no longer resolves — the folder was renamed or deleted — shows
  // the root, so don't leave the dead path in the address bar.
  useEffect(() => {
    if (!urlSync || !foldersData || !urlSegments.length) return;
    if (resolveFolderPath(foldersData, urlSegments) === null) {
      router.replace(FILES_ROUTE, { scroll: false });
    }
  }, [urlSync, foldersData, urlSegments, router]);

  const params = new URLSearchParams({ page: String(page + 1) });
  if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
  if (selectedFolderId) params.set('folderId', selectedFolderId);
  else params.set('folderId', 'null');
  if (filterType) params.set('type', filterType);
  if (filterTag) params.set('tag', filterTag);
  if (sortField) params.set('sort', sortField);
  if (sortOrder) params.set('order', sortOrder);
  params.set('limit', '24');

  const { data, mutate, isLoading } = useSWR(
    `files-${page}-${debouncedSearch}-${selectedFolderId || 'root'}-${filterType}-${filterTag}-${sortField}-${sortOrder}-${refreshKey ?? 0}`,
    async () => (await fetch(`/files?${params.toString()}`)).json()
  );

  const toggleFileSelection = useCallback((file: FileItem) => {
    setSelectedFiles(prev => {
      const exists = prev.find(f => f.id === file.id);
      if (exists) return prev.filter(f => f.id !== file.id);
      return [...prev, file];
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedFiles([]), []);

  // Open a file in a preview modal (with "Open in Designer"); the modal's
  // Details button reopens the side panel for renaming/tagging/deleting.
  const handleFileClick = useCallback(
    (file: FileItem) => {
      modals.openModal({
        title: '',
        closeOnClickOutside: true,
        closeOnEscape: true,
        withCloseButton: true,
        classNames: { modal: 'w-[100%] max-w-[820px] text-textColor' },
        children: <FilePreviewModal file={file} onDetails={setDetailsFile} />,
        size: '80%',
      });
    },
    [modals]
  );

  // With `urlSync` the navigation IS the state change: pushing the path makes
  // `selectedFolderId` above resolve to the new folder on the next render, and
  // Back gets to walk the same trail in reverse.
  const handleFolderSelect = useCallback(
    (folderId: string | null) => {
      if (!urlSync) {
        setManualFolderId(folderId);
        return;
      }
      const segments = ancestorsOf(foldersData || [], folderId).map(f =>
        encodeURIComponent(f.name)
      );
      router.push(segments.length ? `${FILES_ROUTE}/${segments.join('/')}` : FILES_ROUTE, {
        scroll: false,
      });
    },
    [urlSync, foldersData, router]
  );

  const refresh = useCallback(() => {
    mutate();
    mutateFolders();
  }, [mutate, mutateFolders]);

  const moveFileToFolder = useCallback(
    async (fileId: string, folderId: string | null) => {
      const res = await fetch(`/files/${fileId}/move`, {
        method: 'PUT',
        body: JSON.stringify({ folderId }),
      });
      if (!res.ok) {
        toaster.show(t('failed_to_move_file', 'Failed to move file'), 'warning');
        return;
      }
      toaster.show(t('file_moved_successfully', 'File moved successfully'), 'success');
      refresh();
    },
    [fetch, refresh, toaster, t]
  );

  const { dropProps: folderDropProps, isOver: isFolderOver } =
    useFolderDropTarget(moveFileToFolder);

  // Subfolders of the current folder, derived from the tree the sidebar already
  // fetched. Hidden whenever the file list is filtered or paged, since folders
  // aren't part of that result set and showing them would misrepresent it.
  const foldersFiltered =
    !!debouncedSearch.trim() ||
    (!!filterType && filterType !== lockedType) ||
    !!filterTag ||
    page > 0;
  const visibleFolders = foldersFiltered
    ? []
    : childrenOf(foldersData || [], selectedFolderId);

  // ── Context menus (right-click on desktop, long-press on touch) ──────────
  const fileMenu = useContextMenu<FileItem>();
  const folderMenu = useContextMenu<FolderItem>();

  const openRenameDialog = useCallback(
    (initialName: string, label: string, onSubmit: (name: string) => void) => {
      modals.openModal({
        title: label,
        closeOnClickOutside: true,
        closeOnEscape: true,
        withCloseButton: true,
        center: true,
        children: (close) => (
          <RenameDialog
            initialName={initialName}
            label={label}
            onSubmit={onSubmit}
            onClose={close}
          />
        ),
      });
    },
    [modals]
  );

  const renameFile = useCallback(
    (file: FileItem) =>
      openRenameDialog(
        file.originalName || file.name,
        t('rename_file', 'Rename file'),
        async (name) => {
          const res = await fetch(`/files/${file.id}/rename`, {
            method: 'PUT',
            body: JSON.stringify({ name }),
          });
          if (!res.ok) {
            toaster.show(t('failed_to_rename_file', 'Failed to rename file'), 'warning');
            return;
          }
          refresh();
        }
      ),
    [openRenameDialog, fetch, refresh, toaster, t]
  );

  const renameFolder = useCallback(
    (folder: FolderItem) =>
      openRenameDialog(folder.name, t('rename_folder', 'Rename folder'), async (name) => {
        const res = await fetch(`/files/folders/${folder.id}`, {
          method: 'PUT',
          body: JSON.stringify({ name }),
        });
        if (!res.ok) {
          toaster.show(t('failed_to_rename_folder', 'Failed to rename folder'), 'warning');
          return;
        }
        refresh();
      }),
    [openRenameDialog, fetch, refresh, toaster, t]
  );

  const deleteFile = useCallback(
    async (file: FileItem) => {
      const res = await fetch(`/files/${file.id}/trash`, { method: 'POST' });
      if (!res.ok) {
        toaster.show(t('failed_to_delete_file', 'Failed to delete file'), 'warning');
        return;
      }
      toaster.show(t('file_moved_to_trash', 'File moved to trash'), 'success');
      if (detailsFile?.id === file.id) setDetailsFile(null);
      refresh();
    },
    [fetch, refresh, toaster, t, detailsFile]
  );

  const deleteFolder = useCallback(
    async (folder: FolderItem) => {
      const res = await fetch(`/files/folders/${folder.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const text = await res.text();
        toaster.show(
          text || t('cannot_delete_non_empty_folder', 'Cannot delete non-empty folder'),
          'warning'
        );
      } else {
        toaster.show(t('folder_deleted', 'Folder deleted'), 'success');
        if (selectedFolderId === folder.id) handleFolderSelect(null);
      }
      refresh();
    },
    [fetch, refresh, toaster, t, selectedFolderId, handleFolderSelect]
  );

  const openInDesignerFromFile = useCallback(
    (file: FileItem) => {
      const isVideo = hasExtension(file.path, 'mp4', 'mov', 'webm');
      const isAudio = hasExtension(file.path, 'mp3', 'wav', 'ogg', 'm4a');
      openInDesigner(
        {
          operation: isVideo ? 'video' : isAudio ? 'audio' : 'image',
          artifactUrl: mediaDirectory.set(file.path),
          fileId: file.id,
          source: 'files',
          thumbUrl: isVideo && file.thumbnail ? mediaDirectory.set(file.thumbnail) : undefined,
        },
        router.push
      );
    },
    [mediaDirectory, router]
  );

  const fileMenuItems = useCallback(
    (file: FileItem): ContextMenuItem[] => [
      // Preview and Designer are suppressed in picker mode, where a click means
      // "choose this file" and navigating away would drop the selection.
      ...(!onSelect
        ? ([
            { label: t('preview', 'Preview'), onClick: () => handleFileClick(file) },
            {
              label: t('open_in_designer', 'Open in Designer'),
              onClick: () => openInDesignerFromFile(file),
            },
            { label: t('details', 'Details'), onClick: () => setDetailsFile(file) },
            { divider: true },
          ] as ContextMenuItem[])
        : []),
      { label: t('rename', 'Rename'), onClick: () => renameFile(file) },
      {
        label: t('download', 'Download'),
        onClick: () => window.open(mediaDirectory.set(file.path), '_blank'),
      },
      ...(!onSelect
        ? ([
            { divider: true },
            { label: t('delete', 'Delete'), onClick: () => deleteFile(file), danger: true },
          ] as ContextMenuItem[])
        : []),
    ],
    [
      onSelect,
      t,
      handleFileClick,
      openInDesignerFromFile,
      renameFile,
      deleteFile,
      mediaDirectory,
    ]
  );

  const folderMenuItems = useCallback(
    (folder: FolderItem): ContextMenuItem[] => [
      { label: t('open', 'Open'), onClick: () => handleFolderSelect(folder.id) },
      { label: t('rename', 'Rename'), onClick: () => renameFolder(folder) },
      { divider: true },
      { label: t('delete', 'Delete'), onClick: () => deleteFolder(folder), danger: true },
    ],
    [t, handleFolderSelect, renameFolder, deleteFolder]
  );

  const pages = data?.pages || 0;

  return (
    <div className="flex flex-1 h-full gap-[15px]">
      {/* Desktop sidebar — inline hosts only, and only while expanded.
          The app shell scrolls the document (`min-h-screen`), so there is no
          bounded ancestor for `h-full` to resolve against: the column is made
          sticky and `self-start` instead, which stops it stretching to the (very
          tall) grid row and keeps it in view while the page scrolls. The height
          bound itself lives on FolderTree — a percentage max-height would not
          resolve against a parent that only has a max-height. */}
      {inlineSidebar && sidebarOpen && (
        <div
          id="files-folder-sidebar"
          className="hidden lg:flex lg:flex-col self-start sticky top-[20px] min-h-0"
        >
          <FolderTree
            folders={foldersData || []}
            selectedFolderId={selectedFolderId}
            onSelectFolder={handleFolderSelect}
            onRefresh={mutateFolders}
            onFileMoved={refresh}
          />
        </div>
      )}

      {/* Folder drawer — the only folder surface in drawer mode, and the
          small-screen surface everywhere else. */}
      <div
        id="files-folder-drawer"
        aria-hidden={!folderDrawerOpen}
        // Without inert the closed drawer's buttons stay in the tab order.
        inert={!folderDrawerOpen}
        className={clsx(
          'fixed inset-0 z-210 flex justify-start',
          inlineSidebar && 'lg:hidden',
          !folderDrawerOpen && 'pointer-events-none'
        )}
      >
        <div
          role="button"
          tabIndex={folderDrawerOpen ? 0 : -1}
          aria-label={t('close_folder_drawer', 'Close folder drawer')}
          className={clsx(
            'absolute inset-0 bg-black/50 transition-opacity duration-200',
            folderDrawerOpen ? 'opacity-100' : 'opacity-0'
          )}
          onClick={() => setFolderDrawerOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
              e.preventDefault();
              setFolderDrawerOpen(false);
            }
          }}
        />
        <div
          className={clsx(
            'relative h-full w-[280px] max-w-[85vw] bg-newBgColor border-e border-studioBorder shadow-2xl flex flex-col text-textColor',
            'transition-transform duration-300 ease-out will-change-transform',
            folderDrawerOpen ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full'
          )}
        >
          <div className="h-[56px] shrink-0 flex items-center justify-between px-[16px] bg-studioBg border-b border-studioBorder">
            <div className="text-[16px] font-[600]">{t('folders', 'Folders')}</div>
            <button
              type="button"
              aria-label={t('close', 'Close')}
              onClick={() => setFolderDrawerOpen(false)}
              className="w-[32px] h-[32px] flex items-center justify-center rounded-[8px] text-newTableText hover:bg-[#2B5CD3]/15 hover:text-textColor transition-all"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-hidden p-[12px]">
            <FolderTree
              folders={foldersData || []}
              selectedFolderId={selectedFolderId}
              onSelectFolder={(id) => {
                handleFolderSelect(id);
                setFolderDrawerOpen(false);
              }}
              onRefresh={mutateFolders}
              onFileMoved={refresh}
              drawerMode
            />
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Page chrome belongs to the /files page, not to a picker. Embedded in
            the media picker this rendered a "File Library" heading and a second
            Upload button inside the dialog, on top of the picker's own header
            and drop zone. */}
        {standalone && (
          <PageHeader
            title={t('file_library', 'File Library')}
            description={t('manage_your_images_videos_and_files', 'Manage your images, videos, and files')}
            action={
              <FileUploader
                folderId={selectedFolderId}
                onUploadComplete={refresh}
                variant="header"
              />
            }
          />
        )}
        <div className="flex flex-wrap items-center gap-[12px] mb-[15px]">
          <div className="flex flex-1 items-center gap-[8px] min-w-0 mobile:flex-none mobile:w-full">
            <div className="flex-1 relative min-w-0">
              <input
                type="text"
                value={search}
                onChange={e => setSearchAndReset(e.target.value)}
                placeholder={t('search_files_by_name_tags', 'Search files by name, tags...')}
                className="w-full h-[44px] pl-[40px] pr-[14px] rounded-[8px] bg-newBgColorInner border border-newColColor text-[14px] outline-hidden focus:border-[#2B5CD3] text-textColor"
              />
              <svg
                className="absolute left-[12px] top-[50%] translate-y-[-50%] text-newTextColor/60"
                width="16" height="16" viewBox="0 0 16 16" fill="none"
              >
                <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M10 10L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>

            {/* Hidden when the host locked the type — there is nothing to choose. */}
            {!lockedType && (
              <select
                value={filterType}
                aria-label={t('filter_by_file_type', 'Filter by file type')}
                onChange={e => setFilterTypeAndReset(e.target.value)}
                className="h-[44px] px-[12px] rounded-[8px] bg-newBgColorInner border border-newColColor text-[13px] text-textColor outline-hidden focus:border-[#2B5CD3] shrink-0"
              >
                <option value="">{t('all_types', 'All types')}</option>
                <option value="image">{t('images', 'Images')}</option>
                <option value="video">{t('videos', 'Videos')}</option>
                <option value="audio">{t('audio', 'Audio')}</option>
                <option value="document">{t('documents', 'Documents')}</option>
              </select>
            )}

            <select
              value={`${sortField}-${sortOrder}`}
              aria-label={t('sort_files', 'Sort files')}
              onChange={e => {
                const picked = SORT_OPTIONS.find(o => `${o.field}-${o.order}` === e.target.value);
                if (picked) setSortAndReset(picked.field, picked.order);
              }}
              className="h-[44px] px-[12px] rounded-[8px] bg-newBgColorInner border border-newColColor text-[13px] text-textColor outline-hidden focus:border-[#2B5CD3] shrink-0"
            >
              {SORT_OPTIONS.map(option => (
                <option key={`${option.field}-${option.order}`} value={`${option.field}-${option.order}`}>
                  {t(option.key, option.label)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-[8px] mobile:w-full mobile:justify-between">
            <div className="flex items-center gap-[8px] mobile:order-2">
              <button
                onClick={() => setViewMode('grid')}
                aria-label={t('grid_view', 'Grid view')}
                aria-pressed={viewMode === 'grid'}
                className={clsx('p-[10px] rounded-[8px] border transition-all', viewMode === 'grid'
                  ? 'border-[#2B5CD3] text-btnPrimaryAccent bg-[#2B5CD3]/10'
                  : 'border-newColColor text-textColor hover:bg-boxHover')}
              >
                <GridIcon />
              </button>
              <button
                onClick={() => setViewMode('list')}
                aria-label={t('list_view', 'List view')}
                aria-pressed={viewMode === 'list'}
                className={clsx('p-[10px] rounded-[8px] border transition-all', viewMode === 'list'
                  ? 'border-[#2B5CD3] text-btnPrimaryAccent bg-[#2B5CD3]/10'
                  : 'border-newColColor text-textColor hover:bg-boxHover')}
              >
                <ListViewIcon />
              </button>
            </div>

            <div className="flex items-center gap-[8px] mobile:order-1">
              {/* Two triggers rather than a JS media query: below lg (and in
                  drawer-mode hosts) folders live in the overlay drawer; at lg
                  and above an inline host collapses/expands the column. */}
              <button
                type="button"
                onClick={() => setFolderDrawerOpen(true)}
                aria-expanded={folderDrawerOpen}
                aria-controls="files-folder-drawer"
                className={clsx(
                  'px-[12px] h-[44px] rounded-[8px] border border-newColColor text-[13px] text-textColor hover:bg-boxHover transition-colors flex items-center gap-[6px]',
                  inlineSidebar && 'lg:hidden'
                )}
              >
                <FolderIcon />
                <span>{t('folders', 'Folders')}</span>
              </button>

              {inlineSidebar && (
                <button
                  type="button"
                  onClick={toggleSidebar}
                  aria-expanded={sidebarOpen}
                  aria-controls="files-folder-sidebar"
                  className={clsx(
                    'hidden lg:flex px-[12px] h-[44px] rounded-[8px] border text-[13px] transition-colors items-center gap-[6px]',
                    sidebarOpen
                      ? 'border-[#2B5CD3] text-btnPrimaryAccent bg-[#2B5CD3]/10'
                      : 'border-newColColor text-textColor hover:bg-boxHover'
                  )}
                >
                  <FolderIcon />
                  <span>
                    {sidebarOpen ? t('hide_folders', 'Hide folders') : t('show_folders', 'Show folders')}
                  </span>
                </button>
              )}

              {/* Emptying the bin is a library task, not a picking one. */}
              {standalone && (
                <button
                  onClick={() => setShowTrash(!showTrash)}
                  className="px-[12px] h-[44px] rounded-[8px] border border-newColColor text-[13px] text-textColor hover:bg-boxHover transition-colors"
                >
                  🗑️ {t('trash', 'Trash')}
                </button>
              )}
            </div>
          </div>
        </div>

        <FolderBreadcrumb
          folders={foldersData || []}
          selectedFolderId={selectedFolderId}
          onSelect={handleFolderSelect}
        />

        <BulkToolbar
          selectedFiles={selectedFiles}
          onClearSelection={clearSelection}
          onRefresh={refresh}
          foldersData={foldersData || []}
        />

        <div className="flex-1 relative min-h-0">
          {isLoading ? (
            <LoadingComponent />
          ) : !data?.results?.length && !visibleFolders.length ? (
            <div className="flex flex-col items-center justify-center h-full gap-[15px] text-textColor/60">
              <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                <rect x="8" y="12" width="48" height="40" rx="6" stroke="currentColor" strokeWidth="2" strokeOpacity="0.3" />
                <circle cx="24" cy="28" r="4" stroke="currentColor" strokeWidth="2" strokeOpacity="0.3" />
                <path d="M8 44L22 32L34 44L44 34L56 44" stroke="currentColor" strokeWidth="2" strokeOpacity="0.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <div className="text-[16px] font-[500]">
                {debouncedSearch
                  ? t('no_media_matches_your_search', 'No media matches your search')
                  : t('this_folder_is_empty', 'This folder is empty')}
              </div>
            </div>
          ) : viewMode === 'grid' ? (
            <FileGrid
              files={data?.results || []}
              selectedFiles={selectedFiles}
              onToggleSelect={toggleFileSelection}
              onFileClick={handleFileClick}
              standalone={standalone}
              onSelect={onSelect}
              folders={visibleFolders}
              onFolderOpen={handleFolderSelect}
              folderDropProps={folderDropProps}
              isFolderOver={isFolderOver}
              onFileMenu={fileMenu.openAt}
              onFolderMenu={folderMenu.openAt}
            />
          ) : (
            <FileList
              files={data?.results || []}
              selectedFiles={selectedFiles}
              onToggleSelect={toggleFileSelection}
              onFileClick={handleFileClick}
              folders={visibleFolders}
              onFolderOpen={handleFolderSelect}
              folderDropProps={folderDropProps}
              isFolderOver={isFolderOver}
              onFileMenu={fileMenu.openAt}
              onFolderMenu={folderMenu.openAt}
              onRefresh={refresh}
              sortField={sortField}
              sortOrder={sortOrder}
              onSort={(field) => {
                if (sortField === field) {
                  setSortAndReset(field, sortOrder === 'asc' ? 'desc' : 'asc');
                } else {
                  setSortAndReset(field, 'asc');
                }
              }}
            />
          )}
        </div>

        {(pages || 0) > 1 && (
          <div className="flex items-center justify-center gap-[8px] mt-[15px]">
            <button
              disabled={page === 0}
              onClick={() => setPage(p => Math.max(0, p - 1))}
              className={clsx('p-[8px] rounded-[6px] border border-newColColor transition-all',
                page === 0 ? 'opacity-30 cursor-not-allowed' : 'hover:bg-boxHover text-textColor')}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            {Array.from({ length: Math.min(pages, 7) }, (_, i) => {
              let pageNum: number;
              if (pages <= 7) {
                pageNum = i;
              } else if (page < 3) {
                pageNum = i;
              } else if (page > pages - 4) {
                pageNum = pages - 7 + i;
              } else {
                pageNum = page - 3 + i;
              }
              return (
                <button
                  key={pageNum}
                  onClick={() => setPage(pageNum)}
                  className={clsx('w-[36px] h-[36px] rounded-[6px] text-[13px] font-medium transition-all',
                    page === pageNum
                      ? 'bg-[#2B5CD3] text-textColor'
                      : 'text-textColor hover:bg-boxHover border border-newColColor')}
                >
                  {pageNum + 1}
                </button>
              );
            })}
            <button
              disabled={page >= pages - 1}
              onClick={() => setPage(p => Math.min(pages - 1, p + 1))}
              className={clsx('p-[8px] rounded-[6px] border border-newColColor transition-all',
                page >= pages - 1 ? 'opacity-30 cursor-not-allowed' : 'hover:bg-boxHover text-textColor')}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
        )}
      </div>

      {/* Desktop details panel */}
      <div className="hidden lg:block">
        {detailsFile && (
          <FileDetailsPanel
            key={detailsFile.id}
            file={detailsFile}
            onClose={() => setDetailsFile(null)}
            onRefresh={refresh}
          />
        )}
      </div>

      {/* Mobile details drawer */}
      {detailsFile && (
        <div className="fixed inset-0 z-210 flex justify-end lg:hidden">
          <div
            role="button"
            tabIndex={0}
            aria-label={t('close_details_drawer', 'Close details drawer')}
            className="absolute inset-0 bg-black/50"
            onClick={() => setDetailsFile(null)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
                e.preventDefault();
                setDetailsFile(null);
              }
            }}
          />
          <div className="relative h-full w-[340px] max-w-[90vw] bg-newBgColor border-s border-studioBorder shadow-2xl flex flex-col">
            <FileDetailsPanel
              key={detailsFile.id}
              file={detailsFile}
              onClose={() => setDetailsFile(null)}
              onRefresh={refresh}
              drawerMode
            />
          </div>
        </div>
      )}

      {fileMenu.menu && (
        <ContextMenu
          x={fileMenu.menu.x}
          y={fileMenu.menu.y}
          items={fileMenuItems(fileMenu.menu.target)}
          onClose={fileMenu.close}
          ariaLabel={t('file_actions', 'File actions')}
        />
      )}

      {folderMenu.menu && (
        <ContextMenu
          x={folderMenu.menu.x}
          y={folderMenu.menu.y}
          items={folderMenuItems(folderMenu.menu.target)}
          onClose={folderMenu.close}
          ariaLabel={t('folder_actions', 'Folder actions')}
        />
      )}

      {showTrash && (
        <div
          role="button"
          tabIndex={0}
          aria-label={t('close_trash', 'Close trash')}
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-[20px]"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowTrash(false);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
              e.preventDefault();
              setShowTrash(false);
            }
          }}
        >
          <div className="bg-newBgColorInner rounded-[12px] w-full max-w-4xl max-h-[80vh] overflow-auto p-[24px]">
            <TrashComponent onClose={() => setShowTrash(false)} />
          </div>
        </div>
      )}
    </div>
  );
};
