'use client';

import React, { useCallback, useRef, useState } from 'react';

/** Shape returned by `GET /files/folders` (a full nested tree, name-asc). */
export type FolderItem = {
  id: string;
  name: string;
  color: string | null;
  tags?: string | null;
  description?: string | null;
  parentId: string | null;
  children: FolderItem[];
  _count: { files: number; children: number };
  storageProviderId?: string | null;
  storageProvider?: { id: string; type: string; name: string } | null;
};

export function findFolder(folders: FolderItem[], id: string): FolderItem | null {
  for (const f of folders) {
    if (f.id === id) return f;
    if (f.children) {
      const found = findFolder(f.children, id);
      if (found) return found;
    }
  }
  return null;
}

/** Flattens the tree into a depth-tagged list, for pickers and select menus. */
export function collectFolders(
  items: FolderItem[],
  depth = 0
): { id: string; name: string; depth: number }[] {
  const result: { id: string; name: string; depth: number }[] = [];
  for (const item of items) {
    result.push({ id: item.id, name: item.name, depth });
    if (item.children) result.push(...collectFolders(item.children, depth + 1));
  }
  return result;
}

/**
 * Direct children of the selected folder — or the tree roots at "All Files".
 * The full tree is already fetched for the sidebar, so the browse area needs no
 * extra request to show its subfolders.
 */
export function childrenOf(
  folders: FolderItem[],
  selectedFolderId: string | null
): FolderItem[] {
  if (!selectedFolderId) return folders;
  return findFolder(folders, selectedFolderId)?.children ?? [];
}

/**
 * Drop-target wiring shared by the sidebar tree, folder tiles and folder rows.
 * File tiles set the dragged file id as `text/plain`; dropping calls
 * `PUT /files/:id/move`.
 *
 * `dragenter`/`dragleave` fire for every descendant, so a per-target counter is
 * needed to know when the pointer has genuinely left.
 */
export function useFolderDropTarget(onDropFile: (fileId: string, folderId: string | null) => void) {
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null | undefined>(undefined);
  const counters = useRef<Map<string, number>>(new Map());

  const key = (folderId: string | null) => folderId || '__all__';

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDragEnter = useCallback((folderId: string | null) => {
    const k = key(folderId);
    counters.current.set(k, (counters.current.get(k) || 0) + 1);
    setDragOverFolderId(folderId);
  }, []);

  const onDragLeave = useCallback((folderId: string | null) => {
    const k = key(folderId);
    const count = (counters.current.get(k) || 0) - 1;
    if (count <= 0) {
      counters.current.delete(k);
      setDragOverFolderId((prev) => (prev === folderId ? undefined : prev));
    } else {
      counters.current.set(k, count);
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent, folderId: string | null) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOverFolderId(undefined);
      counters.current.delete(key(folderId));

      const fileId = e.dataTransfer.getData('text/plain');
      if (!fileId) return;
      onDropFile(fileId, folderId);
    },
    [onDropFile]
  );

  /** Spread onto a drop target; `isOver` drives the highlight. */
  const dropProps = useCallback(
    (folderId: string | null) => ({
      onDragOver,
      onDragEnter: () => onDragEnter(folderId),
      onDragLeave: () => onDragLeave(folderId),
      onDrop: (e: React.DragEvent) => onDrop(e, folderId),
    }),
    [onDragOver, onDragEnter, onDragLeave, onDrop]
  );

  const isOver = useCallback(
    (folderId: string | null) => dragOverFolderId !== undefined && dragOverFolderId === folderId,
    [dragOverFolderId]
  );

  return { dropProps, isOver };
}
