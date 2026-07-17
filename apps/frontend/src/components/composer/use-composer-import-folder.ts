'use client';

import { useCallback, useRef } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';

interface Folder {
  id: string;
  name: string;
  parentId: string | null;
}

const ROOT_FOLDER_NAME = 'Composer imports';

/**
 * Returns a memoized find-or-create function for the dated
 * "Composer imports/YYYY-MM-DD" folder. Concurrent first calls are serialized
 * behind a single in-flight promise so two fast stock picks never create
 * duplicate dated folders.
 */
export const useComposerImportFolder = () => {
  const fetch = useFetch();
  const cacheRef = useRef<{
    key: string | null;
    promise: Promise<string> | null;
    folderId: string | null;
  }>({ key: null, promise: null, folderId: null });

  const findOrCreateFolder = useCallback(async (): Promise<string> => {
    const today = newDayjs().format('YYYY-MM-DD');
    const rootKey = `${ROOT_FOLDER_NAME}`;
    const dateKey = `${rootKey}/${today}`;

    // Return cached id if the same session already resolved it.
    if (cacheRef.current.key === dateKey && cacheRef.current.folderId) {
      return cacheRef.current.folderId;
    }

    // Serialize concurrent first resolution.
    if (cacheRef.current.key === dateKey && cacheRef.current.promise) {
      return cacheRef.current.promise;
    }

    cacheRef.current.key = dateKey;
    cacheRef.current.folderId = null;

    const run = async (): Promise<string> => {
      const folders: Folder[] = await (await fetch('/files/folders')).json();

      const root = folders.find((f) => f.name === ROOT_FOLDER_NAME && !f.parentId);
      let rootId = root?.id;

      if (!rootId) {
        const createRoot = await fetch('/files/folders', {
          method: 'POST',
          body: JSON.stringify({ name: ROOT_FOLDER_NAME, parentId: null }),
        });
        if (!createRoot.ok) {
          throw new Error(`Failed to create ${ROOT_FOLDER_NAME} folder`);
        }
        const rootJson = await createRoot.json();
        rootId = rootJson.id;
      }

      const dated = folders.find(
        (f) => f.name === today && f.parentId === rootId
      );
      let datedId = dated?.id;

      if (!datedId) {
        // Re-fetch folders after root creation in case the dated folder
        // already exists under the newly-created root.
        const freshFolders: Folder[] = await (
          await fetch('/files/folders')
        ).json();
        const freshDated = freshFolders.find(
          (f) => f.name === today && f.parentId === rootId
        );
        datedId = freshDated?.id;

        if (!datedId) {
          const createDated = await fetch('/files/folders', {
            method: 'POST',
            body: JSON.stringify({ name: today, parentId: rootId }),
          });
          if (!createDated.ok) {
            throw new Error(`Failed to create ${today} folder`);
          }
          const datedJson = await createDated.json();
          datedId = datedJson.id;
        }
      }

      cacheRef.current.folderId = datedId;
      cacheRef.current.promise = null;
      return datedId;
    };

    const promise = run();
    cacheRef.current.promise = promise;

    try {
      return await promise;
    } catch (err) {
      // Reset on error so the next pick can retry.
      cacheRef.current.promise = null;
      cacheRef.current.folderId = null;
      throw err;
    }
  }, [fetch]);

  return findOrCreateFolder;
};
