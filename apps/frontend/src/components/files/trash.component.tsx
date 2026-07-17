'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useMediaDirectory } from '@gitroom/react/helpers/use.media.directory';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const TrashThumb: React.FC<{ src: string; alt: string }> = ({ src, alt }) => {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const img = ref.current;
    if (!img) return;
    const onError = () => {
      img.style.display = 'none';
    };
    img.addEventListener('error', onError);
    return () => img.removeEventListener('error', onError);
  }, [src]);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img ref={ref} src={src} alt={alt} className="w-full h-full object-cover" />
  );
};

export const TrashComponent: React.FC<{ onClose?: () => void }> = ({ onClose }) => {
  const fetch = useFetch();
  const toast = useToaster();
  const mediaDirectory = useMediaDirectory();
  const t = useT();
  const [trashedMedia, setTrashedMedia] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadTrash = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/files/trash');
      if (res.ok) {
        const data = await res.json();
        setTrashedMedia(data || []);
      } else {
        toast.show(t('failed_to_load_trash', 'Failed to load trash'), 'warning');
      }
    } catch {
      toast.show(t('failed_to_load_trash', 'Failed to load trash'), 'warning');
    } finally {
      setLoading(false);
    }
  }, [fetch, toast]);

  useEffect(() => {
    loadTrash();
  }, [loadTrash]);

  const handleRestore = async (id: string) => {
    try {
      const res = await fetch(`/files/${id}/restore`, { method: 'POST' });
      if (res.ok) {
        setTrashedMedia((prev) => prev.filter((m) => m.id !== id));
        toast.show(t('media_restored_successfully', 'Media restored successfully'), 'success');
      } else {
        toast.show(t('failed_to_restore_media', 'Failed to restore media'), 'warning');
      }
    } catch {
      toast.show(t('failed_to_restore_media', 'Failed to restore media'), 'warning');
    }
  };

  const handlePermanentDelete = async (id: string) => {
    const confirmed = await deleteDialog(
      t('permanently_delete_this_media_confirm', 'Permanently delete this media? This action cannot be undone.'),
      t('permanently_delete', 'Permanently Delete'),
      t('delete', 'Delete')
    );
    if (!confirmed) return;

    try {
      const res = await fetch(`/files/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setTrashedMedia((prev) => prev.filter((m) => m.id !== id));
        toast.show(t('media_permanently_deleted', 'Media permanently deleted'), 'success');
      } else {
        toast.show(t('failed_to_delete_media', 'Failed to delete media'), 'warning');
      }
    } catch {
      toast.show(t('failed_to_delete_media', 'Failed to delete media'), 'warning');
    }
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleString();
  };

  return (
    <div className="flex flex-col gap-[20px]">
      <div className="flex items-center justify-between">
        <h3 className="text-[18px] text-textColor font-semibold">{t('trash', 'Trash')}</h3>
        {onClose && (
          <button
            onClick={onClose}
            className="text-newTableText hover:text-textColor transition-colors"
          >
            ✕
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-[14px] text-newTableText">{t('loading_trash', 'Loading trash...')}</div>
      ) : trashedMedia.length === 0 ? (
        <div className="text-[14px] text-newTableText text-center py-[40px]">
          {t('your_trash_is_empty', 'Your trash is empty.')}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-[16px]">
          {trashedMedia.map((media) => (
            <div
              key={media.id}
              className="rounded-[8px] bg-btnSimple overflow-hidden border border-newTableBorder"
            >
              {media.path && (
                <div className="aspect-square bg-newTableHeader flex items-center justify-center">
                  <TrashThumb
                    src={mediaDirectory.set(media.path)}
                    alt={media.name}
                  />
                </div>
              )}
              <div className="p-[12px]">
                <div className="text-[13px] text-textColor font-medium truncate mb-[4px]">
                  {media.name}
                </div>
                <div className="text-[11px] text-newTableText mb-[8px]">
                  {t('deleted_date', 'Deleted: {{date}}', { date: formatDate(media.deletedAt) })}
                </div>
                <div className="flex gap-[8px]">
                  <button
                    onClick={() => handleRestore(media.id)}
                    className="flex-1 px-[8px] py-[6px] rounded-[8px] bg-btnPrimary text-white text-[12px] font-medium hover:bg-btnPrimary/80 transition-colors"
                  >
                    {t('restore', 'Restore')}
                  </button>
                  <button
                    onClick={() => handlePermanentDelete(media.id)}
                    className="flex-1 px-[8px] py-[6px] rounded-[8px] bg-red-600 text-white text-[12px] font-medium hover:bg-red-700 transition-colors"
                  >
                    {t('delete', 'Delete')}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
