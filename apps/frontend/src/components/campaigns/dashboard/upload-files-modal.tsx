'use client';

import React, { FC, useCallback, useRef, useState } from 'react';
import useSWR from 'swr';
import clsx from 'clsx';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { FolderTree } from '@gitroom/frontend/components/files/folder-tree';

// Bulk file upload for the campaign Files tab. Mirrors the Designer's
// MediaSelectorModal "My Files" upload: the real /files FolderTree as the
// path picker (create/rename/delete folders) on the left, and a drag-and-drop /
// click drop zone that POSTs each file to /files/upload-simple with the
// selected `folderId` (the "set upload path"). Each uploaded file is then
// tagged onto the campaign so it surfaces in the Files section (which only
// renders campaign-tagged files).

type UploadRow = {
  key: string;
  name: string;
  status: 'uploading' | 'done' | 'error';
};

// Matches the /files library uploader's accepted types.
const ACCEPTED_TYPES = 'image/*,video/mp4,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.zip';

export const UploadFilesModal: FC<{
  campaignId: string;
  onUploaded: () => void;
}> = ({ campaignId, onUploaded }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const { closeCurrent } = useModals();
  const [folderId, setFolderId] = useState<string | null>(null);
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: folders, mutate: mutateFolders } = useSWR(
    'files-folders',
    async () => {
      const r = await fetch('/files/folders');
      if (!r.ok) return [];
      return r.json();
    },
    { revalidateOnFocus: false }
  );

  const tagFile = useCallback(
    async (fileId: string) => {
      const r = await fetch(`/campaigns/${campaignId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityType: 'file', entityId: fileId }),
      });
      return r.ok;
    },
    [campaignId, fetch]
  );

  const upload = useCallback(
    async (fileList: FileList | null) => {
      const files = fileList ? Array.from(fileList) : [];
      if (files.length === 0) return;
      setBusy(true);
      let anyTagged = false;
      let anyFailed = false;

      for (const file of files) {
        const key = `${file.name}-${file.size}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;
        setRows((prev) => [...prev, { key, name: file.name, status: 'uploading' }]);
        try {
          const formData = new FormData();
          formData.append('file', file);
          if (folderId) formData.append('folderId', folderId);
          const res = await fetch('/files/upload-simple', {
            method: 'POST',
            body: formData,
          });
          if (!res.ok) throw new Error('upload failed');
          const uploaded = (await res.json()) as { id?: string };
          const tagged = uploaded?.id ? await tagFile(uploaded.id) : false;
          if (tagged) anyTagged = true;
          else anyFailed = true;
          setRows((prev) =>
            prev.map((r) =>
              r.key === key ? { ...r, status: tagged ? 'done' : 'error' } : r
            )
          );
        } catch {
          anyFailed = true;
          setRows((prev) =>
            prev.map((r) => (r.key === key ? { ...r, status: 'error' } : r))
          );
        }
      }

      setBusy(false);
      setDragOver(false);
      if (inputRef.current) inputRef.current.value = '';
      if (anyTagged) {
        onUploaded();
        toaster.show(t('files_uploaded', 'Files uploaded'), 'success');
      }
      // Auto-close once the batch is done — but keep the modal open on any
      // failure so the failed rows stay visible for a retry.
      if (anyTagged && !anyFailed) {
        closeCurrent();
      }
    },
    [folderId, fetch, tagFile, onUploaded, toaster, t, closeCurrent]
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      upload(e.dataTransfer.files);
    },
    [upload]
  );

  return (
    <div className="flex flex-col gap-[16px] w-full">
      <div className="flex flex-col sm:flex-row gap-[16px] h-[440px] sm:h-[400px] max-h-[75vh]">
        {/* Path picker — the real /files folder tree (create/rename/delete).
            Stacks above the uploader on mobile with a bounded, scrollable height. */}
        <div className="flex shrink-0 h-[180px] sm:h-auto">
          <FolderTree
            folders={folders || []}
            selectedFolderId={folderId}
            onSelectFolder={setFolderId}
            onRefresh={mutateFolders}
          />
        </div>

        <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-[12px]">
          <div
            role="button"
            tabIndex={0}
            aria-label={t('drop_files_here', 'Drop files here or click to upload')}
            onDrop={onDrop}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOver(false);
            }}
            onClick={() => !busy && inputRef.current?.click()}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && !busy) {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            className={clsx(
              'relative flex flex-col items-center justify-center gap-[8px] rounded-[10px] border-2 border-dashed px-[16px] py-[28px] text-center cursor-pointer transition-colors shrink-0',
              dragOver
                ? 'border-btnPrimary bg-btnPrimary/10'
                : 'border-newTableBorder bg-newBgColorInner hover:border-btnPrimary/60',
              busy && 'opacity-60 cursor-not-allowed'
            )}
          >
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACCEPTED_TYPES}
              className="hidden"
              onChange={(e) => upload(e.target.files)}
              disabled={busy}
            />
            {busy ? (
              <>
                <div className="w-[20px] h-[20px] border-2 border-textColor border-t-transparent rounded-full animate-spin" />
                <span className="text-[14px] text-textColor">
                  {t('uploading', 'Uploading…')}
                </span>
              </>
            ) : (
              <>
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  className="text-newTableText"
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
                <span className="text-[14px] text-textColor">
                  {t('drop_files_here', 'Drop files here or click to upload')}
                </span>
                <span className="text-[12px] text-newTableText">
                  {folderId
                    ? t('uploading_to_selected_folder', 'Uploading to the selected folder')
                    : t('uploading_to_all_files', 'Uploading to All Files')}
                </span>
              </>
            )}
          </div>

          {rows.length > 0 && (
            <div className="flex-1 min-h-0 flex flex-col gap-[6px] overflow-y-auto">
              {rows.map((row) => (
                <div
                  key={row.key}
                  className="flex items-center gap-[8px] px-[12px] py-[8px] rounded-[8px] bg-newBgColorInner border border-newTableBorder"
                >
                  <span className="text-[13px] text-textColor truncate flex-1">
                    {row.name}
                  </span>
                  {row.status === 'uploading' && (
                    <div className="w-[14px] h-[14px] border-2 border-textColor border-t-transparent rounded-full animate-spin shrink-0" />
                  )}
                  {row.status === 'done' && (
                    <span className="text-[12px] text-green-500 shrink-0">
                      {t('attached', 'Attached')}
                    </span>
                  )}
                  {row.status === 'error' && (
                    <span className="text-[12px] text-dangerText shrink-0">
                      {t('failed', 'Failed')}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default UploadFilesModal;
