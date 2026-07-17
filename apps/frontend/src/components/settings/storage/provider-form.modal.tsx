'use client';

import React, { useState } from 'react';
import ProviderIcon from '@gitroom/frontend/components/shared/provider-icon';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { CampaignSelector } from '@gitroom/frontend/components/campaigns/selector/campaign-selector';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { ExtraField } from '@gitroom/frontend/components/settings/shared/kit/fields';
import {
  ProviderExtraFieldSpec,
  ProviderFormState,
} from '@gitroom/frontend/components/settings/shared/kit/provider-surface.types';

const allProviderTypes = [
  { value: 'LOCAL', label: 'Local Storage' },
  { value: 'S3', label: 'AWS S3' },
  { value: 'CLOUDFLARE_R2', label: 'Cloudflare R2' },
  { value: 'BACKBLAZE_B2', label: 'Backblaze B2' },
  { value: 'IDRIVE_E2', label: 'IDrive e2' },
  { value: 'WASABI', label: 'Wasabi' },
  { value: 'DIGITALOCEAN_SPACES', label: 'DigitalOcean Spaces' },
  { value: 'HETZNER', label: 'Hetzner Object Storage' },
  { value: 'STORJ', label: 'Storj' },
  { value: 'SCALEWAY', label: 'Scaleway' },
  { value: 'VULTR', label: 'Vultr Object Storage' },
  { value: 'LINODE', label: 'Linode / Akamai' },
  { value: 'S3_COMPATIBLE', label: 'S3-Compatible' },
  { value: 'MEDIALOCKER', label: 'MediaLocker' },
];

// Field specs rendered through the shared kit `ExtraField` renderer instead of
// hand-rolled <input> markup. Credentials + config all live in the form's
// `extra` bag; `handleSave`/`handleTest` assemble the existing PUT/test body.
const NAME_SPEC: ProviderExtraFieldSpec = {
  type: 'instance-name',
  key: 'name',
  label: 'Name',
  placeholder: 'My Storage',
};

const DEFAULT_CREDENTIAL_SPECS: ProviderExtraFieldSpec[] = [
  { type: 'text', key: 'accessKeyId', label: 'Access Key ID', placeholder: 'AKIA...' },
  {
    type: 'password',
    key: 'secretAccessKey',
    label: 'Secret Access Key',
    placeholder: '••••••••',
  },
];

const DEFAULT_CONFIG_SPECS: ProviderExtraFieldSpec[] = [
  { type: 'text', key: 'region', label: 'Region', placeholder: 'us-east-1' },
  { type: 'text', key: 'bucket', label: 'Bucket', placeholder: 'my-bucket' },
  {
    type: 'text',
    key: 'endpoint',
    label: 'Custom Endpoint (optional)',
    placeholder: 'https://...',
  },
  {
    type: 'text',
    key: 'publicUrl',
    label: 'Public URL (optional)',
    placeholder: 'https://cdn.example.com',
  },
];

// Per-type field sets; types not listed here fall back to the S3-style defaults.
// Credential keys ride inside the (encrypted) credentials JSON; config keys are
// top-level columns on the storage config row.
const TYPE_FIELD_SPECS: Record<
  string,
  { credentials: ProviderExtraFieldSpec[]; config: ProviderExtraFieldSpec[] }
> = {
  MEDIALOCKER: {
    credentials: [
      {
        type: 'text',
        key: 'bucketId',
        label: 'Bucket ID',
        placeholder: 'b3f1c2d4-…',
      },
      {
        type: 'password',
        key: 'apiKey',
        label: 'Secret Access Key',
        placeholder: '••••••••',
      },
      {
        type: 'text',
        key: 'baseUrl',
        label: 'API Base URL (optional)',
        placeholder: 'https://api.medialocker.io',
      },
    ],
    config: [
      {
        type: 'text',
        key: 'publicUrl',
        label: 'Public URL (optional)',
        placeholder: 'https://cdn.example.com',
      },
    ],
  },
};

