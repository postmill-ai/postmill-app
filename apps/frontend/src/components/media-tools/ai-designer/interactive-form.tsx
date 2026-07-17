'use client';

import React, { useMemo, useState } from 'react';
import { Button } from '@gitroom/react/form/button';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  MediaSelectorModal,
  type MediaSelectorItem,
} from '@gitroom/frontend/components/media-tools/media-selector-modal';
import { useImportStockMedia } from './ai-designer.hooks';
import type { FormField } from '@gitroom/nestjs-libraries/ai-designer/ai-designer.types';

/** Slimmed media-pick value submitted to the server. */
type MediaValue = Pick<
  MediaSelectorItem,
  'fileId' | 'url' | 'type' | 'name' | 'stockSource' | 'attribution' | 'downloadLocation'
>;

interface InteractiveFormProps {
  prompt: string;
  fields: FormField[];
  replyTo: string;
  submitLabel?: string;
  onSubmit: (replyTo: string, values: Record<string, unknown>) => void;
}

export const InteractiveForm: React.FC<InteractiveFormProps> = ({
  prompt,
  fields,
  replyTo,
  submitLabel,
  onSubmit,
}) => {
  const t = useT();
  const resolvedSubmitLabel = submitLabel ?? t('submit', 'Submit');
  const initialValues = useMemo(() => {
    const map: Record<string, unknown> = {};
    for (const field of fields) {
      if (field.type === 'checkbox') {
        map[field.name] = [];
      } else if (field.type === 'number') {
        map[field.name] = '';
      } else {
        map[field.name] = '';
      }
    }
    return map;
  }, [fields]);

  const [values, setValues] = useState<Record<string, unknown>>(initialValues);
  const [mediaPickField, setMediaPickField] = useState<string | null>(null);
  const [mediaImporting, setMediaImporting] = useState(false);
  const toaster = useToaster();
  const importStockMedia = useImportStockMedia();

  const setValue = (name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  };

  const toggleCheckbox = (name: string, optionValue: string) => {
    setValues((prev) => {
      const current = Array.isArray(prev[name]) ? (prev[name] as string[]) : [];
      const next = current.includes(optionValue)
        ? current.filter((v) => v !== optionValue)
        : [...current, optionValue];
      return { ...prev, [name]: next };
    });
  };

  // The form shape carries no per-field required flag, so the lightweight
  // rule is: a form with fields needs at least one answered field before it
  // can be submitted (a field-less confirm form stays submittable).
  const canSubmit =
    fields.length === 0 ||
    fields.some((field) => {
      const v = values[field.name];
      if (Array.isArray(v)) return v.length > 0;
      if (typeof v === 'string') return v.trim().length > 0;
      return v !== undefined && v !== null && v !== '';
    });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit(replyTo, values);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <p className="text-[14px] text-textColor">{prompt}</p>
      {fields.map((field) => (
        <div key={field.name} className="flex flex-col gap-1.5">
          <label htmlFor={field.name} className="text-[13px] font-medium text-textColor">
            {field.label}
          </label>

          {field.type === 'text' && (
            <input
              id={field.name}
              type="text"
              value={(values[field.name] as string) || ''}
              placeholder={field.placeholder}
              onChange={(e) => setValue(field.name, e.target.value)}
              className="h-[40px] rounded-lg border border-studioBorder bg-newBgColorInner px-3 text-[14px] text-textColor outline-none focus:border-designerAccent"
            />
          )}

          {field.type === 'number' && (
            <input
              id={field.name}
              type="number"
              value={
                values[field.name] === '' || values[field.name] == null
                  ? ''
                  : String(values[field.name])
              }
              placeholder={field.placeholder}
              onChange={(e) =>
                setValue(
                  field.name,
                  e.target.value === '' ? '' : Number(e.target.value)
                )
              }
              className="h-[40px] rounded-lg border border-studioBorder bg-newBgColorInner px-3 text-[14px] text-textColor outline-none focus:border-designerAccent"
            />
          )}

          {field.type === 'color' && (
            <div className="flex items-center gap-2">
              <input
                id={field.name}
                type="color"
                value={(values[field.name] as string) || '#000000'}
                onChange={(e) => setValue(field.name, e.target.value)}
                className="w-[48px] h-[40px] rounded-lg border border-studioBorder bg-transparent cursor-pointer"
              />
              <span className="text-[13px] text-textColor/70">
                {(values[field.name] as string) || '#000000'}
              </span>
            </div>
          )}

          {field.type === 'select' && (
            <select
              id={field.name}
              value={(values[field.name] as string) || ''}
              onChange={(e) => setValue(field.name, e.target.value)}
              className="h-[40px] rounded-lg border border-studioBorder bg-newBgColorInner px-3 text-[14px] text-textColor outline-none focus:border-designerAccent"
            >
              <option value="">{t('select_ellipsis', 'Select…')}</option>
              {field.options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}

          {(field.type === 'radio' || field.type === 'checkbox') && (
            <div className="flex flex-col gap-1.5">
              {field.options.map((opt) => {
                const isCheckbox = field.type === 'checkbox';
                const checked = isCheckbox
                  ? Array.isArray(values[field.name]) &&
                    (values[field.name] as string[]).includes(opt.value)
                  : values[field.name] === opt.value;
                const optionId = `${field.name}-${opt.value}`;
                return (
                  <label
                    key={opt.value}
                    htmlFor={optionId}
                    className="flex items-center gap-2 text-[13px] text-textColor cursor-pointer"
                  >
                    <input
                      id={optionId}
                      type={isCheckbox ? 'checkbox' : 'radio'}
                      name={field.name}
                      value={opt.value}
                      checked={checked}
                      onChange={() =>
                        isCheckbox
                          ? toggleCheckbox(field.name, opt.value)
                          : setValue(field.name, opt.value)
                      }
                      className="accent-designerAccent"
                    />
                    {opt.label}
                  </label>
                );
              })}
            </div>
          )}

          {field.type === 'media-pick' && (
            <div>
              <button
                type="button"
                onClick={() => setMediaPickField(field.name)}
                disabled={mediaImporting}
                className="px-3 py-2 rounded-lg border border-studioBorder bg-newBgColorInner text-[13px] text-textColor hover:border-designerAccent transition-colors disabled:opacity-60"
              >
                {mediaImporting
                  ? t('importing_ellipsis', 'Importing…')
                  : values[field.name]
                    ? t('change_media', 'Change media')
                    : t('pick_media', 'Pick media')}
              </button>
              {values[field.name] && (
                <div className="mt-2 text-[12px] text-textColor/70">
                  {t('selected_name', 'Selected: {{name}}', {
                    name:
                      (values[field.name] as MediaValue).name ||
                      t('media_fallback_name', 'media'),
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={!canSubmit || mediaImporting}>
          {resolvedSubmitLabel}
        </Button>
      </div>

      {mediaPickField && (
        <MediaSelectorModal
          open
          onClose={() => setMediaPickField(null)}
          kinds={['image']}
          onSelect={async (item) => {
            setMediaPickField(null);
            setMediaImporting(true);
            try {
              const imported = await importStockMedia(item);
              // Ship only what the server consumes — never the whole selector
              // item (thumbnails, …) over the socket. Keep stock metadata so
              // the backend can record attribution when present.
              const value: MediaValue = {
                fileId: imported.fileId,
                url: imported.url,
                type: imported.type,
                name: imported.name,
                stockSource: imported.stockSource,
                attribution: imported.attribution,
                downloadLocation: imported.downloadLocation,
              };
              setValue(mediaPickField, value);
            } catch (e) {
              toaster.show(
                (e as Error).message || t('failed_to_import_media', 'Failed to import media'),
                'warning'
              );
            } finally {
              setMediaImporting(false);
            }
          }}
        />
      )}
    </form>
  );
};
