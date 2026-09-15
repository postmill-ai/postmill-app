'use client';

import useSWR from 'swr';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { createFetchError } from '@postmill-ai/frontend/components/settings/shared/fetch-error';
import type { CommsMember } from './member-picker';

export interface CommsCredentialField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  placeholder?: string;
  help?: string;
}

export interface CommsProvider {
  identifier: string;
  name: string;
  enabled: boolean;
  isConfigured: boolean;
  credentialFields: CommsCredentialField[];
  credentialsSet: Record<string, boolean>;
  /** Pinned provider-framework version (config's, else the manifest's), e.g. "v1". */
  version?: string;
  /** Kernel CommsAdapterCapabilities: webhookInbound / pollInbound / threads / webhookRegistration. */
  capabilities?: Record<string, boolean>;
  webhookUrl?: string;
  webhookRegistered?: boolean;
  webhookError?: string;
  setupNotes?: string;
  /** Numbered setup steps, rendered as the channels-style <ol> in the modal. */
  setupSteps?: string[];
  /** Provider app portal link (e.g. Slack API apps, BotFather). */
  portalUrl?: string;
  portalLabel?: string;
  /** Setup documentation link (top-right of the modal, next to the portal). */
  docsUrl?: string;
  /** Caption under the webhook URL field. */
  webhookInstructions?: string;
  /** Platform-app connect kind: slack='oauth', discord/telegram/line='env',
   *  matrix=absent (no platform app — always flat mode). */
  platformConnect?: 'oauth' | 'env';
  /** The deployment env supplies a platform app for this provider. */
  platformConfigured?: boolean;
  /** This org's config was made by the platform app (Slack OAuth / env
   *  platform-connect), not bring-your-own credentials. */
  platformConnected?: boolean;
  /** Platform app's shared webhook endpoint — only sent when the platform app
   *  is configured on the deployment (the route 404s otherwise). */
  platformWebhookUrl?: string;
}

export interface CommsLink {
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

export interface CommsConfigResponse {
  providers: CommsProvider[];
  links: CommsLink[];
  members: CommsMember[];
}

export type { CommsMember };

// One SWR key shared by the tab and the config modal — a bound mutate() in
// either revalidates both, so link/config edits inside the modal refresh the
// list behind it without prop threading.
export const COMMS_CONFIG_KEY = 'comms-config';

// Comms OAuth connect handshake. Provider consent pages may carry
// Cross-Origin-Opener-Policy (Slack: same-origin-allow-popups), which severs
// window.opener permanently — and wipes window.name — so the popup→opener
// completion signal goes through localStorage (shared same-origin, survives
// COOP), with postMessage as a fast path when the opener survives.
// window.close() still works in the script-opened popup after severing, so
// the close page always attempts it. The popup name is only a window handle
// (reuses one popup across connects), not a signal.
export const COMMS_CONNECTED_STORAGE_KEY = 'postmill:comms-connected';
export const COMMS_OAUTH_POPUP_NAME = 'postmill-comms-oauth';
// Set (sessionStorage, i.e. this tab only) right before the popup-blocked
// full-page fallback navigates away, so the close page knows it IS the
// user's tab and must not window.close() it. A script-opened popup never
// carries it: it is written only after window.open() has already failed.
export const COMMS_FULLPAGE_STORAGE_KEY = 'postmill:comms-oauth-fullpage';
// How long the opener keeps listening for the close page's signal after the
// popup handle reports closed. COOP swaps on the provider's consent pages
// make `popup.closed` true within seconds of opening — long before the user
// finishes — so a closed handle is not evidence the flow ended.
export const COMMS_CONNECT_GRACE_MS = 10 * 60 * 1000;

export const useCommsConfig = () => {
  const fetch = useFetch();
  return useSWR<CommsConfigResponse>(
    COMMS_CONFIG_KEY,
    () =>
      fetch('/settings/comms/config').then((r) => {
        if (!r.ok) {
          throw createFetchError('comms_load_failed', 'Failed to load comms settings');
        }
        return r.json();
      }),
    { revalidateOnFocus: false, revalidateOnReconnect: false }
  );
};
