'use client';

import React, { useMemo, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  ProviderVersionSelect,
  useProviderVersionSelection,
} from '@gitroom/frontend/components/settings/shared/provider-version-select';
import {
  KitCredentialField,
  ProviderFormState,
  ProviderSurfaceDescriptor,
} from './provider-surface.types';
import { ExtraField } from './fields';

/**
 * Generic, descriptor-driven credential form (plan Step 1.6). Reuses the kernel
 * version plumbing (`useProviderVersionSelection`) for catalog-first credential
 * fields, renders the shared credential loop (text / password-with-show-hide /
 * select / textarea / required asterisk), the descriptor's extra-field slots,
 * and shared Test/Save/Remove buttons. Per-surface envelope assembly lives in
 * `descriptor.form.buildBody` / `buildTestBody`.
 */
export interface ProviderConfigFormProps<Meta = any> {
  descriptor: ProviderSurfaceDescriptor<Meta>;
  identifier: string;
  isConfigured: boolean;
  initialVersion?: string;
  meta: Meta;
  /** Provider homepage — surfaces a "where to get your keys" info hint. */
  website?: string;
  onClose: () => void;
  onSaved: () => void;
  onRemoved?: () => void;
  save: (id: string, body: any) => Promise<boolean>;
  test: (id: string, body: any) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
}

