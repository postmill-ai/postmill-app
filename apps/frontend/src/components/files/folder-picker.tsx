'use client';

import React, { FC, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { Button } from '@postmill-ai/react/form/button';
import { FolderTree } from '@postmill-ai/frontend/components/files/folder-tree';
import { findFolder, type FolderItem } from '@postmill-ai/frontend/components/files/folder.utils';

/**
 * Destination-folder picker over the shared `FolderTree`.
 *
 * `null` means the Files root. Shares the `files-folders` SWR key with the
 * campaign upload modal and the Files page, so opening this rarely costs a
 * request.
 */
export const useFolderList = () => {
  const fetch = useFetch();
  return useSWR<FolderItem[]>(
    'files-folders',
    async () => {
      const res = await fetch('/files/folders');
      return res.ok ? res.json() : [];
    },
    { revalidateOnFocus: false }
  );
};

/** Resolve a folder id to its display name; `null` → the root label. */
export const useFolderName = (folderId: string | null): string | null => {
  const { data } = useFolderList();
  if (!folderId) return null;
  return findFolder(data || [], folderId)?.name ?? null;
};

export const FolderPickerDialog: FC<{
  initialFolderId: string | null;
  onConfirm: (folderId: string | null) => void;
  onClose: () => void;
}> = ({ initialFolderId, onConfirm, onClose }) => {
  const t = useT();
  const { data: folders, mutate } = useFolderList();
  const [selected, setSelected] = useState<string | null>(initialFolderId);

  return (
    <div className="flex flex-col gap-[14px] w-[min(520px,80vw)]">
      <p className="text-[13px] text-newTableText">
        {t('folder_picker_hint', 'Pick where finished designs are saved.')}
      </p>
      <div className="h-[320px] rounded-[10px] border border-newTableBorder overflow-hidden flex">
        <FolderTree
          folders={folders || []}
          selectedFolderId={selected}
          onSelectFolder={setSelected}
          onRefresh={mutate}
          drawerMode
          showHeader
        />
      </div>
      <div className="flex items-center justify-end gap-[8px]">
        <Button secondary onClick={onClose}>
          {t('cancel', 'Cancel')}
        </Button>
        <Button
          onClick={() => {
            onConfirm(selected);
            onClose();
          }}
        >
          {t('choose_folder', 'Choose folder')}
        </Button>
      </div>
    </div>
  );
};
