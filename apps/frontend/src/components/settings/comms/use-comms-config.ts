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
