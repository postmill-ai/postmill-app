'use client';

import React, { FC } from 'react';
import { useRouter } from 'next/navigation';
import { useMediaDirectory } from '@gitroom/react/helpers/use.media.directory';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { AudioPlayer } from '@gitroom/frontend/components/media-tools/audio-player';
import { openInDesigner } from '@gitroom/frontend/components/media-tools/open-in-designer';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import i18next from '@gitroom/react/translation/i18next';
import type { FileItem } from './file-manager';

const fileSize = (bytes: number, t: ReturnType<typeof useT>) => {
  if (!bytes) return '-';
  if (bytes < 1024) return t('file_size_bytes', '{{size}} B', { size: bytes });
  if (bytes < 1024 * 1024)
    return t('file_size_kb', '{{size}} KB', { size: (bytes / 1024).toFixed(1) });
  return t('file_size_mb', '{{size}} MB', { size: (bytes / (1024 * 1024)).toFixed(1) });
};

export const FilePreviewModal: FC<{
  file: FileItem;
  onDetails?: (file: FileItem) => void;
  // Optional extra action (used by the campaign Files tab) — opens the composer
  // with this file preloaded. Not passed by the /files library, so unchanged there.
  onNewPostDraft?: (file: FileItem) => void;
  // Optional danger action (campaign Files tab) — untag the file from the
  // campaign. The caller handles confirmation. Not passed by /files.
  onRemoveFromCampaign?: (file: FileItem) => void;
}> = ({ file, onDetails, onNewPostDraft, onRemoveFromCampaign }) => {
  const router = useRouter();
  const modal = useModals();
  const mediaDirectory = useMediaDirectory();
  const t = useT();

  const url = mediaDirectory.set(file.path);
  const isVideo = hasExtension(file.path, 'mp4', 'mov', 'webm');
  const isAudio = hasExtension(file.path, 'mp3', 'wav', 'ogg', 'm4a');
  const isImage = hasExtension(file.path, 'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'bmp');
  const canDesign = isImage || isVideo || isAudio; // images/videos on canvas, audio on timeline

  const handleOpenInDesigner = () => {
    const operation = isVideo ? 'video' : isAudio ? 'audio' : 'image';
    const thumbUrl = isVideo && file.thumbnail ? mediaDirectory.set(file.thumbnail) : undefined;
    modal.closeAll();
    openInDesigner(
      {
        operation,
        artifactUrl: url,
        fileId: file.id,
        source: 'files',
        thumbUrl,
      },
      router.push
    );
  };

  return (
    <div className="flex flex-col gap-[15px] w-[760px] max-w-full text-textColor">
      <div className="text-[16px] font-[600] truncate">{file.name}</div>

      {isAudio ? (
        <div className="rounded-[8px] bg-newBgColorInner border border-newColColor p-[16px]">
          <AudioPlayer src={url} height={56} />
        </div>
      ) : (
        <div className="rounded-[8px] overflow-hidden bg-black/30 flex items-center justify-center max-h-[60vh]">
          {isVideo ? (
            <video controls src={url} className="w-full max-h-[60vh] object-contain">
              <track kind="captions" src="" label={t('no_captions', 'No captions')} default />
            </video>
          ) : (
            // User-uploaded previews come from dynamic storage URLs; next/image is
            // impractical without a configured loader/known domains, so a native img is used.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={file.alt || ''} className="w-full max-h-[60vh] object-contain" />
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-[10px] flex-wrap">
        <div className="text-[12px] text-newTextColor/65">
          {(file.type || t('file_type_file', 'file'))} · {fileSize(file.fileSize, t)}
        </div>
        <div className="flex items-center gap-[10px] flex-wrap">
          {onRemoveFromCampaign && (
            <button
              onClick={() => onRemoveFromCampaign(file)}
              className="px-[16px] py-[10px] rounded-[8px] border border-red-500/50 text-dangerText text-[13px] font-[500] hover:bg-red-500/10 transition-all"
            >
              {t('remove_from_campaign_button', 'Remove from campaign')}
            </button>
          )}
          {onDetails && (
            <button
              onClick={() => {
                modal.closeAll();
                onDetails(file);
              }}
              className="px-[16px] py-[10px] rounded-[8px] border border-newColColor text-textColor text-[13px] font-[500] hover:bg-boxHover transition-all"
            >
              {t('details', 'Details')}
            </button>
          )}
          <button
            onClick={() => window.open(url, '_blank')}
            className="px-[16px] py-[10px] rounded-[8px] border border-newColColor text-textColor text-[13px] font-[500] hover:bg-boxHover transition-all"
          >
            {t('download', 'Download')}
          </button>
          {onNewPostDraft && canDesign && (
            <button
              onClick={() => {
                modal.closeAll();
                onNewPostDraft(file);
              }}
              className="px-[16px] py-[10px] rounded-[8px] bg-btnPrimary text-white text-[13px] font-[500] hover:opacity-90 transition-all flex items-center gap-[6px]"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              {t('new_post_draft', 'New Post Draft')}
            </button>
          )}
          {canDesign && (
            <button
              onClick={handleOpenInDesigner}
              className="px-[16px] py-[10px] rounded-[8px] bg-green-600 text-white text-[13px] font-[500] hover:bg-green-700 transition-all flex items-center gap-[6px]"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
              {t('open_in_designer', 'Open in Designer')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
