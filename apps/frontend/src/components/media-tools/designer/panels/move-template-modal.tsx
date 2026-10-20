'use client';

import React, { FC, useState } from 'react';
import clsx from 'clsx';
import { Button } from '@postmill-ai/react/form/button';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { collectTemplateFolders, type TemplateFolder } from './template-folders';

interface MoveTemplateModalProps {
  templateName: string;
  folders: TemplateFolder[];
  /** The folder the template is filed in today (null = Unfiled) — that row is
   *  disabled, since moving somewhere it already is would be a no-op. */
  currentFolderId?: string | null;
  /** Resolves true when the move succeeded — the caller then closes the modal. */
  onMove: (folderId: string | null) => Promise<boolean>;
  onCancel: () => void;
}

/**
 * Folder picker for "Move to folder…" on a template card: the whole tree
 * flattened depth-first (same order as the sidebar tree) plus the null-folder
 * "Unfiled" target. One click on a destination fires the move.
 */
export const MoveTemplateModal: FC<MoveTemplateModalProps> = ({
  templateName,
  folders,
  currentFolderId,
  onMove,
  onCancel,
}) => {
  const t = useT();
  const [moving, setMoving] = useState(false);
  const flat = collectTemplateFolders(folders);

  const pick = async (folderId: string | null) => {
    setMoving(true);
    try {
      await onMove(folderId);
    } finally {
      setMoving(false);
    }
  };

  const rowClass = (disabled: boolean) =>
    clsx(
      'flex items-center gap-[8px] w-full text-left px-[10px] py-[7px] rounded-[6px] text-[13px] transition-colors',
      disabled
        ? 'text-newTextColor/40 cursor-not-allowed'
        : 'text-textColor hover:bg-boxHover cursor-pointer'
    );

  return (
    <div className="flex flex-col gap-[10px] w-[360px] max-w-full">
      <div className="text-[12px] text-newTextColor/60">
        {t('templates_panel_move_hint', 'Choose where "{{name}}" should live', { name: templateName })}
      </div>
      <div className="max-h-[280px] overflow-y-auto scrollbar flex flex-col gap-[2px]">
        <button
          type="button"
          disabled={moving || !currentFolderId}
          onClick={() => pick(null)}
          className={rowClass(!currentFolderId)}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0">
            <path d="M2 4.5C2 3.39543 2.89543 2.5 4 2.5H5.93934C6.46977 2.5 6.97848 2.71071 7.35355 3.08579L8 3.73223C8.18935 3.92156 8.44705 4.02708 8.71573 4.02708H12C13.1046 4.02708 14 4.92251 14 6.02708V11.5C14 12.6046 13.1046 13.5 12 13.5H4C2.89543 13.5 2 12.6046 2 11.5V4.5Z"
              fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2.5 2" />
          </svg>
          <span className="flex-1 truncate">{t('template_folder_unfiled', 'Unfiled')}</span>
          {!currentFolderId && (
            <span className="text-[10px] text-newTextColor/40">{t('templates_panel_current_folder', 'Current')}</span>
          )}
        </button>
        {flat.map((folder) => (
          <button
            key={folder.id}
            type="button"
            disabled={moving || folder.id === currentFolderId}
            onClick={() => pick(folder.id)}
            className={rowClass(folder.id === currentFolderId)}
            style={{ paddingInlineStart: `${10 + folder.depth * 16}px` }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0">
              <path d="M2 4.5C2 3.39543 2.89543 2.5 4 2.5H5.93934C6.46977 2.5 6.97848 2.71071 7.35355 3.08579L8 3.73223C8.18935 3.92156 8.44705 4.02708 8.71573 4.02708H12C13.1046 4.02708 14 4.92251 14 6.02708V11.5C14 12.6046 13.1046 13.5 12 13.5H4C2.89543 13.5 2 12.6046 2 11.5V4.5Z"
                fill="none" stroke="currentColor" strokeWidth="1.3" />
            </svg>
            <span className="flex-1 truncate">{folder.name}</span>
            <span className="text-[10px] text-newTextColor/60">{folder.templateCount}</span>
            {folder.id === currentFolderId && (
              <span className="text-[10px] text-newTextColor/40">{t('templates_panel_current_folder', 'Current')}</span>
            )}
          </button>
        ))}
      </div>
      <div className="flex justify-end">
        <Button secondary onClick={onCancel}>
          {t('cancel', 'Cancel')}
        </Button>
      </div>
    </div>
  );
};
