'use client';

import { FC, useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useMediaDirectory } from '@gitroom/react/helpers/use.media.directory';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';
import { useModals, areYouSure } from '@gitroom/frontend/components/layout/new-modal';
import { Button } from '@gitroom/react/form/button';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
import dayjs from 'dayjs';
import { Composer } from '@gitroom/frontend/components/composer/composer';
import { useLaunchStore } from '@gitroom/frontend/components/composer/store';
import { Integrations } from '@gitroom/frontend/components/launches/calendar.context';
import { CloseModalButton } from '@gitroom/frontend/components/shared/close-modal-button';
import {
  FilePreviewModal,
} from '@gitroom/frontend/components/files/file-preview-modal';
import type { FileItem } from '@gitroom/frontend/components/files/file-manager';
import { useCampaignFiles } from '@gitroom/frontend/components/campaigns/hooks/campaign.hooks';
import { UploadFilesModal } from '@gitroom/frontend/components/campaigns/dashboard/upload-files-modal';

const formatDate = (d: string, format: string) => {
  try {
    return dayjs(d).format(format);
  } catch {
    return '';
  }
};

const fileSize = (bytes: number, t: (key: string, fallback: string, vars?: Record<string, any>) => string) => {
  if (!bytes) return '';
  if (bytes < 1024) return t('file_size_bytes', '{{size}} B', { size: bytes });
  if (bytes < 1024 * 1024)
    return t('file_size_kb', '{{size}} KB', { size: (bytes / 1024).toFixed(0) });
  return t('file_size_mb', '{{size}} MB', { size: (bytes / (1024 * 1024)).toFixed(1) });
};

const FileTile: FC<{
  file: FileItem;
  onOpen: () => void;
  onRemove: () => void;
  removing: boolean;
  t: (key: string, fallback: string) => string;
}> = ({ file, onOpen, onRemove, removing, t }) => {
  const mediaDirectory = useMediaDirectory();
  const [broken, setBroken] = useState(false);
  const isVideo = hasExtension(file.path, 'mp4', 'mov', 'webm');
  const isAudio = hasExtension(file.path, 'mp3', 'wav', 'ogg', 'm4a');
  // Prefer a still thumbnail (works as a video poster too); fall back to the
  // raw image path for images, and to the <video> first frame for videos.
  const thumb = file.thumbnail
    ? mediaDirectory.set(file.thumbnail)
    : !isVideo && !isAudio
    ? mediaDirectory.set(file.path)
    : '';
  const thumbRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const img = thumbRef.current;
    if (!img) return;
    const onError = () => setBroken(true);
    img.addEventListener('error', onError);
    return () => img.removeEventListener('error', onError);
  }, [thumb]);

  return (
    <div className="group relative rounded-[8px] border border-newTableBorder bg-newBgColorInner overflow-hidden hover:border-btnPrimary/50 transition-colors">
      <button
        type="button"
        onClick={onOpen}
        className="block w-full text-left"
        aria-label={file.originalName || file.name}
      >
        <div className="w-full aspect-square overflow-hidden bg-newBgColor flex items-center justify-center text-newTableText">
          {isAudio ? (
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          ) : thumb && !broken ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={thumbRef}
              src={thumb}
              alt={file.alt || file.name}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : isVideo && !broken ? (
            <video
              src={mediaDirectory.set(file.path)}
              className="w-full h-full object-cover"
              muted
              preload="metadata"
              aria-label={file.alt || file.name}
            />
          ) : (
            // Graceful placeholder for a missing/unrenderable source.
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="9" cy="9" r="2" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          )}
        </div>
        <div className="px-[8px] py-[6px]">
          <div
            className="text-[12px] text-textColor truncate"
            title={file.originalName || file.name}
          >
            {file.originalName || file.name}
          </div>
          <div className="text-[10px] text-newTableText truncate">
            {formatDate(file.createdAt, t('campaign_file_date_format', 'MMM D, YYYY'))}
            {file.fileSize ? ` · ${fileSize(file.fileSize, t)}` : ''}
          </div>
        </div>
      </button>
      <button
        type="button"
        disabled={removing}
        onClick={onRemove}
        aria-label={t('remove_from_campaign', 'Remove from campaign')}
        className="absolute top-[6px] end-[6px] w-[22px] h-[22px] rounded-full bg-black/60 text-white text-[13px] flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-red-500 transition-all disabled:opacity-40"
      >
        ×
      </button>
    </div>
  );
};

