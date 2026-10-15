'use client';

import React, { FC, useCallback, useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import clsx from 'clsx';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { ContextMenu } from '@postmill-ai/frontend/components/ui/context-menu';
import { useContextMenu } from '@postmill-ai/frontend/components/ui/use-context-menu';
import { useFolderDropTarget } from '@postmill-ai/frontend/components/files/folder.utils';
import {
  UNFILED_FOLDER_KEY,
  findTemplateFolder,
  type FolderSelection,
  type TemplateFolder,
} from './template-folders';

export const useTemplateFolders = (orgId: string | undefined) => {
  const fetch = useFetch();
  return useSWR(
    orgId ? `design-template-folders-${orgId}` : null,
    async () => {
      const res = await fetch('/media/design-templates/folders');
      if (!res.ok) throw new Error('Failed to load template folders');
      return res.json() as Promise<TemplateFolder[]>;
    },
    { keepPreviousData: true }
  );
};

/**
 * Folder tree for the templates panel — the DesignTemplateFolder counterpart of
 * the Files library's FolderTree, minus storage-provider mounting (template
 * folders have no color/provider). One GET returns the whole tree; the panel
 * filters templates client-side. Drop targets accept dragged template cards
 * (template id as text/plain) and call the move endpoint; the "Unfiled" row is
 * the null-folder target.
 */
export const TemplateFolderTree: FC<{
  folders: TemplateFolder[];
  unfiledCount: number;
  selection: FolderSelection;
  onSelect: (selection: FolderSelection) => void;
  onRefresh: () => void;
  onTemplateMoved: () => void;
}> = ({ folders, unfiledCount, selection, onSelect, onRefresh, onTemplateMoved }) => {
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [newFolderParent, setNewFolderParent] = useState<string | null | undefined>(undefined);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState('');
  const { menu, openAt: openMenu, close: closeMenu } = useContextMenu<string>();

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreateFolder = useCallback(async (parentId: string | null) => {
    if (!newFolderName.trim()) return;
    await fetch('/media/design-templates/folders', {
      method: 'POST',
      body: JSON.stringify({ name: newFolderName.trim(), parentId }),
    });
    setNewFolderName('');
    setNewFolderParent(undefined);
    onRefresh();
    toaster.show(t('folder_created', 'Folder created'), 'success');
  }, [newFolderName, fetch, onRefresh, toaster, t]);

  const handleRename = useCallback(async (id: string) => {
    if (!renamingName.trim()) return;
    await fetch(`/media/design-templates/folders/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name: renamingName.trim() }),
    });
    setRenamingId(null);
    setRenamingName('');
    onRefresh();
  }, [renamingName, fetch, onRefresh]);

  const handleDelete = useCallback(async (id: string) => {
    const res = await fetch(`/media/design-templates/folders/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const text = await res.text();
      toaster.show(text || t('cannot_delete_non_empty_folder', 'Cannot delete non-empty folder'), 'warning');
    } else {
      toaster.show(t('folder_deleted', 'Folder deleted'), 'success');
      if (selection === id) onSelect(null);
    }
    onRefresh();
  }, [fetch, onRefresh, toaster, selection, onSelect, t]);

  const moveTemplate = useCallback(async (templateId: string, targetFolderId: string | null) => {
    const res = await fetch(`/media/design-templates/${templateId}/move`, {
      method: 'PUT',
      body: JSON.stringify({ folderId: targetFolderId }),
    });

    if (!res.ok) {
      toaster.show(t('template_folder_move_failed', 'Failed to move template'), 'warning');
      return;
    }

    toaster.show(t('template_folder_moved', 'Template moved'), 'success');
    onRefresh();
    onTemplateMoved();
  }, [fetch, onRefresh, onTemplateMoved, toaster, t]);

  const { dropProps, isOver } = useFolderDropTarget(moveTemplate);

  const renderFolder = (folder: TemplateFolder, depth: number = 0) => {
    const isCollapsed = collapsed.has(folder.id);
    const isSelected = selection === folder.id;
    const isDragOver = isOver(folder.id);
    const hasChildren = folder.children && folder.children.length > 0;

    return (
      <div key={folder.id}>
        <div
          role="button"
          tabIndex={0}
          aria-pressed={isSelected}
          className={clsx(
            'flex items-center gap-[6px] px-[8px] py-[5px] rounded-[6px] cursor-pointer transition-all text-[12px]',
            isSelected
              ? 'bg-btnPrimary/20 text-textColor'
              : isDragOver
                ? 'bg-btnPrimary/30 text-textColor'
                : 'text-textColor hover:bg-boxHover'
          )}
          onClick={() => onSelect(folder.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelect(folder.id);
            }
          }}
          onContextMenu={(e) => openMenu(e, folder.id)}
          {...dropProps(folder.id)}
          style={{ paddingInlineStart: `${12 + depth * 16}px` }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); toggleCollapse(folder.id); }}
            aria-label={isCollapsed ? t('expand', 'Expand') : t('collapse', 'Collapse')}
            className={clsx('w-[14px] h-[14px] flex items-center justify-center transition-transform', hasChildren ? 'visible' : 'invisible')}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className={clsx('transition-transform', isCollapsed ? '' : 'rotate-90')}>
              <path d="M3 1L7 5L3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0">
            <path d="M2 4.5C2 3.39543 2.89543 2.5 4 2.5H5.93934C6.46977 2.5 6.97848 2.71071 7.35355 3.08579L8 3.73223C8.18935 3.92156 8.44705 4.02708 8.71573 4.02708H12C13.1046 4.02708 14 4.92251 14 6.02708V11.5C14 12.6046 13.1046 13.5 12 13.5H4C2.89543 13.5 2 12.6046 2 11.5V4.5Z"
              fill={isSelected ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.3" />
          </svg>

          {renamingId === folder.id ? (
            <AutoFocusInput
              value={renamingName}
              onChange={(e) => setRenamingName(e.target.value)}
              onBlur={() => handleRename(folder.id)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleRename(folder.id); if (e.key === 'Escape') setRenamingId(null); }}
              className="flex-1 bg-transparent border-b border-btnPrimary text-textColor text-[12px] outline-hidden"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="flex-1 truncate">{folder.name}</span>
          )}

          <span className="text-[10px] text-newTextColor/60">{folder._count?.templates || 0}</span>
        </div>

        {hasChildren && !isCollapsed && (
          <div>
            {folder.children.map((child) => renderFolder(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col rounded-lg border border-studioBorder bg-newBgColorInner overflow-hidden">
      <div className="flex items-center justify-between px-[10px] py-[8px] border-b border-studioBorder">
        <div className="text-[12px] font-[600] text-textColor">{t('folders', 'Folders')}</div>
        <button
          onClick={() => { setNewFolderParent(null); setNewFolderName(''); }}
          aria-label={t('new_folder', 'New folder')}
          className="p-[3px] rounded-[4px] text-newTextColor/60 hover:text-textColor hover:bg-boxHover transition-all"
        >
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M7 1V13M1 7H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>
      </div>

      <div className="max-h-[180px] overflow-y-auto scrollbar py-[4px]">
        <div
          role="button"
          tabIndex={0}
          aria-pressed={selection === null}
          onClick={() => onSelect(null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelect(null);
            }
          }}
          className={clsx(
            'flex items-center gap-[6px] px-[12px] py-[5px] cursor-pointer text-[12px] transition-all',
            selection === null
              ? 'bg-btnPrimary/20 text-textColor'
              : 'text-textColor hover:bg-boxHover'
          )}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0">
            <rect x="1" y="2" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.3" />
            <path d="M1 6H15" stroke="currentColor" strokeWidth="1.3" />
          </svg>
          <span className="flex-1 truncate">{t('template_folder_all', 'All templates')}</span>
        </div>

        {folders.map((folder) => renderFolder(folder))}

        {newFolderParent !== undefined && (
          <div className="flex items-center gap-[6px] px-[12px] py-[5px]">
            <AutoFocusInput
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onBlur={() => handleCreateFolder(newFolderParent)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateFolder(newFolderParent);
                if (e.key === 'Escape') { setNewFolderParent(undefined); setNewFolderName(''); }
              }}
              placeholder={t('folder_name_placeholder', 'Folder name...')}
              className="flex-1 bg-transparent border-b border-btnPrimary text-textColor text-[12px] outline-hidden placeholder:text-newTextColor/30"
            />
          </div>
        )}

        <div
          role="button"
          tabIndex={0}
          aria-pressed={selection === UNFILED_FOLDER_KEY}
          onClick={() => onSelect(UNFILED_FOLDER_KEY)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelect(UNFILED_FOLDER_KEY);
            }
          }}
          {...dropProps(null)}
          className={clsx(
            'flex items-center gap-[6px] px-[12px] py-[5px] cursor-pointer text-[12px] transition-all',
            selection === UNFILED_FOLDER_KEY
              ? 'bg-btnPrimary/20 text-textColor'
              : isOver(null)
                ? 'bg-btnPrimary/30 text-textColor'
                : 'text-textColor hover:bg-boxHover'
          )}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0">
            <path d="M2 4.5C2 3.39543 2.89543 2.5 4 2.5H5.93934C6.46977 2.5 6.97848 2.71071 7.35355 3.08579L8 3.73223C8.18935 3.92156 8.44705 4.02708 8.71573 4.02708H12C13.1046 4.02708 14 4.92251 14 6.02708V11.5C14 12.6046 13.1046 13.5 12 13.5H4C2.89543 13.5 2 12.6046 2 11.5V4.5Z"
              fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2.5 2" />
          </svg>
          <span className="flex-1 truncate">{t('template_folder_unfiled', 'Unfiled')}</span>
          <span className="text-[10px] text-newTextColor/60">{unfiledCount}</span>
        </div>
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={closeMenu}
          ariaLabel={t('folder_actions', 'Folder actions')}
          items={[
            {
              label: t('rename', 'Rename'),
              onClick: () => {
                setRenamingId(menu.target);
                setRenamingName(findTemplateFolder(folders, menu.target)?.name || '');
              },
            },
            {
              label: t('new_subfolder', 'New Subfolder'),
              onClick: () => {
                setNewFolderParent(menu.target);
                setNewFolderName('');
              },
            },
            { divider: true },
            {
              label: t('delete', 'Delete'),
              onClick: () => handleDelete(menu.target),
              danger: true,
            },
          ]}
        />
      )}
    </div>
  );
};

function AutoFocusInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return <input ref={ref} {...props} />;
}
