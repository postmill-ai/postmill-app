'use client';

import React, { FC, useCallback, useRef, useState } from 'react';
import clsx from 'clsx';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUppyUploader } from '@gitroom/frontend/components/files/new.uploader';
import { Dashboard } from '@uppy/react';
import { PlusIcon } from '@gitroom/frontend/components/ui/icons';
import { UPLOAD_ALLOWED_MIME_TYPES } from '@gitroom/helpers/upload-limits.client';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export const FileUploader: FC<{
  folderId: string | null;
  onUploadComplete: () => void;
  variant?: 'default' | 'header';
}> = ({ folderId, onUploadComplete, variant = 'default' }) => {
  const uploaderRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const t = useT();

  const uppy = useUppyUploader({
    folderId,
    allowedFileTypes: Array.from(UPLOAD_ALLOWED_MIME_TYPES).join(','),
    onUploadSuccess: async () => {
      onUploadComplete();
    },
    onStart: () => setLoading(true),
    onEnd: () => setLoading(false),
  });

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setLoading(true);

    for (const file of files) {
      uppy.addFile(file);
    }

    if (e.target) e.target.value = '';
  }, [uppy]);

  const isHeader = variant === 'header';

  return (
    <div className={isHeader ? '' : 'mb-[10px]'}>
      <div className={clsx('flex items-center gap-[8px]', isHeader && 'flex-row-reverse')}>
        <button
          disabled={loading}
          onClick={() => uploaderRef.current?.click()}
          className={clsx(
            'relative cursor-pointer flex gap-[8px] h-[36px] px-[14px] justify-center items-center rounded-[8px] text-[13px] transition-all',
            isHeader
              ? 'bg-[#2B5CD3] text-white hover:opacity-90'
              : 'bg-btnSimple text-textColor hover:bg-boxHover'
          )}
        >
          {loading ? (
            <div className="w-[14px] h-[14px] border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <PlusIcon size={14} />
          )}
          <span className={loading ? 'invisible' : ''}>{t('upload', 'Upload')}</span>
        </button>
        <input
          ref={uploaderRef}
          type="file"
          onChange={handleFileSelect}
          className="hidden"
          multiple
        />
        <div className="flex-1 h-[36px] relative overflow-hidden uppyChange">
          <div className="absolute left-0 top-0 w-full h-full">
            <Dashboard
              uppy={uppy}
              id="file-manager-uploader"
              showProgressDetails
              hideUploadButton
              hideRetryButton
              hidePauseResumeButton
              hideCancelButton
              hideProgressAfterFinish
              height={36}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
