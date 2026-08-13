'use client';

import { FC } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { ancestorsOf, type FolderItem } from '@postmill-ai/frontend/components/files/folder.utils';

/**
 * Where you are in the folder tree, and a way back up. The root crumb is always
 * present so the row keeps its height at "All Files" instead of popping in.
 */
export const FolderBreadcrumb: FC<{
  folders: FolderItem[];
  selectedFolderId: string | null;
  onSelect: (folderId: string | null) => void;
}> = ({ folders, selectedFolderId, onSelect }) => {
  const t = useT();
  const trail = ancestorsOf(folders, selectedFolderId);

  const crumbs: { id: string | null; label: string }[] = [
    { id: null, label: t('all_files', 'All Files') },
    ...trail.map((folder) => ({ id: folder.id, label: folder.name })),
  ];

  return (
    <nav
      aria-label={t('folder_path', 'Folder path')}
      className="flex items-center gap-[6px] text-[13px] text-newTableText mb-[15px] flex-wrap"
    >
      {crumbs.map((crumb, index) => {
        const isLast = index === crumbs.length - 1;
        return (
          <span key={crumb.id ?? 'root'} className="flex items-center gap-[6px]">
            {index > 0 && (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="rtl:rotate-180">
                <path
                  d="M4.5 2.5L7.5 6L4.5 9.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
            {isLast ? (
              <span className="text-textColor" aria-current="page">
                {crumb.label}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onSelect(crumb.id)}
                className="hover:text-btnText transition-colors"
              >
                {crumb.label}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
};