export function ProviderConfigForm<Meta = any>({
  descriptor,
  identifier,
  isConfigured,
  initialVersion,
  meta,
  website,
  onClose,
  onSaved,
  onRemoved,
  save,
  test,
  remove,
}: ProviderConfigFormProps<Meta>) {
  const t = useT();
  const {
    versions,
    selected: selectedVersion,
    selectVersion,
    showSelect,
    credentialFields: versionFields,
  } = useProviderVersionSelection(descriptor.catalogDomain, identifier, initialVersion);

  const fallbackFields = descriptor.form.credentialFieldsFromMeta?.(meta) ?? [];
  const fields: KitCredentialField[] =
    showSelect && versionFields
      ? (versionFields as KitCredentialField[])
      : fallbackFields;

  const seeded = descriptor.form.seedState?.(meta) ?? {};
  const [state, setState] = useState<ProviderFormState>({
    name: seeded.name ?? '',
    credentials: seeded.credentials ?? {},
    version: undefined,
    extra: seeded.extra ?? {},
  });
  const [visibleFields, setVisibleFields] = useState<Record<string, boolean>>({});
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'failure' | null>(null);
  const [saving, setSaving] = useState(false);

  const setName = (value: string) => setState((s) => ({ ...s, name: value }));
  const setCred = (key: string, value: string) =>
    setState((s) => ({ ...s, credentials: { ...s.credentials, [key]: value } }));
  const setCredentials = (patch: Record<string, string>) =>
    setState((s) => ({ ...s, credentials: { ...s.credentials, ...patch } }));
  const setExtra = (key: string, value: any) =>
    setState((s) => ({ ...s, extra: { ...s.extra, [key]: value } }));

  // The full state handed to buildBody (carries the resolved version).
  const stateWithVersion = useMemo(
    () => ({ ...state, version: selectedVersion }),
    [state, selectedVersion],
  );

  const extraFields = descriptor.form.extraFields ?? [];
  const instanceNameFields = extraFields.filter((f) => f.type === 'instance-name');
  const trailingFields = extraFields.filter((f) => f.type !== 'instance-name');

  const fieldProps = {
    state,
    setName,
    setExtra,
    setCredentials,
    meta,
    identifier,
    basePath: descriptor.basePath,
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const body = descriptor.form.buildBody(stateWithVersion, meta);
      const ok = await save(identifier, body);
      if (ok) onSaved();
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const body = descriptor.form.buildTestBody
        ? descriptor.form.buildTestBody(stateWithVersion, meta)
        : { credentials: state.credentials };
      const ok = await test(identifier, body);
      setTestResult(ok ? 'success' : 'failure');
    } finally {
      setTesting(false);
    }
  };

  const handleRemove = async () => {
    const ok = await remove(identifier);
    if (ok) onRemoved?.();
  };

  const name = (meta as any)?.name || identifier;
  const setupNotes = (meta as any)?.setupNotes as string | undefined;

  return (
    <div className="bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[24px] flex flex-col gap-[24px]">
      <div className="flex items-center justify-between">
        <div className="text-[16px] font-semibold">{name}</div>
        <button
          className="text-[12px] text-newTableText hover:text-textColor"
          onClick={onClose}
        >
          {t('close', 'Close')}
        </button>
      </div>

      {website && (
        <div className="text-[13px] leading-[1.5] text-textColor bg-btnPrimary/10 border border-btnPrimary/30 rounded-[8px] p-[12px] flex items-start gap-[10px]">
          <svg
            viewBox="0 0 20 20"
            width="16"
            height="16"
            fill="currentColor"
            className="text-btnPrimary shrink-0 mt-[1px]"
            aria-hidden="true"
          >
            <path d="M10 2a8 8 0 100 16 8 8 0 000-16zm0 4a1 1 0 110 2 1 1 0 010-2zm1.25 9h-2.5v-1.25H9.5v-2.5H8.75V10h1.75a.75.75 0 01.75.75v3h.75V15z" />
          </svg>
          <span>
            {t(
              'config_key_hint',
              'New here? Create an account and get your API key from the provider, then paste it below.',
            )}{' '}
            <a
              href={website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-btnPrimaryAccent hover:underline whitespace-nowrap"
            >
              {t('visit_website', 'Visit website')} ↗
            </a>
          </span>
        </div>
      )}

      {instanceNameFields.map((spec) => (
        <ExtraField key={spec.key} spec={spec} {...fieldProps} />
      ))}

      <ProviderVersionSelect
        versions={versions}
        value={selectedVersion}
        onChange={selectVersion}
        label={t('provider_version', 'Provider version')}
      />

      {fields.map((field) => (
        <div key={field.key} className="flex flex-col gap-[4px]">
          <label className="text-[13px] text-newTableText">
            {t('provider_field_' + field.key, field.label)}
            {field.required && <span className="text-red-500 ml-[2px]">*</span>}
          </label>
          {field.type === 'select' && field.options ? (
            <select
              className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[8px] text-textColor text-[13px]"
              value={state.credentials[field.key] || ''}
              onChange={(e) => setCred(field.key, e.target.value)}
            >
              <option value="">{t('select_option', 'Select...')}</option>
              {field.options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t('provider_field_option_' + field.key + '_' + opt.value, opt.label)}
                </option>
              ))}
            </select>
          ) : field.type === 'textarea' ? (
            <textarea
              className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[8px] text-textColor text-[13px] font-mono min-h-[120px] resize-y"
              placeholder={
                field.placeholder
                  ? t('provider_field_placeholder_' + field.key, field.placeholder)
                  : ''
              }
              value={state.credentials[field.key] || ''}
              onChange={(e) => setCred(field.key, e.target.value)}
            />
          ) : (
            <div className="relative">
              <input
                className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[8px] text-textColor text-[13px] w-full"
                type={
                  field.type === 'password' && !visibleFields[field.key]
                    ? 'password'
                    : 'text'
                }
                placeholder={
                  field.placeholder
                    ? t('provider_field_placeholder_' + field.key, field.placeholder)
                    : ''
                }
                value={state.credentials[field.key] || ''}
                onChange={(e) => setCred(field.key, e.target.value)}
              />
              {field.type === 'password' && (
                <button
                  type="button"
                  className="absolute right-[8px] top-1/2 -translate-y-1/2 text-[11px] text-newTableText hover:text-textColor"
                  onClick={() =>
                    setVisibleFields((prev) => ({ ...prev, [field.key]: !prev[field.key] }))
                  }
                >
                  {visibleFields[field.key] ? t('hide', 'Hide') : t('show', 'Show')}
                </button>
              )}
            </div>
          )}
          {field.help && (
            <div className="text-[11px] text-newTableText">
              {t('provider_field_help_' + field.key, field.help)}
            </div>
          )}
        </div>
      ))}

      {trailingFields.map((spec) => (
        <ExtraField key={spec.key} spec={spec} {...fieldProps} />
      ))}

      {setupNotes && (
        <div className="text-[12px] text-newTableText bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[12px]">
          {setupNotes}
        </div>
      )}

      {testResult && (
        <div
          className={`text-[13px] px-[12px] py-[8px] rounded-[4px] ${
            testResult === 'success'
              ? 'bg-green-900/20 text-green-900 dark:text-green-400'
              : 'bg-red-900/20 text-dangerText'
          }`}
        >
          {testResult === 'success'
            ? t('test_success', 'Connection successful')
            : t('test_failure', 'Connection failed — check your credentials')}
        </div>
      )}

      <div className="flex items-center justify-between">
        {isConfigured && descriptor.features.remove !== false && (
          <button
            className="text-[13px] px-[16px] py-[8px] rounded-[8px] border border-red-500/50 text-red-700 dark:text-red-400 hover:bg-red-500/10"
            onClick={handleRemove}
          >
            {t('remove', 'Remove')}
          </button>
        )}
        <div className="flex items-center gap-[12px] ml-auto">
          {descriptor.features.test !== false && (
            <button
              className="text-[13px] px-[16px] py-[8px] rounded-[8px] border border-newTableBorder hover:bg-boxHover"
              onClick={handleTest}
              disabled={testing}
            >
              {testing ? t('testing', 'Testing...') : t('test_connection', 'Test Connection')}
            </button>
          )}
          <button
            className="bg-btnPrimary text-white rounded-[8px] px-[16px] py-[8px] text-[13px] hover:opacity-90"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? t('saving', 'Saving...') : t('save', 'Save')}
          </button>
        </div>
      </div>
    </div>
  );
}
