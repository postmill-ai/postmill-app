'use client';

import React, { FC, useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useMediaDirectory } from '@gitroom/react/helpers/use.media.directory';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';
import { useToaster } from '@gitroom/react/toaster/toaster';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import type { FileItem } from './file-manager';

const loadDims = (src: string) =>
  new Promise<{ width?: number; height?: number }>((resolve) => {
    if (!src) return resolve({});
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({});
    img.src = src;
  });

type FolderItem = {
  id: string;
  name: string;
  color: string | null;
  parentId: string | null;
  children: FolderItem[];
  _count: { files: number; children: number };
};

export const BulkToolbar: FC<{
  selectedFiles: FileItem[];
  onClearSelection: () => void;
  onRefresh: () => void;
  foldersData: FolderItem[];
}> = ({ selectedFiles, onClearSelection, onRefresh, foldersData }) => {
  const fetch = useFetch();
  const router = useRouter();
  const mediaDirectory = useMediaDirectory();
  const toaster = useToaster();
  const t = useT();
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [targetFolderId, setTargetFolderId] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  // Open all selected images/videos together on one Designer canvas as elements.
  // The list is too long for the query string, so hand it off via sessionStorage.
  const handleOpenAllInDesigner = useCallback(async () => {
    const designable = selectedFiles.filter((f) => {
      const isVideo = hasExtension(f.path, 'mp4', 'mov', 'webm');
      const isImage = hasExtension(
        f.path, 'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'bmp'
      );
      // A video needs a poster image to place on the canvas (Konva can't draw a raw video).
      if (isVideo) return !!f.thumbnail;
      return isImage;
    });
    if (designable.length === 0) {
      toaster.show(t('select_images_or_videos_to_open_in_designer', 'Select images or videos to open in the Designer'), 'warning');
      return;
    }
    if (designable.length < selectedFiles.length) {
      toaster.show(
        t(
          'opening_count_of_total_skipped_audio_documents',
          'Opening {{designable}} of {{total}} (skipped audio/documents)',
          { designable: designable.length, total: selectedFiles.length }
        ),
        'success'
      );
    }
    setOpening(true);
    try {
      const assets = await Promise.all(
        designable.map(async (f) => {
          const isVideo = hasExtension(f.path, 'mp4', 'mov', 'webm');
          const thumb = f.thumbnail ? mediaDirectory.set(f.thumbnail) : undefined;
          const displaySrc = isVideo ? thumb || '' : mediaDirectory.set(f.path);
          const dims = await loadDims(displaySrc);
          return {
            url: mediaDirectory.set(f.path),
            type: isVideo ? ('video' as const) : ('photo' as const),
            thumbUrl: isVideo ? thumb : undefined,
            naturalWidth: dims.width,
            naturalHeight: dims.height,
            source: 'files',
          };
        })
      );
      window.sessionStorage.setItem('designer:bulk-assets', JSON.stringify(assets));
      router.push('/media/designer?bulk=1');
    } finally {
      setOpening(false);
    }
  }, [selectedFiles, mediaDirectory, router, toaster]);

  const handleBulkDelete = useCallback(async () => {
    if (selectedFiles.length === 0) return;
    await fetch('/files/bulk/delete', {
      method: 'POST',
      body: JSON.stringify({ ids: selectedFiles.map(f => f.id) }),
    });
    onClearSelection();
    onRefresh();
    toaster.show(t('files_deleted_count', '{{count}} files deleted', { count: selectedFiles.length }), 'success');
  }, [selectedFiles, fetch, onClearSelection, onRefresh, toaster]);

  const handleBulkMove = useCallback(async () => {
    if (selectedFiles.length === 0) return;
    await fetch('/files/bulk/move', {
      method: 'POST',
      body: JSON.stringify({
        ids: selectedFiles.map(f => f.id),
        folderId: targetFolderId,
      }),
    });
    setShowMoveDialog(false);
    onClearSelection();
    onRefresh();
    toaster.show(t('files_moved_count', '{{count}} files moved', { count: selectedFiles.length }), 'success');
  }, [selectedFiles, targetFolderId, fetch, onClearSelection, onRefresh, toaster]);

  const collectFolders = (items: FolderItem[], depth = 0): { id: string; name: string; depth: number }[] => {
    const result: { id: string; name: string; depth: number }[] = [];
    for (const item of items) {
      result.push({ id: item.id, name: item.name, depth });
      if (item.children) result.push(...collectFolders(item.children, depth + 1));
    }
    return result;
  };

  if (selectedFiles.length === 0) return null;

  return (
    <div className="flex items-center gap-[8px] px-[12px] py-[8px] mb-[10px] bg-[#2B5CD3]/10 rounded-[8px] border border-[#2B5CD3]/20">
      <div className="text-[13px] text-textColor font-[500]">
        {t('selected_files_count', '{{count}} selected', { count: selectedFiles.length })}
      </div>
      <div className="flex-1" />
      <button
        onClick={handleOpenAllInDesigner}
        disabled={opening}
        className="px-[12px] py-[6px] rounded-[6px] text-[12px] text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 transition-all flex items-center gap-[6px]"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
        {opening ? t('opening_ellipsis', 'Opening…') : t('open_all_in_designer', 'Open all in Designer')}
      </button>
      <button
        onClick={() => setShowMoveDialog(true)}
        className="px-[12px] py-[6px] rounded-[6px] text-[12px] text-textColor border border-newColColor hover:bg-boxHover transition-all"
      >
        {t('move_to_folder', 'Move to Folder')}
      </button>
      <button
        onClick={handleBulkDelete}
        className="px-[12px] py-[6px] rounded-[6px] text-[12px] text-dangerText border border-newColColor hover:bg-boxHover transition-all"
      >
        {t('delete', 'Delete')}
      </button>
      <button
        onClick={onClearSelection}
        className="px-[12px] py-[6px] rounded-[6px] text-[12px] text-textColor/60 hover:text-textColor transition-all"
      >
        {t('clear', 'Clear')}
      </button>

      {showMoveDialog && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50"
          role="button"
          tabIndex={0}
          aria-label={t('close_move_dialog', 'Close move dialog')}
          onClick={(e) => { if (e.target === e.currentTarget) setShowMoveDialog(false); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') setShowMoveDialog(false); }}
        >
          <div className="bg-newBgColorInner border border-newBorder rounded-[12px] p-[20px] min-w-[300px] shadow-menu">
            <div className="text-[14px] font-[600] text-textColor mb-[12px]">{t('move_to_folder', 'Move to Folder')}</div>
            <div className="space-y-[4px] max-h-[250px] overflow-y-auto scrollbar scrollbar-thumb-newColColor">
              <button
                onClick={() => setTargetFolderId(null)}
                className={clsx(
                  'w-full text-left px-[10px] py-[6px] rounded-[6px] text-[13px] transition-all',
                  targetFolderId === null ? 'bg-[#2B5CD3]/20 text-textColor' : 'text-textColor hover:bg-boxHover'
                )}
              >
                {t('root_no_folder', 'Root (no folder)')}
              </button>
              {collectFolders(foldersData).map((f) => (
                <button
                  key={f.id}
                  onClick={() => setTargetFolderId(f.id)}
                  className={clsx(
                    'w-full text-left px-[10px] py-[6px] rounded-[6px] text-[13px] transition-all',
                    targetFolderId === f.id ? 'bg-[#2B5CD3]/20 text-textColor' : 'text-textColor hover:bg-boxHover'
                  )}
                  style={{ paddingLeft: `${10 + f.depth * 16}px` }}
                >
                  {f.name}
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-[8px] mt-[16px]">
              <button
                onClick={() => setShowMoveDialog(false)}
                className="px-[14px] py-[8px] rounded-[8px] text-[13px] text-textColor border border-newColColor hover:bg-boxHover transition-all"
              >
                {t('cancel', 'Cancel')}
              </button>
              <button
                onClick={handleBulkMove}
                className="px-[14px] py-[8px] rounded-[8px] text-[13px] text-white bg-[#2B5CD3] hover:bg-[#2B5CD3]/80 transition-all"
              >
                {t('move', 'Move')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