// Dedicated Files section — the campaign's tagged files rendered /files-style
// (thumbnails + details), with a preview modal that can open the file in a new
// post draft or in the Designer.
export const CampaignFilesSection: FC<{
  campaignId: string;
  onMutate: () => void;
}> = ({ campaignId, onMutate }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const modal = useModals();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const { data: files, isLoading, mutate: mutateFiles } = useCampaignFiles(campaignId);

  const { data: integrations } = useSWR<Integrations[]>(
    '/integrations/list',
    async () => {
      const r = await fetch('/integrations/list');
      if (!r.ok) throw new Error(t('failed_to_load_channels', 'Failed to load channels'));
      return (await r.json()).integrations;
    },
    { revalidateOnFocus: false }
  );

  const refresh = useCallback(() => {
    mutateFiles();
    onMutate();
  }, [mutateFiles, onMutate]);

  const remove = useCallback(
    async (fileId: string) => {
      if (removingId) return;
      setRemovingId(fileId);
      try {
        const r = await fetch(`/campaigns/${campaignId}/items/file/${fileId}`, {
          method: 'DELETE',
        });
        if (!r.ok) throw new Error();
        toaster.show(t('item_untagged', 'File removed'), 'success');
        refresh();
      } catch {
        toaster.show(t('failed_to_untag_item', 'Failed to remove file'), 'warning');
      } finally {
        setRemovingId(null);
      }
    },
    [campaignId, fetch, refresh, removingId, t, toaster]
  );

  // Danger action from the preview: confirm, then untag from the campaign.
  // `remove` refreshes the grid (and dashboard count) on success.
  const confirmRemoveFromCampaign = useCallback(
    async (file: FileItem) => {
      const ok = await areYouSure({
        title: t('remove_from_campaign', 'Remove from campaign'),
        description: t(
          'remove_file_from_campaign_desc',
          'This removes the file from this campaign. It stays in your media library.'
        ),
        approveLabel: t('remove', 'Remove'),
        cancelLabel: t('cancel', 'Cancel'),
      });
      if (!ok) return;
      modal.closeAll(); // close the preview
      await remove(file.id);
    },
    [remove, modal, t]
  );

  // Open the composer on a fresh draft with this file preloaded, scoped to the
  // campaign (mirrors tagged-items-panels' openTemplate handoff).
  const openNewPostDraft = useCallback(
    (file: FileItem) => {
      useLaunchStore.getState().setCampaignId(campaignId);
      const close = () => {
        useLaunchStore.getState().setCampaignId(null);
        modal.closeAll();
      };
      modal.openModal({
        withCloseButton: false,
        fullScreen: true,
        removeLayout: true,
        size: '100%',
        height: '100%',
        children: (
          <div className="relative w-full h-full">
            <CloseModalButton onClick={close} />
            <Composer
              date={newDayjs()}
              integrations={integrations || []}
              allIntegrations={integrations || []}
              onlyValues={[
                { content: '', id: 'new', image: [{ id: file.id, path: file.path }] },
              ]}
              reopenModal={() => undefined}
              mutate={onMutate}
              customClose={close}
              padding="p-0"
            />
          </div>
        ),
      });
    },
    [campaignId, integrations, modal, onMutate]
  );

  const openPreview = useCallback(
    (file: FileItem) => {
      modal.openModal({
        title: '',
        closeOnClickOutside: true,
        closeOnEscape: true,
        withCloseButton: true,
        // Responsive + centered; never wider than the viewport (was overflowing
        // on mobile). size + height together enable the manager's centering.
        size: 'min(760px, calc(100vw - 24px))',
        height: 'auto',
        children: (
          <FilePreviewModal
            file={file}
            onNewPostDraft={openNewPostDraft}
            onRemoveFromCampaign={confirmRemoveFromCampaign}
          />
        ),
      });
    },
    [modal, openNewPostDraft, confirmRemoveFromCampaign]
  );

  const openUploadModal = useCallback(() => {
    modal.openModal({
      title: t('upload_files', 'Upload files'),
      withCloseButton: true,
      // size + height center the modal; maxSize keeps it responsive on mobile.
      size: '760px',
      maxSize: 'calc(100vw - 24px)',
      height: 'auto',
      children: (
        <UploadFilesModal campaignId={campaignId} onUploaded={refresh} />
      ),
    });
  }, [campaignId, modal, refresh, t]);

  const count = files?.length ?? 0;

  return (
    <div className="p-[16px] border border-newTableBorder rounded-[12px] bg-newBgColor">
      <div className="flex items-center justify-between mb-[12px]">
        <div className="flex items-center gap-[8px]">
          <h3 className="text-[16px] font-semibold text-textColor">{t('files', 'Files')}</h3>
          {count > 0 && (
            <span className="text-[12px] text-newTableText">({count})</span>
          )}
        </div>
        <Button onClick={openUploadModal} className="!h-[32px] !px-[12px] text-[13px]">
          {t('upload', 'Upload')}
        </Button>
      </div>

      {isLoading ? (
        <div className="text-[13px] text-newTableText text-center py-[24px]">
          {t('loading', 'Loading')}
        </div>
      ) : count === 0 ? (
        <div className="text-[13px] text-newTableText text-center py-[24px]">
          {t('no_tagged_files', 'No files yet. Click Upload to add files to this campaign.')}
        </div>
      ) : (
        <div
          className={clsx(
            'grid gap-[8px]',
            'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6'
          )}
        >
          {files!.map((file) => (
            <FileTile
              key={file.id}
              file={file}
              onOpen={() => openPreview(file)}
              onRemove={() => remove(file.id)}
              removing={removingId === file.id}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default CampaignFilesSection;
