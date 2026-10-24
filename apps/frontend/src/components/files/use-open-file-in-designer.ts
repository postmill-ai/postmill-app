'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useMediaDirectory } from '@postmill-ai/react/helpers/use.media.directory';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { openInDesigner } from '@postmill-ai/frontend/components/media-tools/open-in-designer';
import { readErrorMessage } from '@postmill-ai/frontend/components/media-tools/designer/read-error-message';
import type { FileItem } from './file-manager';
import { getFilePresentation } from './file-presentation';

export const useOpenFileInDesigner = () => {
  const fetch = useFetch();
  const router = useRouter();
  const mediaDirectory = useMediaDirectory();
  const toaster = useToaster();
  const t = useT();
  const [pendingFileId, setPendingFileId] = useState<string | null>(null);

  const openFile = useCallback(async (file: FileItem, onSuccess?: () => void) => {
    const presentation = getFilePresentation(file);
    if (!presentation.canOpenInDesigner || pendingFileId) return;

    if (!presentation.isDesign) {
      if (!presentation.mediaKind) return;
      onSuccess?.();
      openInDesigner(
        {
          operation: presentation.mediaKind,
          artifactUrl: mediaDirectory.set(file.path),
          fileId: file.id,
          source: 'files',
          thumbUrl: presentation.mediaKind === 'video' && file.thumbnail
            ? mediaDirectory.set(file.thumbnail)
            : undefined,
        },
        router.push
      );
      return;
    }

    setPendingFileId(file.id);
    try {
      const response = await fetch('/media/designs/import-library', {
        method: 'POST',
        body: JSON.stringify({ fileId: file.id }),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, t('failed_to_open_design', 'Failed to open design')));
      }
      const design = await response.json();
      if (!design?.id || typeof design.id !== 'string') {
        throw new Error(t('failed_to_open_design', 'Failed to open design'));
      }
      onSuccess?.();
      router.push(`/media/designer?designId=${encodeURIComponent(design.id)}`);
    } catch (error) {
      toaster.show(
        error instanceof Error && error.message
          ? error.message
          : t('failed_to_open_design', 'Failed to open design'),
        'warning'
      );
    } finally {
      setPendingFileId(null);
    }
  }, [fetch, mediaDirectory, pendingFileId, router, t, toaster]);

  return { openFile, pendingFileId };
};
