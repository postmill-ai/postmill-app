'use client';

import React, { useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { useDecisionModal } from '@postmill-ai/frontend/components/layout/new-modal';
import { CategoryChecklist } from './category-checklist';
import { MemberPicker, CommsMember } from './member-picker';

interface CredentialField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  placeholder?: string;
  help?: string;
}

interface CommsProvider {
  identifier: string;
  name: string;
  enabled: boolean;
  isConfigured: boolean;
  credentialFields: CredentialField[];
  credentialsSet: Record<string, boolean>;
  webhookUrl?: string;
  webhookRegistered?: boolean;
  webhookError?: string;
  setupNotes?: string;
}

interface CommsLink {
  id: string;
  identifier: string;
  userId: string;
  userEmail: string;
  userName?: string;
  status: string;
  externalDisplayName?: string;
  agentChatEnabled: boolean;
  categories: Record<string, boolean>;
  connectCodeExpiresAt?: string;
}

interface CommsConfigResponse {
  providers: CommsProvider[];
  links: CommsLink[];
  members: CommsMember[];
}

const ProviderCard: React.FC<{
  provider: CommsProvider;
  onSaved: () => void;
}> = ({ provider, onSaved }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const decision = useDecisionModal();
  const [expanded, setExpanded] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const call = useCallback(
    async (path: string, init?: RequestInit, okMessage?: string) => {
      setBusy(true);
      try {
        const res = await fetch(path, init);
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          toaster.show(text || t('request_failed', 'Request failed'), 'warning');
          return null;
        }
        if (okMessage) toaster.show(okMessage, 'success');
        onSaved();
        return res;
      } finally {
        setBusy(false);
      }
    },
    [fetch, toaster, t, onSaved],
  );

  const save = useCallback(async () => {
    const credentials = Object.fromEntries(
      Object.entries(values).filter(([, v]) => v.trim()),
    );
    await call(
      `/settings/comms/config/${provider.identifier}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          credentials,
          enabled: true,
        }),
      },
      t('comms_provider_saved', 'Provider saved'),
    );
    setValues({});
  }, [call, values, provider.identifier, t]);

  const test = useCallback(async () => {
    const res = await call(`/settings/comms/config/${provider.identifier}/test`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    if (!res) return;
    const json = await res.json();
    toaster.show(
      json.ok
        ? t('comms_test_ok', 'Connection OK')
        : json.error || t('comms_test_failed', 'Connection failed'),
      json.ok ? 'success' : 'warning',
    );
  }, [call, provider.identifier, toaster, t]);

  const remove = useCallback(async () => {
    const approved = await decision.open({
      description: t('comms_remove_confirm', 'Remove this provider and its user links?'),
    });
    if (!approved) return;
    await call(
      `/settings/comms/config/${provider.identifier}`,
      { method: 'DELETE' },
      t('comms_provider_removed', 'Provider removed'),
    );
  }, [call, decision, provider.identifier, t]);

  const copyWebhook = useCallback(() => {
    if (!provider.webhookUrl) return;
    navigator.clipboard?.writeText(provider.webhookUrl);
    toaster.show(t('copied', 'Copied'), 'success');
  }, [provider.webhookUrl, toaster, t]);

  return (
    <div className="bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[16px] flex flex-col gap-[10px]">
      <div className="flex items-center justify-between gap-[8px]">
        <div className="flex items-center gap-[8px]">
          <span className="text-[15px] font-[600] text-textColor">{provider.name}</span>
          {provider.isConfigured && provider.enabled && (
            <span className="text-[11px] px-[8px] py-[2px] rounded-full bg-green-500/15 text-green-500">
              {t('comms_status_active', 'Active')}
            </span>
          )}
          {provider.webhookRegistered === false && (
            <span
              className="text-[11px] px-[8px] py-[2px] rounded-full bg-amber-500/15 text-amber-500"
              title={provider.webhookError}
            >
              {t('comms_webhook_pending', 'Webhook not registered')}
            </span>
          )}
        </div>
        <button
          type="button"
          className="text-[13px] text-btnPrimary"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? t('close', 'Close') : t('configure', 'Configure')}
        </button>
      </div>

      {expanded && (
        <div className="flex flex-col gap-[10px]">
          {provider.credentialFields.map((field) => (
            <div key={field.key} className="flex flex-col gap-[4px]">
              <label className="text-[13px] text-textColor">
                {field.label}
                {field.required ? ' *' : ''}
              </label>
              <input
                type={field.type === 'password' ? 'password' : 'text'}
                value={values[field.key] ?? ''}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [field.key]: e.target.value }))
                }
                placeholder={
                  provider.credentialsSet[field.key]
                    ? t('comms_credential_saved', '•••••• (saved — leave blank to keep)')
                    : field.placeholder
                }
                className="w-full px-[12px] py-[8px] bg-newBgColor border border-newTableBorder rounded-[8px] text-[14px] outline-hidden"
              />
              {field.help && (
                <div className="text-[12px] text-textColor/60">{field.help}</div>
              )}
            </div>
          ))}

          {provider.webhookUrl && (
            <div className="flex flex-col gap-[4px]">
              <label className="text-[13px] text-textColor">
                {t('comms_webhook_url', 'Webhook URL')}
              </label>
              <div className="flex items-center gap-[8px]">
                <code className="flex-1 truncate px-[12px] py-[8px] bg-newBgColor border border-newTableBorder rounded-[8px] text-[12px]">
                  {provider.webhookUrl}
                </code>
                <button
                  type="button"
                  onClick={copyWebhook}
                  className="px-[12px] py-[8px] border border-newTableBorder rounded-[8px] text-[13px] text-textColor"
                >
                  {t('copy', 'Copy')}
                </button>
              </div>
            </div>
          )}

          {provider.setupNotes && (
            <div className="text-[12px] text-textColor/60">{provider.setupNotes}</div>
          )}

          <div className="flex items-center gap-[8px]">
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="px-[16px] py-[8px] bg-btnPrimary text-white rounded-[8px] text-[14px] disabled:opacity-50"
            >
              {t('save', 'Save')}
            </button>
            {provider.isConfigured && (
              <>
                <button
                  type="button"
                  onClick={test}
                  disabled={busy}
                  className="px-[16px] py-[8px] border border-newTableBorder rounded-[8px] text-[14px] text-textColor disabled:opacity-50"
                >
                  {t('test_connection', 'Test connection')}
                </button>
                <button
                  type="button"
                  onClick={remove}
                  disabled={busy}
                  className="px-[16px] py-[8px] border border-red-500/40 text-red-500 rounded-[8px] text-[14px] disabled:opacity-50"
                >
                  {t('remove', 'Remove')}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const CODE_INSTRUCTIONS: Record<string, [string, string]> = {
  slack: ['comms_code_instructions_slack', 'Open a DM with the bot in Slack and send: link {code}'],
  telegram: ['comms_code_instructions_telegram', 'Open a chat with the bot in Telegram and send: link {code}'],
  discord: ['comms_code_instructions_discord', 'In Discord, run: /postmill message: link {code}'],
  matrix: ['comms_code_instructions_matrix', 'Invite the bot to a direct room in Matrix and send: link {code}'],
  line: ['comms_code_instructions_line', 'Add the bot as a friend on LINE and send: link {code}'],
};

export const CommsTab: React.FC = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const decision = useDecisionModal();

  const load = useCallback(
    async () =>
      (await (await fetch('/settings/comms/config')).json()) as CommsConfigResponse,
    [fetch],
  );
  const { data, mutate, isLoading } = useSWR('comms-config', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  const [adding, setAdding] = useState(false);
  const [newUserId, setNewUserId] = useState<string | undefined>();
  const [newProvider, setNewProvider] = useState('');
  const [newCategories, setNewCategories] = useState<Record<string, boolean>>({});
  const [newAgentChat, setNewAgentChat] = useState(true);
  const [creating, setCreating] = useState(false);
  const [issuedCode, setIssuedCode] = useState<{
    code: string;
    identifier: string;
    expiresAt: string;
  } | null>(null);

  const configuredProviders = useMemo(
    () => (data?.providers ?? []).filter((p) => p.isConfigured && p.enabled),
    [data],
  );

  const refresh = useCallback(() => mutate(), [mutate]);

  const createLink = useCallback(async () => {
    if (!newUserId || !newProvider) {
      toaster.show(
        t('comms_link_missing_fields', 'Pick a member and a provider first'),
        'warning',
      );
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/settings/comms/links', {
        method: 'POST',
        body: JSON.stringify({
          identifier: newProvider,
          userId: newUserId,
          agentChatEnabled: newAgentChat,
          categories: newCategories,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        toaster.show(text || t('request_failed', 'Request failed'), 'warning');
        return;
      }
      const json = await res.json();
      setIssuedCode({
        code: json.connectCode,
        identifier: newProvider,
        expiresAt: json.expiresAt,
      });
      setAdding(false);
      setNewUserId(undefined);
      setNewProvider('');
      setNewCategories({});
      setNewAgentChat(true);
      await mutate();
    } finally {
      setCreating(false);
    }
  }, [fetch, toaster, t, mutate, newUserId, newProvider, newAgentChat, newCategories]);

  const linkAction = useCallback(
    async (path: string, init: RequestInit) => {
      const res = await fetch(path, init);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        toaster.show(text || t('request_failed', 'Request failed'), 'warning');
        return null;
      }
      await mutate();
      return res;
    },
    [fetch, toaster, t, mutate],
  );

  const regenerate = useCallback(
    async (link: CommsLink) => {
      const res = await linkAction(`/settings/comms/links/${link.id}/regenerate-code`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (!res) return;
      const json = await res.json();
      setIssuedCode({
        code: json.connectCode,
        identifier: link.identifier,
        expiresAt: json.expiresAt,
      });
    },
    [linkAction],
  );

  const toggleAgentChat = useCallback(
    (link: CommsLink) =>
      linkAction(`/settings/comms/links/${link.id}`, {
        method: 'PUT',
        body: JSON.stringify({ agentChatEnabled: !link.agentChatEnabled }),
      }),
    [linkAction],
  );

  const deleteLink = useCallback(
    async (link: CommsLink) => {
      const approved = await decision.open({
        description: t('comms_link_delete_confirm', 'Remove this link?'),
      });
      if (!approved) return;
      return linkAction(`/settings/comms/links/${link.id}`, { method: 'DELETE' });
    },
    [linkAction, decision, t],
  );

  if (isLoading || !data) {
    return (
      <div className="text-[14px] text-textColor/60">{t('loading', 'Loading…')}</div>
    );
  }

  return (
    <div className="flex flex-col gap-[24px]">
      <section className="flex flex-col gap-[12px]">
        <div>
          <div className="text-[16px] font-[600] text-textColor">
            {t('comms_providers_title', 'Comms providers')}
          </div>
          <div className="text-[13px] text-textColor/60">
            {t(
              'comms_providers_description',
              'Connect chat apps once per workspace. One Postmill workspace per bot/app — pointing a second workspace at the same bot re-routes its messages.',
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-[12px]">
          {data.providers.map((provider) => (
            <ProviderCard
              key={provider.identifier}
              provider={provider}
              onSaved={refresh}
            />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-[12px]">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[16px] font-[600] text-textColor">
              {t('comms_links_title', 'User links')}
            </div>
            <div className="text-[13px] text-textColor/60">
              {t(
                'comms_links_description',
                'Link a team member to a chat app for agent conversations and notifications.',
              )}
            </div>
          </div>
          <button
            type="button"
            data-testid="comms-add-link"
            onClick={() => setAdding((a) => !a)}
            disabled={configuredProviders.length === 0}
            className="px-[16px] py-[8px] bg-btnPrimary text-white rounded-[8px] text-[14px] disabled:opacity-50"
            title={
              configuredProviders.length === 0
                ? t('comms_configure_first', 'Configure a provider first')
                : undefined
            }
          >
            {t('comms_add_link', 'Add link')}
          </button>
        </div>

        {issuedCode && (
          <div className="bg-newBgColorInner border border-btnPrimary/40 rounded-[12px] p-[16px] flex flex-col gap-[8px]">
            <div className="text-[14px] font-[600] text-textColor">
              {t('comms_code_title', 'One-time connect code')}
            </div>
            <div className="flex items-center gap-[8px]">
              <code
                data-testid="comms-connect-code"
                className="px-[12px] py-[8px] bg-newBgColor border border-newTableBorder rounded-[8px] text-[18px] tracking-[4px]"
              >
                {issuedCode.code}
              </code>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(issuedCode.code);
                  toaster.show(t('copied', 'Copied'), 'success');
                }}
                className="px-[12px] py-[8px] border border-newTableBorder rounded-[8px] text-[13px] text-textColor"
              >
                {t('copy', 'Copy')}
              </button>
              <button
                type="button"
                onClick={() => setIssuedCode(null)}
                className="px-[12px] py-[8px] text-[13px] text-textColor/60"
              >
                {t('dismiss', 'Dismiss')}
              </button>
            </div>
            <div className="text-[13px] text-textColor/70">
              {t(
                CODE_INSTRUCTIONS[issuedCode.identifier]?.[0] ?? 'comms_code_instructions',
                CODE_INSTRUCTIONS[issuedCode.identifier]?.[1] ??
                  'Send the bot: link {code}',
              ).replace('{code}', issuedCode.code)}
            </div>
            <div className="text-[12px] text-textColor/50">
              {t('comms_code_expiry', 'The code is shown once and expires in 15 minutes.')}
            </div>
          </div>
        )}

        {adding && (
          <div className="bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[16px] flex flex-col gap-[12px]">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-[12px]">
              <div className="flex flex-col gap-[4px]">
                <label className="text-[13px] text-textColor">
                  {t('comms_member', 'Team member')} *
                </label>
                <MemberPicker
                  members={data.members}
                  value={newUserId}
                  onChange={setNewUserId}
                />
              </div>
              <div className="flex flex-col gap-[4px]">
                <label className="text-[13px] text-textColor">
                  {t('comms_provider', 'Comms app')} *
                </label>
                <select
                  aria-label={t('comms_provider', 'Comms app')}
                  value={newProvider}
                  onChange={(e) => setNewProvider(e.target.value)}
                  className="px-[12px] py-[8px] bg-newBgColor border border-newTableBorder rounded-[8px] text-[14px] outline-hidden"
                >
                  <option value="">
                    {t('comms_pick_provider', 'Select an app…')}
                  </option>
                  {configuredProviders.map((p) => (
                    <option key={p.identifier} value={p.identifier}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-[4px]">
              <label className="text-[13px] text-textColor">
                {t('comms_notifications_label', 'Send these notifications')}
              </label>
              <CategoryChecklist value={newCategories} onChange={setNewCategories} />
            </div>
            <label className="flex items-center gap-[6px] cursor-pointer text-[13px] text-textColor">
              <input
                type="checkbox"
                className="accent-btnPrimary w-[14px] h-[14px]"
                checked={newAgentChat}
                onChange={(e) => setNewAgentChat(e.target.checked)}
              />
              {t('comms_agent_chat_enabled', 'Allow chatting with the agent')}
            </label>
            <button
              type="button"
              data-testid="comms-create-link"
              onClick={createLink}
              disabled={creating}
              className="w-fit px-[16px] py-[8px] bg-btnPrimary text-white rounded-[8px] text-[14px] disabled:opacity-50"
            >
              {creating
                ? t('creating', 'Creating…')
                : t('comms_create_link', 'Create link')}
            </button>
          </div>
        )}

        {data.links.length === 0 ? (
          <div className="text-[13px] text-textColor/60">
            {t('comms_no_links', 'No user links yet.')}
          </div>
        ) : (
          <div className="bg-newBgColorInner border border-newTableBorder rounded-[12px] overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-start text-textColor/60 border-b border-newTableBorder">
                  <th className="text-start px-[16px] py-[10px]">{t('member', 'Member')}</th>
                  <th className="text-start px-[16px] py-[10px]">{t('app', 'App')}</th>
                  <th className="text-start px-[16px] py-[10px]">{t('status', 'Status')}</th>
                  <th className="text-start px-[16px] py-[10px]">
                    {t('notifications', 'Notifications')}
                  </th>
                  <th className="text-start px-[16px] py-[10px]">
                    {t('comms_agent_chat', 'Agent chat')}
                  </th>
                  <th className="px-[16px] py-[10px]" />
                </tr>
              </thead>
              <tbody>
                {data.links.map((link) => (
                  <tr key={link.id} className="border-b border-newTableBorder last:border-b-0">
                    <td className="px-[16px] py-[10px] text-textColor">
                      {link.userName || link.userEmail}
                      {link.externalDisplayName && (
                        <span className="text-textColor/50">
                          {' '}
                          · {link.externalDisplayName}
                        </span>
                      )}
                    </td>
                    <td className="px-[16px] py-[10px] text-textColor capitalize">
                      {link.identifier}
                    </td>
                    <td className="px-[16px] py-[10px]">
                      <span
                        className={
                          link.status === 'linked'
                            ? 'text-[11px] px-[8px] py-[2px] rounded-full bg-green-500/15 text-green-500'
                            : 'text-[11px] px-[8px] py-[2px] rounded-full bg-amber-500/15 text-amber-500'
                        }
                      >
                        {link.status === 'linked'
                          ? t('comms_status_linked', 'Linked')
                          : t('comms_status_pending', 'Pending')}
                      </span>
                    </td>
                    <td className="px-[16px] py-[10px] text-textColor/70">
                      {Object.values(link.categories).filter(Boolean).length}/
                      {Object.keys(link.categories).length || 10}
                    </td>
                    <td className="px-[16px] py-[10px]">
                      <input
                        type="checkbox"
                        aria-label={t('comms_agent_chat', 'Agent chat')}
                        className="accent-btnPrimary w-[14px] h-[14px]"
                        checked={link.agentChatEnabled}
                        onChange={() => toggleAgentChat(link)}
                      />
                    </td>
                    <td className="px-[16px] py-[10px] text-end whitespace-nowrap">
                      {link.status === 'pending' && (
                        <button
                          type="button"
                          onClick={() => regenerate(link)}
                          className="text-[13px] text-btnPrimary me-[12px]"
                        >
                          {t('comms_new_code', 'New code')}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => deleteLink(link)}
                        className="text-[13px] text-red-500"
                      >
                        {t('remove', 'Remove')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
