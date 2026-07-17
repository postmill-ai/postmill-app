'use client';

import { FC, useCallback, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR, { useSWRConfig } from 'swr';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useDecisionModal } from '@gitroom/frontend/components/layout/new-modal';
import copy from 'copy-to-clipboard';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import dayjs from 'dayjs';

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface CreatedKey {
  plaintext: string;
  prefix: string;
  name: string;
}

const useApiKeys = () => {
  const fetch = useFetch();
  return useSWR('api-keys', async () => {
    const res = await fetch('/user/api-keys');
    if (!res.ok) return [];
    return res.json();
  }, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
  });
};

const CopyButton = ({ text, label }: { text: string; label: string }) => {
  const toaster = useToaster();
  const t = useT();
  return (
    <button
      type="button"
      onClick={() => {
        copy(text);
        toaster.show(t('label_copied_to_clipboard', '{{label}} copied to clipboard', { label }), 'success');
      }}
      className="cursor-pointer px-[16px] h-[36px] bg-btnSimple hover:bg-boxHover transition-colors rounded-[8px] text-[13px] font-[600] flex items-center gap-[6px]"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
        <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
      </svg>
      {label}
    </button>
  );
};

export const ApiKeysSection: FC<{ onKeyCreated?: (key: CreatedKey) => void }> = ({ onKeyCreated }) => {
  const fetch = useFetch();
  const toaster = useToaster();
  const decision = useDecisionModal();
  const { mutate } = useSWRConfig();
  const t = useT();
  const { data: keys, isLoading } = useApiKeys();
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyExpiry, setNewKeyExpiry] = useState('');
  const [createdKey, setCreatedKey] = useState<CreatedKey | null>(null);
  const [rotatingId, setRotatingId] = useState<string | null>(null);
  const [rotateName, setRotateName] = useState('');

  const createKey = useCallback(async () => {
    if (!newKeyName.trim()) {
      toaster.show(t('key_name_required', 'Key name is required'), 'warning');
      return;
    }
    try {
      const result = await (await fetch('/user/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newKeyName.trim(),
          expiresAt: newKeyExpiry || undefined,
        }),
      })).json();

      if (result.plaintext) {
        setCreatedKey(result);
        onKeyCreated?.(result);
        toaster.show(t('api_key_created_toast', 'API key created!'), 'success');
      }
      setCreating(false);
      setNewKeyName('');
      setNewKeyExpiry('');
      mutate('api-keys');
    } catch {
      toaster.show(t('failed_to_create_api_key', 'Failed to create API key'), 'warning');
    }
  }, [newKeyName, newKeyExpiry, fetch, mutate, toaster, onKeyCreated, t]);

  const revokeKey = useCallback(async (id: string, name: string) => {
    const approved = await decision.open({
      title: t('revoke_api_key', 'Revoke API Key?'),
      description: t(
        'revoke_api_key_description',
        'This will permanently revoke "{{name}}". Any integrations using this key will stop working immediately.',
        { name }
      ),
      approveLabel: t('revoke', 'Revoke'),
      cancelLabel: t('cancel', 'Cancel'),
    });
    if (!approved) return;
    try {
      await fetch(`/user/api-keys/${id}`, { method: 'DELETE' });
      toaster.show(t('api_key_revoked_toast', 'API key revoked'), 'success');
      mutate('api-keys');
    } catch {
      toaster.show(t('failed_to_revoke_api_key', 'Failed to revoke API key'), 'warning');
    }
  }, [decision, fetch, mutate, toaster, t]);

  const rotateKey = useCallback(async (id: string) => {
    const approved = await decision.open({
      title: t('rotate_api_key', 'Rotate API Key?'),
      description: t('rotate_api_key_description', 'This will revoke the current key and create a new one with the same name.'),
      approveLabel: t('rotate', 'Rotate'),
      cancelLabel: t('cancel', 'Cancel'),
    });
    if (!approved) return;
    try {
      const result = await (await fetch(`/user/api-keys/${id}/rotate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: rotateName }),
      })).json();

      if (result.plaintext) {
        setCreatedKey(result);
        onKeyCreated?.(result);
        toaster.show(t('api_key_rotated_toast', 'API key rotated!'), 'success');
      }
      setRotatingId(null);
      setRotateName('');
      mutate('api-keys');
    } catch {
      toaster.show(t('failed_to_rotate_api_key', 'Failed to rotate API key'), 'warning');
    }
  }, [decision, fetch, mutate, toaster, rotateName, onKeyCreated, t]);

  if (isLoading) return null;

  return (
    <div className="flex flex-col gap-[20px]">
      {createdKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-newBgColorInnerInner rounded-[12px] border border-newBorder p-[24px] max-w-[500px] w-full mx-[16px]">
            <div className="text-[18px] font-[700] mb-[8px]">{t('api_key_created', 'API Key Created')}</div>
            <div className="text-[14px] text-newTableText mb-[16px]">
              {t('api_key_created_description', 'Copy your new API key now. For security, it will only be shown once.')}
            </div>
            <div className="bg-newBgColorInner border border-newBorder rounded-[8px] p-[16px] mb-[12px]">
              <div className="text-[12px] text-newTableText mb-[4px]">{createdKey.name}</div>
              <code className="text-[14px] break-all select-all">{createdKey.plaintext}</code>
            </div>
            <div className="bg-red-900/20 border border-red-500/30 rounded-[8px] p-[12px] mb-[16px]">
              <div className="text-[13px] text-dangerText font-[500]">
                {t('api_key_warning', 'You will not be able to see this key again. Copy it now or you will have to create a new one.')}
              </div>
            </div>
            <div className="flex gap-[8px]">
              <CopyButton text={createdKey.plaintext} label={t('copy_key', 'Copy Key')} />
              <button
                type="button"
                onClick={() => setCreatedKey(null)}
                className="cursor-pointer px-[16px] h-[36px] bg-btnSimple hover:bg-boxHover transition-colors rounded-[8px] text-[13px] font-[600]"
              >
                {t('done', 'Done')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center">
        <div>
          <div className="text-[15px] font-[600]">
            {t('api_keys', 'API Keys')}
          </div>
          <div className="text-[13px] text-newTableText mt-[2px]">
            {t('api_keys_description', 'Manage API keys for programmatic access to Postmill.')}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="cursor-pointer px-[20px] h-[44px] bg-[#2B5CD3] hover:bg-[#5520CB] transition-colors text-white rounded-[8px] text-[15px] font-[600]"
        >
          {t('create_key', 'Create Key')}
        </button>
      </div>

      {creating && (
        <div className="bg-newBgColorInner rounded-[12px] border border-newBorder overflow-hidden">
          <div className="bg-newBgColorInner px-[20px] py-[14px] border-b border-newBorder">
            <div className="text-[15px] font-[600]">
              {t('create_api_key', 'Create API Key')}
            </div>
          </div>
          <div className="p-[20px] flex flex-col gap-[16px]">
            <div className="flex flex-col gap-[6px]">
              <label className="text-[13px] font-[600] text-newTableText">
                {t('key_name', 'Key Name')} *
              </label>
              <input
                className="bg-newBgColorInner border border-newBorder rounded-[8px] px-[16px] h-[44px] text-textColor outline-none"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder={t('my_api_key_placeholder', 'My API Key')}
                maxLength={100}
              />
            </div>
            <div className="flex flex-col gap-[6px]">
              <label className="text-[13px] font-[600] text-newTableText">
                {t('expires_at', 'Expires At')}
              </label>
              <input
                type="datetime-local"
                className="bg-newBgColorInner border border-newBorder rounded-[8px] px-[16px] h-[44px] text-textColor outline-none"
                value={newKeyExpiry}
                onChange={(e) => setNewKeyExpiry(e.target.value)}
              />
            </div>
            <div className="flex gap-[8px]">
              <button
                type="button"
                onClick={createKey}
                className="cursor-pointer px-[20px] h-[44px] bg-[#2B5CD3] hover:bg-[#5520CB] transition-colors text-white rounded-[8px] text-[15px] font-[600]"
              >
                {t('create', 'Create')}
              </button>
              <button
                type="button"
                onClick={() => { setCreating(false); setNewKeyName(''); setNewKeyExpiry(''); }}
                className="cursor-pointer px-[20px] h-[44px] bg-btnSimple hover:bg-boxHover transition-colors rounded-[8px] text-[15px] font-[600]"
              >
                {t('cancel', 'Cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {(!keys || keys.length === 0) && !creating && (
        <div className="bg-newBgColorInner rounded-[12px] border border-newBorder p-[20px]">
          <div className="text-[14px] text-newTableText">
            {t('no_api_keys', 'No API keys yet. Create one to get started.')}
          </div>
        </div>
      )}

      {keys && keys.length > 0 && (
        <div className="bg-newBgColorInnerInner rounded-[12px] border border-newBorder overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-newBgColorInner border-b border-newBorder">
                <th className="text-left px-[16px] py-[10px] font-[600] text-newTableText">{t('name', 'Name')}</th>
                <th className="text-left px-[16px] py-[10px] font-[600] text-newTableText">{t('prefix', 'Prefix')}</th>
                <th className="text-left px-[16px] py-[10px] font-[600] text-newTableText">{t('created', 'Created')}</th>
                <th className="text-left px-[16px] py-[10px] font-[600] text-newTableText">{t('last_used', 'Last Used')}</th>
                <th className="text-left px-[16px] py-[10px] font-[600] text-newTableText">{t('expiry', 'Expiry')}</th>
                <th className="text-left px-[16px] py-[10px] font-[600] text-newTableText">{t('status', 'Status:')}</th>
                <th className="text-right px-[16px] py-[10px] font-[600] text-newTableText">{t('actions', 'Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key: ApiKey) => (
                <tr key={key.id} className="border-b border-newBorder last:border-b-0">
                  <td className="px-[16px] py-[12px]">{key.name}</td>
                  <td className="px-[16px] py-[12px] font-mono">{key.prefix}&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;</td>
                  <td className="px-[16px] py-[12px]">{dayjs(key.createdAt).format(t('api_key_date_format', 'MMM D, YYYY'))}</td>
                  <td className="px-[16px] py-[12px]">{key.lastUsedAt ? dayjs(key.lastUsedAt).format(t('api_key_date_format', 'MMM D, YYYY')) : '-'}</td>
                  <td className="px-[16px] py-[12px]">{key.expiresAt ? dayjs(key.expiresAt).format(t('api_key_date_format', 'MMM D, YYYY')) : '-'}</td>
                  <td className="px-[16px] py-[12px]">
                    {key.revokedAt ? (
                      <span className="text-dangerText">{t('revoked', 'Revoked')}</span>
                    ) : key.expiresAt && new Date(key.expiresAt) < new Date() ? (
                      <span className="text-amber-600">{t('expired', 'Expired')}</span>
                    ) : (
                      <span className="text-green-700 dark:text-green-400">{t('active', 'Active')}</span>
                    )}
                  </td>
                  <td className="px-[16px] py-[12px] text-right">
                    <div className="flex gap-[6px] justify-end">
                      {rotatingId === key.id ? (
                        <div className="flex gap-[6px] items-center">
                          <input
                            className="bg-newBgColorInner border border-newBorder rounded-[4px] px-[8px] h-[28px] text-[12px] text-textColor outline-none w-[100px]"
                            value={rotateName}
                            onChange={(e) => setRotateName(e.target.value)}
                            placeholder={key.name}
                          />
                          <button
                            type="button"
                            onClick={() => rotateKey(key.id)}
                            className="cursor-pointer px-[8px] h-[28px] bg-[#2B5CD3] text-white rounded-[4px] text-[11px] font-[600]"
                          >
                            {t('confirm', 'Confirm')}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setRotatingId(null); setRotateName(''); }}
                            className="cursor-pointer px-[8px] h-[28px] bg-btnSimple rounded-[4px] text-[11px] font-[600]"
                          >
                            {t('cancel', 'Cancel')}
                          </button>
                        </div>
                      ) : (
                        <>
                          {!key.revokedAt && (
                            <button
                              type="button"
                              onClick={() => { setRotatingId(key.id); setRotateName(key.name); }}
                              className="cursor-pointer px-[10px] h-[28px] bg-btnSimple hover:bg-boxHover transition-colors rounded-[4px] text-[11px] font-[600]"
                            >
                              {t('rotate', 'Rotate')}
                            </button>
                          )}
                          {!key.revokedAt && (
                            <button
                              type="button"
                              onClick={() => revokeKey(key.id, key.name)}
                              className="cursor-pointer px-[10px] h-[28px] bg-red-600 hover:bg-red-700 text-white transition-colors rounded-[4px] text-[11px] font-[600]"
                            >
                              {t('revoke', 'Revoke')}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
