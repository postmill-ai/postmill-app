'use client';

import React, { FC, useRef, useState } from 'react';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useMediaDirectory } from '@postmill-ai/react/helpers/use.media.directory';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { Button } from '@postmill-ai/react/form/button';
import { readErrorMessage } from '@postmill-ai/frontend/components/media-tools/designer/read-error-message';
import type { FileItem } from './file-manager';

export const VideoPosterControls: FC<{
  file: FileItem;
  onUpdated: (thumbnail: string) => void;
}> = ({ file, onUpdated }) => {
  const fetch = useFetch();
  const mediaDirectory = useMediaDirectory();
  const toaster = useToaster();
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const upload = async (image: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', image);
      if (file.folderId) form.append('folderId', file.folderId);
      const uploaded = await fetch('/files/upload-simple', { method: 'POST', body: form });
      if (!uploaded.ok) {
        toaster.show(
          await readErrorMessage(uploaded, t('poster_upload_failed', 'Thumbnail upload failed')),
          'warning'
        );
        return;
      }
      const data = await uploaded.json() as { path?: string };
      if (!data.path) throw new Error('Missing uploaded thumbnail path');

      const saved = await fetch('/files/information', {
        method: 'POST',
        body: JSON.stringify({
          id: file.id,
          alt: file.alt || '',
          thumbnail: data.path,
          thumbnailTimestamp: file.thumbnailTimestamp ?? 0,
        }),
      });
      if (!saved.ok) {
        toaster.show(
          await readErrorMessage(saved, t('poster_save_failed', 'Failed to save thumbnail')),
          'warning'
        );
        return;
      }
      onUpdated(data.path);
      toaster.show(t('poster_updated', 'Thumbnail updated'), 'success');
    } catch {
      toaster.show(t('poster_save_failed', 'Failed to save thumbnail'), 'warning');
    } finally {
      setUploading(false);
    }
  };

  return (
    <section className="flex flex-col gap-[10px] rounded-[8px] border border-newTableBorder p-[12px]" aria-label={t('video_thumbnail', 'Video thumbnail')}>
      <div>
        <div className="text-[13px] font-[500] text-textColor">{t('video_thumbnail', 'Video thumbnail')}</div>
        <div className="text-[11px] text-newTableText">{t('video_thumbnail_description', 'Used in Files and video previews.')}</div>
      </div>
      <div className="flex items-center gap-[12px] flex-wrap">
        {file.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element -- dynamic stored poster
          <img
            src={mediaDirectory.set(file.thumbnail)}
            alt={t('current_video_thumbnail', 'Current video thumbnail')}
            className="w-[72px] h-[72px] rounded-[6px] border border-newTableBorder object-cover"
          />
        ) : (
          <div className="w-[72px] h-[72px] rounded-[6px] border border-newTableBorder bg-newBgColor flex items-center justify-center text-center text-[10px] text-newTableText">
            {t('no_custom_thumbnail', 'No custom thumbnail')}
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          aria-label={t('upload_custom_thumbnail', 'Upload custom thumbnail')}
          disabled={uploading}
          onChange={async (event) => {
            const image = event.target.files?.[0];
            if (image) await upload(image);
            event.target.value = '';
          }}
        />
        <Button
          secondary
          loading={uploading}
          onClick={() => inputRef.current?.click()}
          className="px-[12px] h-[36px] text-[12px]"
        >
          {uploading
            ? t('uploading_ellipsis', 'Uploading…')
            : t('upload_custom_thumbnail', 'Upload custom thumbnail')}
        </Button>
      </div>
    </section>
  );
};
