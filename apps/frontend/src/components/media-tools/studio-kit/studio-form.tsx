'use client';

import React, { FC } from 'react';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { MediaSelectorModal } from '@gitroom/frontend/components/media-tools/media-selector-modal';
import { ModelSelect } from './model-select';
import { studioFieldKey, studioOptionKey } from './i18n-keys';
import type { FileFieldValue, StudioField, StudioFieldValue } from './types';

interface StudioFormProps {
  fields: StudioField[];
  values: Record<string, StudioFieldValue>;
  onChange: (name: string, value: StudioFieldValue) => void;
  provider: string;
  operation: string;
  // Studio namespace + tab key derive stable, collision-free i18n keys for the
  // descriptor's field/option text (§3.6). tabKey is required because multiple
  // tabs can share an `operation`.
  keyNs: string;
  tabKey: string;
}

const Label: FC<{ label?: string; required?: boolean }> = ({ label, required }) => {
  if (!label) return null;
  return (
    <label className="block text-[12px] text-newTextColor/70 mb-[6px]">
      {label}
      {required && <span className="text-amber-600 ml-[3px]">*</span>}
    </label>
  );
};

const inputClass =
  'w-full px-[12px] py-[9px] rounded-[8px] bg-newBgColorInner border border-studioBorder text-[13px] text-textColor outline-none focus:border-[#2B5CD3] transition-colors';

const MediaPicker: FC<{ field: StudioField & { type: 'media' }; value?: FileFieldValue; onChange: (v: FileFieldValue | undefined) => void }> = ({
  field,
  value,
  onChange,
}) => {
  const modals = useModals();
  const toaster = useToaster();
  const t = useT();
  const display = value?.url || value?.fileId;
  const kind = t(`media_kind_${field.accept}`, field.accept);

  const choose = () => {
    modals.openModal({
      title: t('studio_media_select_title', 'Select {{kind}} file', { kind }),
      removeLayout: true,
      children: (close: () => void) => (
        <MediaSelectorModal
          open
          onClose={close}
          kinds={[field.accept]}
          onSelect={(item) => {
            if (item.type !== field.accept) {
              toaster.show(
                t('studio_media_wrong_kind', 'Please choose a {{kind}} file', { kind }),
                'warning'
              );
              return;
            }
            onChange({ fileId: item.fileId, url: item.url, type: item.type });
            close();
          }}
        />
      ),
    });
  };

  return (
    <div className="flex gap-[8px]">
      <button
        type="button"
        onClick={choose}
        className={`${inputClass} text-left ${display ? 'text-textColor' : 'text-newTextColor/65'}`}
      >
        {display ? (
          <span className="truncate block">{display}</span>
        ) : (
          t('studio_media_choose', 'Choose {{kind}}…', { kind })
        )}
      </button>
      {display && (
        <button
          type="button"
          onClick={() => onChange(undefined)}
          className="px-[10px] rounded-[8px] text-newTextColor/65 hover:text-red-500 transition-colors"
          aria-label={t('clear', 'Clear')}
        >
          ✕
        </button>
      )}
    </div>
  );
};

export const StudioForm: FC<StudioFormProps> = ({ fields, values, onChange, provider, operation, keyNs, tabKey }) => {
  const t = useT();
  return (
    <div className="flex flex-col gap-[16px]">
      {fields.map((field) => {
        const value = values[field.name];
        const label = field.label
          ? t(studioFieldKey(keyNs, tabKey, field.name, 'label'), field.label)
          : undefined;
        const placeholder =
          'placeholder' in field && field.placeholder
            ? t(studioFieldKey(keyNs, tabKey, field.name, 'placeholder'), field.placeholder)
            : undefined;
        const help = field.help
          ? t(studioFieldKey(keyNs, tabKey, field.name, 'help'), field.help)
          : undefined;
        const a11yLabel = label ?? field.name;
        return (
          <div key={field.name}>
            <Label label={label} required={field.required} />

            {(field.type === 'prompt' || field.type === 'text') &&
              (field.type === 'prompt' ? (
                <textarea
                  aria-label={a11yLabel}
                  value={(value as string) ?? ''}
                  onChange={(e) => onChange(field.name, e.target.value)}
                  placeholder={placeholder}
                  rows={4}
                  className={`${inputClass} resize-y min-h-[88px]`}
                />
              ) : (
                <input
                  type="text"
                  aria-label={a11yLabel}
                  value={(value as string) ?? ''}
                  onChange={(e) => onChange(field.name, e.target.value)}
                  placeholder={placeholder}
                  className={inputClass}
                />
              ))}

            {field.type === 'select' &&
              (field.source === 'models' ? (
                <ModelSelect
                  provider={provider}
                  operation={operation}
                  value={(value as string) ?? (field.default as string)}
                  staticOptions={field.options}
                  onChange={(v) => onChange(field.name, v)}
                />
              ) : (
                <select
                  aria-label={a11yLabel}
                  value={(value as string) ?? (field.default as string) ?? ''}
                  onChange={(e) => onChange(field.name, e.target.value)}
                  className={inputClass}
                >
                  {(field.options ?? []).map((o, i) => (
                    <option key={o.value} value={o.value}>
                      {t(studioOptionKey(keyNs, tabKey, field.name, i), o.label)}
                    </option>
                  ))}
                </select>
              ))}

            {field.type === 'number' &&
              (field.min !== undefined && field.max !== undefined ? (
                <div className="flex items-center gap-[12px]">
                  <input
                    type="range"
                    aria-label={a11yLabel}
                    min={field.min}
                    max={field.max}
                    step={field.step ?? 1}
                    value={(value as number) ?? (field.default as number) ?? field.min}
                    onChange={(e) => onChange(field.name, Number(e.target.value))}
                    className="flex-1 accent-[#2B5CD3]"
                  />
                  <span className="text-[12px] text-textColor w-[40px] text-right tabular-nums">
                    {(value as number) ?? (field.default as number) ?? field.min}
                  </span>
                </div>
              ) : (
                <input
                  type="number"
                  aria-label={a11yLabel}
                  min={field.min}
                  max={field.max}
                  step={field.step ?? 1}
                  value={(value as number) ?? (field.default as number) ?? ''}
                  onChange={(e) => onChange(field.name, e.target.value === '' ? undefined : Number(e.target.value))}
                  className={inputClass}
                />
              ))}

            {field.type === 'toggle' && (
              <button
                type="button"
                onClick={() => onChange(field.name, !((value as boolean) ?? (field.default as boolean) ?? false))}
                className={`flex items-center gap-[8px] text-[13px] ${(value as boolean) ?? (field.default as boolean) ? 'text-textColor' : 'text-newTextColor/60'}`}
              >
                <span
                  className={`w-[36px] h-[20px] rounded-full p-[2px] transition-colors ${(value as boolean) ?? (field.default as boolean) ? 'bg-[#2B5CD3]' : 'bg-studioBorder'}`}
                >
                  <span
                    className={`block w-[16px] h-[16px] rounded-full bg-white transition-transform ${(value as boolean) ?? (field.default as boolean) ? 'translate-x-[16px]' : ''}`}
                  />
                </span>
                {help || label}
              </button>
            )}

            {field.type === 'media' && (
              <MediaPicker
                field={field}
                value={value as FileFieldValue | undefined}
                onChange={(v) => onChange(field.name, v)}
              />
            )}

            {help && field.type !== 'toggle' && (
              <div className="text-[11px] text-newTextColor/60 mt-[5px]">{help}</div>
            )}
          </div>
        );
      })}
    </div>
  );
};
