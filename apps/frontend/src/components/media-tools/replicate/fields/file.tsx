'use client';

import React, { useMemo } from 'react';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { MediaSelectorModal } from '@gitroom/frontend/components/media-tools/media-selector-modal';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

function mediaTypeNoun(t: (key: string, fallback: string) => string, type: string): string {
  switch (type) {
    case 'image':
      return t('media_noun_image', 'image');
    case 'video':
      return t('media_noun_video', 'video');
    case 'audio':
      return t('media_noun_audio', 'audio');
    default:
      return type;
  }
}

export interface FileValue {
  fileId?: string;
  url?: string;
  type?: 'image' | 'video' | 'audio';
}

interface FileInputProps {
  value?: FileValue | string;
  onChange: (value: FileValue | undefined) => void;
  label?: string;
  required?: boolean;
  acceptType?: 'image' | 'video' | 'audio';
}

export function FileInput({ value, onChange, label, required, acceptType = 'image' }: FileInputProps) {
  const t = useT();
  const modals = useModals();
  const toaster = useToaster();

  const selected = useMemo<FileValue | undefined>(() => {
    if (!value) return undefined;
    if (typeof value === 'string') return { url: value };
    return value;
  }, [value]);

  const display = selected?.url || selected?.fileId;

  const handleChooseFile = () => {
    modals.openModal({
      title: t('select_x_file', 'Select {{type}} file', { type: mediaTypeNoun(t, acceptType) }),
      removeLayout: true,
      children: (close) => (
        <MediaSelectorModal
          open
          onClose={close}
          kinds={[acceptType]}
          onSelect={(item) => {
            if (item.type !== acceptType) {
              toaster.show(
                t('please_choose_x_file', 'Please choose a {{type}} file', {
                  type: mediaTypeNoun(t, acceptType),
                }),
                'warning'
              );
              return;
            }
            onChange({
              fileId: item.fileId,
              url: item.url,
              type: item.type,
            });
            close();
          }}
        />
      ),
    });
  };

  const handleClear = () => {
    onChange(undefined);
  };

  return (
    <div className="mb-3">
      {label && (
        <label className="block text-xs text-newTextColor/70 mb-1">
          {label}
          {required && <span className="text-dangerText ml-1">*</span>}
        </label>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleChooseFile}
          className="flex-1 px-3 py-2 rounded-lg border border-studioBorder bg-newBgColorInner text-newTextColor text-sm text-left hover:bg-boxHover transition-colors"
        >
          {display ? (
            <span className="truncate block">{display}</span>
          ) : (
            t('choose_x_file_ellipsis', 'Choose {{type}} file...', { type: mediaTypeNoun(t, acceptType) })
          )}
        </button>
        {display && (
          <button
            type="button"
            onClick={handleClear}
            className="px-2 py-2 rounded-lg text-newTextColor/60 hover:text-dangerText transition-colors"
            aria-label={t('clear_file', 'Clear file')}
          >
            ✕
          </button>
        )}
      </div>
      {selected?.url && acceptType === 'image' && (
        // eslint-disable-next-line @next/next/no-img-element -- external media preview
        <img src={selected.url} alt={t('preview', 'Preview')} className="mt-2 w-full max-h-32 object-cover rounded-lg" />
      )}
    </div>
  );
}
