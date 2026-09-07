'use client';

import React, { FC, useCallback, useMemo, useState } from 'react';
import { Button } from '@postmill-ai/react/form/button';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { useDecisionModal } from '@postmill-ai/frontend/components/layout/new-modal';
import { CategoryChecklist } from './category-checklist';
import { MemberPicker, CommsMember } from './member-picker';
import { CommsLink, CommsProvider, useCommsConfig } from './use-comms-config';

const CODE_INSTRUCTIONS: Record<string, [string, string]> = {
  slack: ['comms_code_instructions_slack', 'Open a DM with the bot in Slack and send: link {code}'],
  telegram: ['comms_code_instructions_telegram', 'Open a chat with the bot in Telegram and send: link {code}'],
  discord: ['comms_code_instructions_discord', 'In Discord, run: /postmill message: link {code}'],
  matrix: ['comms_code_instructions_matrix', 'Invite the bot to a direct room in Matrix and send: link {code}'],
  line: ['comms_code_instructions_line', 'Add the bot as a friend on LINE and send: link {code}'],
};

// Loader shell: resolves the provider/links/members from the shared SWR cache
// and mounts the stateful form only once the provider is known, so the form's
// initial state (e.g. the enabled switch) is derived from real data.
export const CommsConfigForm: FC<{
  identifier: string;
  onClose: () => void;
}> = ({ identifier, onClose }) => {
  const { data } = useCommsConfig();

  const provider = useMemo(
    () => data?.providers.find((p) => p.identifier === identifier),
    [data, identifier]
  );
  const links = useMemo(
    () => (data?.links ?? []).filter((l) => l.identifier === identifier),
    [data, identifier]
  );
  const members = useMemo(() => data?.members ?? [], [data]);

  if (!provider) return null;
  return (
    <CommsConfigFormInner
      provider={provider}
      links={links}
      members={members}
      onClose={onClose}
    />
  );
};