interface ProviderFormModalProps {
  onClose: () => void;
  onSaved: () => void;
  editProvider?: any;
  presetType?: string;
}

export const ProviderFormModal: React.FC<ProviderFormModalProps> = ({
  onClose,
  onSaved,
  editProvider,
  presetType,
}) => {
  const translate = useT();
  const fetch = useFetch();
  const [type, setType] = useState(editProvider?.type || presetType || 'S3');
  const [state, setState] = useState<ProviderFormState>({
    name: editProvider?.name || '',
    credentials: {},
    extra: {
      region: editProvider?.region || '',
      bucket: editProvider?.bucket || '',
      endpoint: editProvider?.endpoint || '',
      publicUrl: editProvider?.publicUrl || '',
    },
  });
  const [testResult, setTestResult] = useState<{
    ok?: boolean;
    error?: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const setName = (value: string) => setState((s) => ({ ...s, name: value }));
  const setExtra = (key: string, value: any) =>
    setState((s) => ({ ...s, extra: { ...s.extra, [key]: value } }));
  const setCredentials = (patch: Record<string, string>) =>
    setState((s) => ({ ...s, credentials: { ...s.credentials, ...patch } }));

  // Generic/instance-name field renderers consume this prop bag.
  const fieldProps = {
    state,
    setName,
    setExtra,
    setCredentials,
    meta: editProvider,
    identifier: type,
    basePath: '/settings/storage',
  };

  // Field specs resolve per selected type; unlisted types get the S3 defaults.
  const { credentials: credentialSpecs, config: configSpecs } =
    TYPE_FIELD_SPECS[type] ?? {
      credentials: DEFAULT_CREDENTIAL_SPECS,
      config: DEFAULT_CONFIG_SPECS,
    };

  // Pick each credential-spec key's non-empty value out of `state.extra`
  // (exactly how accessKeyId/secretAccessKey were picked before); the block is
  // dropped entirely when every credential field is empty.
  const pickCredentials = (): Record<string, string> | undefined => {
    const credentials: Record<string, string> = {};
    for (const spec of credentialSpecs) {
      const value = state.extra[spec.key];
      if (value) credentials[spec.key] = value;
    }
    return Object.keys(credentials).length > 0 ? credentials : undefined;
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const testBody: any = {};
      const credentials = pickCredentials();
      if (type !== 'LOCAL' && credentials) {
        testBody.credentials = credentials;
      }
      // The connection test exercises the storage API, not the CDN, so the
      // public URL never rides along (same as the S3 flow).
      for (const spec of configSpecs) {
        if (spec.key === 'publicUrl') continue;
        const value = state.extra[spec.key];
        if (value) testBody[spec.key] = value;
      }

      const res = await fetch('/settings/storage/' + (editProvider?.id || 'temp') + '/test', {
        method: 'POST',
        ...(Object.keys(testBody).length > 0 && {
          body: JSON.stringify(testBody),
          headers: { 'Content-Type': 'application/json' },
        }),
      });
      const data = await res.json();
      setTestResult(data);
    } catch {
      setTestResult({ ok: false, error: translate('test_request_failed', 'Test request failed') });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const body: any = { name: state.name };
      for (const spec of configSpecs) {
        body[spec.key] = state.extra[spec.key];
      }

      if (!editProvider?.id) {
        body.type = type;
      }

      const credentials = pickCredentials();
      if (type !== 'LOCAL' && credentials) {
        body.credentials = credentials;
      }

      const res = await fetch(
        '/settings/storage' + (editProvider?.id ? '/' + editProvider.id : ''),
        {
          method: editProvider?.id ? 'PUT' : 'POST',
          body: JSON.stringify(body),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (!res.ok) {
        const err = await res.json();
        setTestResult({
          ok: false,
          error: err.message || err.error || translate('save_failed', 'Failed to save'),
        });
        return;
      }

      onSaved();
    } catch (err: any) {
      setTestResult({ ok: false, error: err.message });
    } finally {
      setSaving(false);
    }
  };

  const showCredentials = type !== 'LOCAL';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-newBgColorInner border border-newTableBorder rounded-[16px] p-[24px] w-full max-w-[500px] max-h-[90vh] overflow-y-auto">
        <h3 className="text-[18px] font-medium text-textColor mb-[20px]">
          {editProvider
            ? translate('edit_provider', 'Edit Provider')
            : translate('add_storage_provider', 'Add Storage Provider')}
        </h3>

        <div className="flex flex-col gap-[16px]">
          <div>
            <label htmlFor="provider-type-group" className="text-[12px] text-newTableText mb-[6px] block">
              {translate('provider_type', 'Provider Type')}
            </label>
            <div id="provider-type-group" role="radiogroup" className="grid grid-cols-3 gap-[8px]">
              {(editProvider
                ? allProviderTypes.filter((t) => t.value === editProvider.type)
                : allProviderTypes
                    .filter((t) => t.value !== 'LOCAL')
                    .sort((a, b) => a.label.localeCompare(b.label))
              ).map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => {
                    if (!editProvider) {
                      setType(value);
                      setTestResult(null);
                    }
                  }}
                  disabled={!!editProvider}
                  className={`flex flex-col items-center gap-[4px] p-[8px] rounded-[8px] border transition-colors ${
                    type === value
                      ? 'border-btnPrimary bg-[#1a3a1a]'
                      : 'border-newTableBorder bg-transparent hover:bg-boxHover'
                  }`}
                >
                  <ProviderIcon identifier={value} name={label} size={36} />
                  <span className="text-[10px] text-newTableText text-center">
                    {translate('storage_type_' + value, label)}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <ExtraField spec={NAME_SPEC} {...fieldProps} />

          {showCredentials &&
            credentialSpecs.map((spec) => (
              <ExtraField key={spec.key} spec={spec} {...fieldProps} />
            ))}

          {configSpecs.map((spec) => (
            <ExtraField key={spec.key} spec={spec} {...fieldProps} />
          ))}

          {testResult && (
            <div
              className={`p-[12px] rounded-[8px] text-[13px] ${
                testResult.ok
                  ? 'bg-[#1a3a1a] text-textColor'
                  : 'bg-[#3a1a1a] text-[#f87171]'
              }`}
            >
              {testResult.ok
                ? translate('connection_successful', 'Connection successful!')
                : translate('connection_failed_reason', 'Connection failed: {{reason}}', {
                    reason: testResult.error,
                  })}
            </div>
          )}

          {editProvider?.id && (
            <CampaignSelector entityType="storage" entityId={editProvider.id} />
          )}

          <div className="flex gap-[12px] justify-end mt-[8px]">
            <button
              onClick={onClose}
              className="px-[16px] py-[8px] rounded-[8px] bg-btnSimple text-newTableText text-[13px] hover:bg-boxHover transition-colors"
            >
              {translate('cancel', 'Cancel')}
            </button>
            {editProvider && (
              <button
                onClick={handleTest}
                disabled={testing}
                className="px-[16px] py-[8px] rounded-[8px] bg-[#1a2a3a] text-blue-700 dark:text-blue-400 text-[13px] hover:bg-[#2a3a4a] transition-colors disabled:opacity-50"
              >
                {testing ? translate('testing', 'Testing...') : translate('test_connection', 'Test Connection')}
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={saving || !state.name.trim()}
              className="px-[16px] py-[8px] rounded-[8px] bg-btnPrimary text-white text-[13px] font-medium hover:bg-btnPrimary/80 transition-colors disabled:opacity-50"
            >
              {saving
                ? translate('saving', 'Saving...')
                : editProvider
                  ? translate('update', 'Update')
                  : translate('add_provider', 'Add Provider')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
