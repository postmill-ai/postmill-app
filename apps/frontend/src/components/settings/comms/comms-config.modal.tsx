'use client';

import React, { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

// Per-provider comms config, mirroring the channels' ChannelConfigForm:
// - Platform mode (platformConfigured && platformConnect): a full-width
//   Connect button (Slack OAuth popup, or one-click "Use the Postmill app"
//   for env-driven providers) is the whole story; setup steps, webhook,
//   credential fields and the enabled switch collapse under Advanced.
// - Flat mode (no platformConnect — always the case for Matrix): numbered
//   setup steps up top, then webhook block, credential fields, enabled.
// Member links live here too — the comms analog of channels showing the
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

  // Mode A of this form (mirrors channels' hasPlatformApp): the deployment
  // env supplies a platform app that can drive the connect flow.
  const platformMode = !!(provider.platformConfigured && provider.platformConnect);

  const [values, setValues] = useState<Record<string, string>>({});
  const [enabled, setEnabled] = useState(provider.enabled);
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [webhookCopied, setWebhookCopied] = useState(false);
  const [issuedCode, setIssuedCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [newUserId, setNewUserId] = useState<string | undefined>();
  const [newCategories, setNewCategories] = useState<Record<string, boolean>>({});
  const [newAgentChat, setNewAgentChat] = useState(true);
  const [creating, setCreating] = useState(false);
  // With a platform app configured, everything but Connect lives under the
  // Advanced section — expanded only when this provider already has stored
  // credentials (a BYO-app provider being edited). Mirrors channels'
  // showAdvanced default.
  const [showAdvanced, setShowAdvanced] = useState(provider.isConfigured);

  // The webhook URL must exist DURING setup (the portal asks for it before
  // the provider is saved), so mint a placeholder as soon as the modal opens
  // for an unconfigured webhook-driven provider. Idempotent on the backend.
  const webhookMinted = useRef(false);
  useEffect(() => {
    if (webhookMinted.current) return;
    if (provider.isConfigured || !provider.capabilities?.webhookInbound) return;
    if (provider.webhookUrl || provider.platformWebhookUrl) return;
    webhookMinted.current = true;
    void (async () => {
      const res = await fetch(`/settings/comms/config/${identifier}/webhook`, {
        method: 'POST',
        body: JSON.stringify({}),
      }).catch(() => null);
      if (res?.ok) {
        // Refetch so provider.webhookUrl picks up the minted placeholder and
        // the read-only copy field below shows it.
        await mutate();
      }
    })();
  }, [provider, fetch, identifier, mutate]);

  // OAuth popup listeners/poll registered by handleConnect — removed on
  // unmount so a modal closed mid-flow cannot refetch a dead SWR cache.
  const connectCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => connectCleanup.current?.(), []);

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

  // OAuth platform connect (Slack): fetch the consent URL, then run the flow
  // in a small popup window — the same mechanics as channels' handleConnect.
  // The callback page notifies this opener with a postMessage and closes
  // itself; the poll is the fallback for a missed message / manual close.
  const handleConnect = useCallback(async () => {
    setConnectError(null);
    setConnecting(true);
    try {
      const response = await fetch(`/settings/comms/oauth/${identifier}/url`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.url) {
        toaster.show(
          t('could_not_connect_to_platform', 'Could not connect to the platform'),
          'warning'
        );
        return;
      }
      const popup = window.open(data.url, 'postmill-comms-oauth', 'width=640,height=720,popup');
      if (!popup) {
        // Popup blocked — fall back to the standard full-page OAuth redirect.
        window.location.href = data.url;
        return;
      }
      const poll = window.setInterval(() => {
        if (popup.closed) {
          cleanup();
          // Refresh without closing: the connect may have completed.
          void mutate();
        }
      }, 1000);
      const onMessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        if ((event.data as { type?: string })?.type !== 'postmill:comms-connected') return;
        cleanup();
        void (async () => {
          toaster.show(t('comms_connected', 'Provider connected'), 'success');
          await mutate();
          onClose();
        })();
      };
      const cleanup = () => {
        window.removeEventListener('message', onMessage);
        window.clearInterval(poll);
        connectCleanup.current = null;
      };
      connectCleanup.current = cleanup;
      window.addEventListener('message', onMessage);
    } finally {
      setConnecting(false);
    }
  }, [fetch, identifier, toaster, t, mutate, onClose]);

  // Env platform connect (Discord/Telegram/LINE): the platform app in the
  // deployment env IS the credential — one click wires the provider up.
  const handlePlatformConnect = useCallback(async () => {
    setConnectError(null);
    setConnecting(true);
    try {
      const res = await fetch(`/settings/comms/platform-connect/${identifier}`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // The backend's reason is the useful part — show it verbatim.
        // ValidationPipe 400s return message as a string ARRAY.
        const raw = body.message;
        setConnectError(
          (Array.isArray(raw) ? raw.join(', ') : raw) ||
            t('could_not_connect_to_platform', 'Could not connect to the platform')
        );
        return;
      }
      toaster.show(t('comms_connected', 'Provider connected'), 'success');
      await mutate();
    } finally {
      setConnecting(false);
    }
  }, [fetch, identifier, toaster, t, mutate]);

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

  // The displayed webhook URL: the org's registered one, else the platform
  // app's shared endpoint.
  const webhookUrl = provider.webhookUrl || provider.platformWebhookUrl;

  const copyWebhook = useCallback(async () => {
    if (!webhookUrl) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setWebhookCopied(true);
      setTimeout(() => setWebhookCopied(false), 2000);
    } catch {
      toaster.show(t('copy_failed', 'Copy failed'), 'warning');
    }
  }, [webhookUrl, toaster, t]);

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

  // ── Layout blocks (shared by both modes) ────────────────────────────────

  // Top-right links row: the provider's app portal and the setup docs, styled
  // like the channels portal link.
  const portalLinkBlock = (provider.portalUrl || provider.docsUrl) && (
    <div className="flex justify-end gap-[12px]">
      {provider.portalUrl && (
        <a
          href={provider.portalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[12px] text-textColor underline hover:opacity-80"
        >
          {provider.portalLabel || provider.portalUrl}
        </a>
      )}
      {provider.docsUrl && (
        <a
          href={provider.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[12px] text-textColor underline hover:opacity-80"
        >
          {t('comms_docs_link', 'Docs')}
        </a>
      )}
    </div>
  );

  // Numbered setup steps (channels-style <ol>); a provider may additionally
  // keep a free-form note, rendered as a small caption after the steps.
  const setupStepsBlock = (!!provider.setupSteps?.length || !!provider.setupNotes) && (
    <div className="flex flex-col gap-[6px] bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[12px]">
      <label className="text-[13px] font-[500]">{t('setup_steps', 'How to set this up')}</label>
      {!!provider.setupSteps?.length && (
        <ol className="flex flex-col gap-[4px] list-decimal ps-[18px]">
          {provider.setupSteps.map((step, idx) => (
            <li key={idx} className="text-[13px] text-newTableText">
              {step}
            </li>
          ))}
        </ol>
      )}
      {!!provider.setupNotes && (
        <div className="text-[12px] text-newTableText">{provider.setupNotes}</div>
      )}
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

  // Platform connect: the default (and only primary) action in platform mode.
  // OAuth providers (Slack) run a consent popup; env providers wire up the
  // deployment's Postmill app with one click.
  const connectBlock = platformMode && (
    <div className="flex flex-col gap-[6px]">
      <button
        type="button"
        onClick={provider.platformConnect === 'oauth' ? handleConnect : handlePlatformConnect}
        disabled={busy || connecting}
        className="w-full h-[44px] rounded-[8px] bg-btnPrimary text-white text-[14px] font-[500] whitespace-nowrap truncate hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {connecting
          ? t('connecting', 'Connecting...')
          : provider.platformConnect === 'oauth'
            ? t('connect_with_provider', 'Connect with {{provider}}', { provider: provider.name })
            : t('comms_use_postmill_app', 'Use the Postmill app')}
      </button>
      <div className="text-[12px] text-newTableText text-center">
        {t('uses_postmill_app_no_setup', 'Uses the Postmill app — no setup needed')}
      </div>
      {connectError && <div className="text-[12px] text-red-500">{connectError}</div>}
    </div>
  );

  const webhookBlock = !!webhookUrl && (
    <div className="flex flex-col gap-[6px]">
      <label className="text-[13px] font-[500]">{t('comms_webhook_url', 'Webhook URL')}</label>
      <div className="flex gap-[8px] items-center">
        <div className="bg-newBgColorInner h-[42px] border-newTableBorder border rounded-[8px] text-textColor flex items-center justify-center flex-1 min-w-0">
          <input
            readOnly
            className="h-full bg-transparent outline-hidden flex-1 min-w-0 text-[14px] text-textColor px-[16px]"
            value={webhookUrl}
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
      {provider.webhookInstructions && (
        <div className="text-[12px] text-newTableText">{provider.webhookInstructions}</div>
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

  // ── Platform mode: Connect is the whole story; everything else is
  // collapsed under Advanced (mirrors channels' Mode A). ────────────────────
  if (platformMode) {
    return (
      <div className="flex flex-col gap-[16px] min-w-[460px] mobile:min-w-0">
        {portalLinkBlock}
        {connectBlock}
        <div className="rounded-[8px] border border-newTableBorder">
          <button
            type="button"
            aria-expanded={showAdvanced}
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex w-full items-center justify-between px-[12px] py-[10px] text-[13px] font-[500] text-textColor"
          >
            {t('advanced', 'Advanced')}
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={showAdvanced ? 'rotate-180 transition-transform' : 'transition-transform'}
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          {showAdvanced && (
            <div className="flex flex-col gap-[12px] border-t border-newTableBorder p-[12px]">
              {setupStepsBlock}
              {webhookBlock}
              {credentialFieldsBlock}
              {enabledBlock}
            </div>
          )}
        </div>
        {linksBlock}
        {footerBlock}
      </div>
    );
  }

  // ── Flat mode: no platform app — everything is the primary content
  // (mirrors channels' Mode B). ─────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-[16px] min-w-[460px] mobile:min-w-0">
      {portalLinkBlock}
      {setupStepsBlock}
      {webhookBlock}
      {credentialFieldsBlock}
      {enabledBlock}
      {linksBlock}
      {footerBlock}
    </div>
  );
};