// Per-provider comms config, modeled on the channels' ChannelConfigForm:
// credential fields, enabled switch (configured sets only — a set must not be
// enabled before it is set up), webhook block, footer Cancel | Remove/Test/
// Save. Member links live here too — the comms analog of channels showing the
// connected accounts per credential set.
const CommsConfigFormInner: FC<{
  provider: CommsProvider;
  links: CommsLink[];
  members: CommsMember[];
  onClose: () => void;
}> = ({ provider, links, members, onClose }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const decision = useDecisionModal();
  const { mutate } = useCommsConfig();
  const { identifier } = provider;

  const [values, setValues] = useState<Record<string, string>>({});
  const [enabled, setEnabled] = useState(provider.enabled);
  const [busy, setBusy] = useState(false);
  const [webhookCopied, setWebhookCopied] = useState(false);
  const [issuedCode, setIssuedCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [newUserId, setNewUserId] = useState<string | undefined>();
  const [newCategories, setNewCategories] = useState<Record<string, boolean>>({});
  const [newAgentChat, setNewAgentChat] = useState(true);
  const [creating, setCreating] = useState(false);

  const handleSave = useCallback(async () => {
    // Required credentials must be present — either newly typed or already
    // stored (blank keeps the stored value).
    for (const field of provider.credentialFields) {
      if (
        field.required &&
        !(values[field.key] || '').trim() &&
        !provider.credentialsSet[field.key]
      ) {
        toaster.show(
          t('comms_credential_required', 'Please enter {{field}} before saving.', {
            field: field.label,
          }),
          'warning'
        );
        return;
      }
    }
    setBusy(true);
    try {
      const credentials = Object.fromEntries(
        Object.entries(values).filter(([, v]) => v.trim())
      );
      const res = await fetch(`/settings/comms/config/${identifier}`, {
        method: 'PUT',
        body: JSON.stringify({
          credentials,
          // First save with valid credentials sets the provider up, so enable
          // it; afterwards the switch carries the flag.
          enabled: provider.isConfigured ? enabled : true,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        toaster.show(text || t('request_failed', 'Request failed'), 'warning');
        return;
      }
      toaster.show(t('comms_provider_saved', 'Provider saved'), 'success');
      await mutate();
      onClose();
    } finally {
      setBusy(false);
    }
  }, [provider, values, enabled, fetch, identifier, toaster, t, mutate, onClose]);

  const handleTest = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`/settings/comms/config/${identifier}/test`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => ({}));
      toaster.show(
        res.ok && json.ok
          ? t('comms_test_ok', 'Connection OK')
          : json.error || t('comms_test_failed', 'Connection failed'),
        res.ok && json.ok ? 'success' : 'warning'
      );
    } finally {
      setBusy(false);
    }
  }, [fetch, identifier, toaster, t]);

  const handleRemove = useCallback(async () => {
    const approved = await decision.open({
      description: t('comms_remove_confirm', 'Remove this provider and its user links?'),
    });
    if (!approved) return;
    setBusy(true);
    try {
      const res = await fetch(`/settings/comms/config/${identifier}`, { method: 'DELETE' });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        toaster.show(text || t('request_failed', 'Request failed'), 'warning');
        return;
      }
      toaster.show(t('comms_provider_removed', 'Provider removed'), 'success');
      await mutate();
      onClose();
    } finally {
      setBusy(false);
    }
  }, [decision, fetch, identifier, toaster, t, mutate, onClose]);

  const copyWebhook = useCallback(async () => {
    if (!provider.webhookUrl) return;
    try {
      await navigator.clipboard.writeText(provider.webhookUrl);
      setWebhookCopied(true);
      setTimeout(() => setWebhookCopied(false), 2000);
    } catch {
      toaster.show(t('copy_failed', 'Copy failed'), 'warning');
    }
  }, [provider, toaster, t]);

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
    [fetch, toaster, t, mutate]
  );

  const createLink = useCallback(async () => {
    if (!newUserId) {
      toaster.show(t('comms_link_missing_fields', 'Pick a member and a provider first'), 'warning');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/settings/comms/links', {
        method: 'POST',
        body: JSON.stringify({
          identifier,
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
      setIssuedCode({ code: json.connectCode, expiresAt: json.expiresAt });
      setAdding(false);
      setNewUserId(undefined);
      setNewCategories({});
      setNewAgentChat(true);
      await mutate();
    } finally {
      setCreating(false);
    }
  }, [fetch, toaster, t, mutate, identifier, newUserId, newAgentChat, newCategories]);

  const regenerate = useCallback(
    async (link: CommsLink) => {
      const res = await linkAction(`/settings/comms/links/${link.id}/regenerate-code`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (!res) return;
      const json = await res.json();
      setIssuedCode({ code: json.connectCode, expiresAt: json.expiresAt });
    },
    [linkAction]
  );

  const toggleAgentChat = useCallback(
    (link: CommsLink) =>
      linkAction(`/settings/comms/links/${link.id}`, {
        method: 'PUT',
        body: JSON.stringify({ agentChatEnabled: !link.agentChatEnabled }),
      }),
    [linkAction]
  );

  const deleteLink = useCallback(
    async (link: CommsLink) => {
      const approved = await decision.open({
        description: t('comms_link_delete_confirm', 'Remove this link?'),
      });
      if (!approved) return;
      return linkAction(`/settings/comms/links/${link.id}`, { method: 'DELETE' });
    },
    [linkAction, decision, t]
  );

  const setupNotesBlock = !!provider.setupNotes && (
    <div className="flex flex-col gap-[6px] bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[12px]">
      <label className="text-[13px] font-[500]">{t('setup_steps', 'How to set this up')}</label>
      <div className="text-[13px] text-newTableText">{provider.setupNotes}</div>
    </div>
  );

  const credentialFieldsBlock = provider.credentialFields.map((field) => (
    <div key={field.key} className="flex flex-col gap-[6px]">
      <label className="text-[14px] font-[500]">
        {field.label}
        {field.required && <span className="text-red-500"> *</span>}
      </label>
      <div className="bg-newBgColorInner h-[42px] border-newTableBorder border rounded-[8px] text-textColor flex items-center justify-center">
        <input
          type={field.type === 'password' ? 'password' : 'text'}
          // Keep browser password managers out of credential fields (same
          // reason as the channels form: autofilled account email would
          // silently overwrite the stored credential on save).
          autoComplete="off"
          name={`cred_${field.key}_${identifier}`}
          className="h-full bg-transparent outline-hidden flex-1 text-[14px] text-textColor placeholder-textColor px-[16px]"
          placeholder={
            provider.credentialsSet[field.key]
              ? t('comms_credential_saved', '•••••• (saved — leave blank to keep)')
              : field.placeholder || ''
          }
          value={values[field.key] ?? ''}
          onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
        />
      </div>
      {field.help && <div className="text-[12px] text-newTableText">{field.help}</div>}
    </div>
  ));

  // Enabling only makes sense once the provider is set up — the switch is
  // configured-mode only, styled like the channels/VPN toggles.
  const enabledBlock = provider.isConfigured && (
    <div className="flex items-center gap-[8px]">
      <label className="text-[13px] font-[500]">{t('enabled', 'Enabled')}</label>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={() => setEnabled((v) => !v)}
        className="flex items-center gap-[8px]"
      >
        <span
          className={`relative w-[40px] h-[22px] rounded-full transition-colors ${
            enabled ? 'bg-btnPrimary' : 'bg-newTableBorder'
          }`}
        >
          <span
            className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] rounded-full bg-white transition-transform ${
              enabled ? 'translate-x-[18px]' : 'translate-x-0'
            }`}
          />
        </span>
      </button>
    </div>
  );

  const webhookBlock = !!provider.webhookUrl && (
    <div className="flex flex-col gap-[6px]">
      <label className="text-[13px] font-[500]">{t('comms_webhook_url', 'Webhook URL')}</label>
      <div className="flex gap-[8px] items-center">
        <div className="bg-newBgColorInner h-[42px] border-newTableBorder border rounded-[8px] text-textColor flex items-center justify-center flex-1 min-w-0">
          <input
            readOnly
            className="h-full bg-transparent outline-hidden flex-1 min-w-0 text-[14px] text-textColor px-[16px]"
            value={provider.webhookUrl}
          />
        </div>
        <Button
          type="button"
          className="bg-transparent! border border-newTableBorder text-textColor text-[12px] whitespace-nowrap"
          onClick={copyWebhook}
        >
          {webhookCopied ? t('copied', 'Copied') : t('copy', 'Copy')}
        </Button>
      </div>
      {provider.webhookRegistered === false && (
        <div className="text-[12px] text-amber-500">
          {t('comms_webhook_pending', 'Webhook not registered')}
          {provider.webhookError ? ` — ${provider.webhookError}` : ''}
        </div>
      )}
    </div>
  );

  const linksBlock = provider.isConfigured && (
    <div className="flex flex-col gap-[10px] border-t border-newTableBorder pt-[12px]">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-[2px]">
          <label className="text-[13px] font-[500]">{t('comms_links_title', 'User links')}</label>
          <div className="text-[12px] text-newTableText">
            {t(
              'comms_links_description',
              'Link a team member to this app for agent conversations and notifications.'
            )}
          </div>
        </div>
        <button
          type="button"
          data-testid="comms-add-link"
          onClick={() => setAdding((a) => !a)}
          className="text-[13px] px-[12px] py-[6px] rounded-[8px] bg-btnPrimary text-white hover:opacity-90 transition-opacity whitespace-nowrap"
        >
          {t('comms_add_link', 'Add link')}
        </button>
      </div>

      {issuedCode && (
        <div className="bg-newBgColorInner border border-btnPrimary/40 rounded-[8px] p-[12px] flex flex-col gap-[8px]">
          <div className="text-[13px] font-[600] text-textColor">
            {t('comms_code_title', 'One-time connect code')}
          </div>
          <div className="flex items-center gap-[8px]">
            <code
              data-testid="comms-connect-code"
              className="px-[12px] py-[8px] bg-newBgColor border border-newTableBorder rounded-[8px] text-[16px] tracking-[4px]"
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
              CODE_INSTRUCTIONS[identifier]?.[0] ?? 'comms_code_instructions',
              CODE_INSTRUCTIONS[identifier]?.[1] ?? 'Send the bot: link {code}'
            ).replace('{code}', issuedCode.code)}
          </div>
          <div className="text-[12px] text-textColor/50">
            {t('comms_code_expiry', 'The code is shown once and expires in 15 minutes.')}
          </div>
        </div>
      )}

      {adding && (
        <div className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[12px] flex flex-col gap-[10px]">
          <div className="flex flex-col gap-[4px]">
            <label className="text-[13px] text-textColor">{t('comms_member', 'Team member')} *</label>
            <MemberPicker members={members} value={newUserId} onChange={setNewUserId} />
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
            {creating ? t('creating', 'Creating…') : t('comms_create_link', 'Create link')}
          </button>
        </div>
      )}

      {links.length === 0 ? (
        <div className="text-[13px] text-textColor/60">{t('comms_no_links', 'No user links yet.')}</div>
      ) : (
        links.map((link) => (
          <div
            key={link.id}
            className="border border-newTableBorder rounded-[8px] p-[10px] flex flex-col gap-[6px]"
          >
            <div className="flex items-center justify-between gap-[8px]">
              <span className="text-[13px] text-textColor truncate">
                {link.userName || link.userEmail}
                {link.externalDisplayName && (
                  <span className="text-textColor/50"> · {link.externalDisplayName}</span>
                )}
              </span>
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
            </div>
            <div className="flex items-center justify-between gap-[8px] flex-wrap">
              <div className="flex items-center gap-[10px]">
                <label className="flex items-center gap-[6px] cursor-pointer text-[12px] text-textColor">
                  <input
                    type="checkbox"
                    aria-label={t('comms_agent_chat', 'Agent chat')}
                    className="accent-btnPrimary w-[14px] h-[14px]"
                    checked={link.agentChatEnabled}
                    onChange={() => toggleAgentChat(link)}
                  />
                  {t('comms_agent_chat', 'Agent chat')}
                </label>
                <span className="text-[12px] text-textColor/70">
                  {t('comms_categories_count', 'Notifications {{on}}/{{total}}', {
                    on: String(Object.values(link.categories).filter(Boolean).length),
                    total: String(Object.keys(link.categories).length || 10),
                  })}
                </span>
              </div>
              <div className="flex items-center gap-[10px]">
                {link.status === 'pending' && (
                  <button
                    type="button"
                    onClick={() => regenerate(link)}
                    className="text-[12px] text-btnPrimary"
                  >
                    {t('comms_new_code', 'New code')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => deleteLink(link)}
                  className="text-[12px] text-red-500"
                >
                  {t('remove', 'Remove')}
                </button>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );

  const footerBlock = (
    <div className="flex gap-[8px] justify-between items-center mt-[8px]">
      <div className="flex gap-[8px]">
        <Button
          type="button"
          className="bg-transparent! border border-newTableBorder text-textColor"
          onClick={onClose}
        >
          {t('cancel', 'Cancel')}
        </Button>
      </div>
      <div className="flex gap-[8px]">
        {provider.isConfigured && (
          <>
            <Button
              type="button"
              className="bg-transparent! border border-red-500/30 text-dangerText text-[12px]"
              onClick={handleRemove}
              disabled={busy}
            >
              {t('remove', 'Remove')}
            </Button>
            <Button
              type="button"
              className="bg-transparent! border border-newTableBorder text-textColor text-[12px]"
              onClick={handleTest}
              disabled={busy}
            >
              {t('test', 'Test')}
            </Button>
          </>
        )}
        <Button type="button" onClick={handleSave} disabled={busy}>
          {busy ? t('saving', 'Saving...') : t('save', 'Save')}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-[16px] min-w-[460px] mobile:min-w-0">
      {setupNotesBlock}
      {credentialFieldsBlock}
      {enabledBlock}
      {webhookBlock}
      {linksBlock}
      {footerBlock}
    </div>
  );
};
