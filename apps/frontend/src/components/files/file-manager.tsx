'use client';

import React, { FC, useCallback, useEffect, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useDebounce } from 'use-debounce';
import { FolderTree } from '@gitroom/frontend/components/files/folder-tree';
import { FileGrid } from '@gitroom/frontend/components/files/file-grid';
import { FileList } from '@gitroom/frontend/components/files/file-list';
import { FileDetailsPanel } from '@gitroom/frontend/components/files/file-details-panel';
import { FilePreviewModal } from '@gitroom/frontend/components/files/file-preview-modal';
import { BulkToolbar } from '@gitroom/frontend/components/files/bulk-toolbar';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { FileUploader } from '@gitroom/frontend/components/files/file-uploader';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { TrashComponent } from '@gitroom/frontend/components/files/trash.component';
import clsx from 'clsx';
import { PageHeader } from '@gitroom/frontend/components/ui/page-header';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

type ViewMode = 'grid' | 'list';

const GridIcon: FC<{ className?: string }> = ({ className }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={className}>
    <rect x="1" y="1" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.5" />
    <rect x="9.5" y="1" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.5" />
    <rect x="1" y="9.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.5" />
    <rect x="9.5" y="9.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.5" />
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

export const FileManager: FC<{
  standalone?: boolean;
  onSelect?: (items: FileItem[]) => void;
  onFolderChange?: (folderId: string | null) => void;
  refreshKey?: number | string;
}> = ({
  standalone,
  onSelect,
  onFolderChange,
  refreshKey,
}) => {
  const fetch = useFetch();
  const t = useT();
  const modals = useModals();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [debouncedSearch] = useDebounce(search, 300);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<FileItem[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [sortField, setSortField] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');
  const [filterType, setFilterType] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [detailsFile, setDetailsFile] = useState<FileItem | null>(null);
  const [showTrash, setShowTrash] = useState(false);
  const [folderDrawerOpen, setFolderDrawerOpen] = useState(false);

  const setSearchAndReset = useCallback((value: string) => {
    setSearch(value);
    setPage(0);
  }, []);

  const setFilterTypeAndReset = useCallback((value: string) => {
    setFilterType(value);
    setPage(0);
  }, []);

  useEffect(() => {
    onFolderChange?.(selectedFolderId);
  }, [selectedFolderId, onFolderChange]);

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

  const { data: foldersData, mutate: mutateFolders } = useSWR(
    'files-folders',
    async () => (await fetch('/files/folders')).json()
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

  const handleFolderSelect = useCallback((folderId: string | null) => {
    setSelectedFolderId(folderId);
    setSelectedFiles([]);
    setDetailsFile(null);
    setPage(0);
  }, []);

  const refresh = useCallback(() => {
    mutate();
    mutateFolders();
  }, [mutate, mutateFolders]);

  const pages = data?.pages || 0;

  return (
    <div className="flex flex-1 h-full gap-[15px]">
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <FolderTree
          folders={foldersData || []}
          selectedFolderId={selectedFolderId}
          onSelectFolder={handleFolderSelect}
          onRefresh={mutateFolders}
          onFileMoved={refresh}
        />
      </div>

      {/* Mobile folder drawer */}
      <div
        aria-hidden={!folderDrawerOpen}
        className={clsx(
          'fixed inset-0 z-[210] flex justify-start lg:hidden',
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
        <PageHeader
          title={t('media_library', 'Media Library')}
          description={t('manage_your_images_videos_and_files', 'Manage your images, videos, and files')}
          action={
            <FileUploader
              folderId={selectedFolderId}
              onUploadComplete={refresh}
              variant="header"
            />
          }
        />
        <div className="flex flex-wrap items-center gap-[12px] mb-[15px]">
          <div className="flex flex-1 items-center gap-[8px] min-w-0 mobile:flex-none mobile:w-full">
            <div className="flex-1 relative min-w-0">
              <input
                type="text"
                value={search}
                onChange={e => setSearchAndReset(e.target.value)}
                placeholder={t('search_files_by_name_tags', 'Search files by name, tags...')}
                className="w-full h-[44px] pl-[40px] pr-[14px] rounded-[8px] bg-newBgColorInner border border-newColColor text-[14px] outline-none focus:border-[#2B5CD3] text-textColor"
              />
              <svg
                className="absolute left-[12px] top-[50%] -translate-y-[50%] text-newTextColor/60"
                width="16" height="16" viewBox="0 0 16 16" fill="none"
              >
                <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M10 10L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>

            <select
              value={filterType}
              aria-label={t('filter_by_file_type', 'Filter by file type')}
              onChange={e => setFilterTypeAndReset(e.target.value)}
              className="h-[44px] px-[12px] rounded-[8px] bg-newBgColorInner border border-newColColor text-[13px] text-textColor outline-none focus:border-[#2B5CD3] shrink-0"
            >
              <option value="">{t('all_types', 'All types')}</option>
              <option value="image">{t('images', 'Images')}</option>
              <option value="video">{t('videos', 'Videos')}</option>
              <option value="audio">{t('audio', 'Audio')}</option>
              <option value="document">{t('documents', 'Documents')}</option>
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
              <button
                type="button"
                onClick={() => setFolderDrawerOpen(true)}
                className="lg:hidden px-[12px] h-[44px] rounded-[8px] border border-newColColor text-[13px] text-textColor hover:bg-boxHover transition-colors flex items-center gap-[6px]"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                <span>{t('folder', 'Folder')}</span>
              </button>

              <button
                onClick={() => setShowTrash(!showTrash)}
                className="px-[12px] h-[44px] rounded-[8px] border border-newColColor text-[13px] text-textColor hover:bg-boxHover transition-colors"
              >
                🗑️ {t('trash', 'Trash')}
              </button>
            </div>
          </div>
        </div>

        <BulkToolbar
          selectedFiles={selectedFiles}
          onClearSelection={clearSelection}
          onRefresh={refresh}
          foldersData={foldersData || []}
        />

        <div className="flex-1 relative min-h-0">
          {isLoading ? (
            <LoadingComponent />
          ) : !data?.results?.length ? (
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
              files={data.results}
              selectedFiles={selectedFiles}
              onToggleSelect={toggleFileSelection}
              onFileClick={handleFileClick}
              standalone={standalone}
              onSelect={onSelect}
            />
          ) : (
            <FileList
              files={data.results}
              selectedFiles={selectedFiles}
              onToggleSelect={toggleFileSelection}
              onFileClick={handleFileClick}
              sortField={sortField}
              sortOrder={sortOrder}
              onSort={(field) => {
                if (sortField === field) {
                  setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
                } else {
                  setSortField(field);
                  setSortOrder('asc');
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
        <div className="fixed inset-0 z-[210] flex justify-end lg:hidden">
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
