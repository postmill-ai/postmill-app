'use client';

import React, { useMemo } from 'react';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { useMediaPicker } from '@postmill-ai/frontend/components/media-tools/use-media-picker';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useModals } from '@postmill-ai/frontend/components/layout/new-modal';
import { VoiceoverRecordDialog } from '@postmill-ai/frontend/components/media-tools/designer/voiceover-record-dialog';
import { readErrorMessage } from '@postmill-ai/frontend/components/media-tools/designer/read-error-message';

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
  value?: FileValue | string | Array<FileValue | string>;
  onChange: (value: FileValue | FileValue[] | undefined) => void;
  label?: string;
  help?: string;
  required?: boolean;
  acceptType?: 'image' | 'video' | 'audio';
  multiple?: boolean;
  maxFiles?: number;
}

export function FileInput(props: FileInputProps) {
  return props.multiple ? <MultiFileInput {...props} /> : <SingleFileInput {...props} />;
}

function MultiFileInput({
  value,
  onChange,
  label,
  help,
  required,
  acceptType = 'image',
  maxFiles = 3,
}: FileInputProps) {
  const t = useT();
  const toaster = useToaster();
  const selected = useMemo<FileValue[]>(
    () =>
      (Array.isArray(value) ? value : []).map((item) =>
        typeof item === 'string' ? { url: item } : item
      ),
    [value]
  );
  const picker = useMediaPicker({
    title: t('select_x_file', 'Select {{type}} file', { type: mediaTypeNoun(t, acceptType) }),
    kinds: [acceptType],
    multiple: true,
    requireFile: true,
    onConfirm: (items) => {
      if (items.some((item) => item.type !== acceptType)) {
        toaster.show(
          t('please_choose_x_file', 'Please choose a {{type}} file', {
            type: mediaTypeNoun(t, acceptType),
          }),
          'warning'
        );
        return;
      }
      if (items.length > maxFiles) {
        toaster.show(
          t('choose_up_to_x_files', 'Choose up to {{count}} files.', { count: maxFiles }),
          'warning'
        );
        return;
      }
      onChange(
        items.map((item) => ({ fileId: item.fileId, url: item.url, type: item.type }))
      );
    },
  });

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
          onClick={picker.open}
          className="flex-1 px-3 py-2 rounded-lg border border-studioBorder bg-newBgColorInner text-newTextColor text-sm text-left hover:bg-boxHover transition-colors"
        >
          {t('choose_x_files_ellipsis', 'Choose {{type}} files...', {
            type: mediaTypeNoun(t, acceptType),
          })}
        </button>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="px-2 py-2 rounded-lg text-newTextColor/60 hover:text-dangerText transition-colors"
            aria-label={t('clear_files', 'Clear files')}
          >
            ✕
          </button>
        )}
      </div>
      <div className="mt-1 text-[10px] text-newTextColor/65">
        {t('x_of_max_files_selected', '{{selected}} of {{max}} selected', {
          selected: selected.length,
          max: maxFiles,
        })}
      </div>
      {selected.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {selected.map((item, index) => (
            <li
              key={`${item.fileId || item.url}-${index}`}
              className="flex items-center gap-2 rounded-md bg-newBgColor/40 px-2 py-1 text-xs"
            >
              <span className="flex-1 truncate">{item.url || item.fileId}</span>
              <button
                type="button"
                onClick={() => onChange(selected.filter((_, itemIndex) => itemIndex !== index))}
                className="px-1 text-newTextColor/60 hover:text-dangerText transition-colors"
                aria-label={t('remove_file', 'Remove file')}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {help && <p className="text-[10px] text-newTextColor/65 mt-1">{help}</p>}
      {picker.element}
    </div>
  );
}

function SingleFileInput({ value, onChange, label, help, required, acceptType = 'image' }: FileInputProps) {
  const t = useT();
  const toaster = useToaster();
  const fetch = useFetch();
  const modals = useModals();

  // Title was invisible before: the old `openModal({ removeLayout: true })`
  // wrapper never renders one.
  const picker = useMediaPicker({
    title: t('select_x_file', 'Select {{type}} file', { type: mediaTypeNoun(t, acceptType) }),
    kinds: [acceptType],
    requireFile: true,
    onSelect: (item) => {
      if (item.type !== acceptType) {
        toaster.show(
          t('please_choose_x_file', 'Please choose a {{type}} file', {
            type: mediaTypeNoun(t, acceptType),
          }),
          'warning'
        );
        return;
      }
      onChange({ fileId: item.fileId, url: item.url, type: item.type });
    },
  });

  const selected = useMemo<FileValue | undefined>(() => {
    if (!value || Array.isArray(value)) return undefined;
    if (typeof value === 'string') return { url: value };
    return value;
  }, [value]);

  const display = selected?.url || selected?.fileId;

  const handleChooseFile = () => {
    picker.open();
  };

  const handleClear = () => {
    onChange(undefined);
  };

  // Voice-clone fields take a reference voice — let the user record one on the
  // spot instead of leaving for a recorder app. Audio fields only; the upload
  // is the same /files/upload-simple pattern the timeline's voiceover recorder
  // uses, and the backend resolves { fileId } inputs already.
  const mediaRecorderSupported = typeof MediaRecorder !== 'undefined';
  const handleRecord = () => {
    modals.openModal({
      children: (
        <VoiceoverRecordDialog
          title={t('record_voice_title', 'Record voice')}
          addLabel={t('use_recording', 'Use recording')}
          onClose={() => modals.closeAll()}
          onAdd={async (blob, mimeType) => {
            const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';
            const form = new FormData();
            form.append('file', blob, `voice-${Date.now()}.${ext}`);
            const uploadRes = await fetch('/files/upload-simple', { method: 'POST', body: form });
            if (!uploadRes.ok) {
              // Rethrow: the dialog stays open with the recording intact for a
              // retry (closing it would GC the MediaRecorder blob).
              throw new Error(
                await readErrorMessage(
                  uploadRes,
                  t('voice_recording_upload_failed', 'Could not upload the recording')
                )
              );
            }
            const uploaded = (await uploadRes.json()) as { id?: string; path?: string };
            onChange({ fileId: uploaded.id, url: uploaded.path, type: 'audio' });
          }}
        />
      ),
    });
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
        {acceptType === 'audio' && mediaRecorderSupported && (
          <button
            type="button"
            onClick={handleRecord}
            className="px-3 py-2 rounded-lg border border-studioBorder bg-newBgColorInner text-newTextColor text-sm hover:bg-boxHover transition-colors shrink-0"
          >
            {t('designer_start_recording', '● Record')}
          </button>
        )}
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
      {help && <p className="text-[10px] text-newTextColor/65 mt-1">{help}</p>}
      {picker.element}
    </div>
  );
}
