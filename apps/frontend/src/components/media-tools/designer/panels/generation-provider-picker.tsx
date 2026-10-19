'use client';

import React, { FC, useCallback, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import {
  hasCompactStudio,
  type CompactOperation,
} from '@postmill-ai/frontend/components/media-tools/studio-kit/compact-registry';

// Shared "Provider:" dropdown for the Designer's generate-from-prompt dialogs.
// '' means the org default (today's behavior); any other value embeds that
// provider's compact studio. The last explicit choice is remembered per dialog
// in sessionStorage.

interface GenerationProvidersResponse {
  providers: { identifier: string; name: string }[];
  default: { providerId: string; model: string } | null;
}

const storageKey = (dialogKey: string) => `designer:gen-provider:${dialogKey}`;

function readStoredChoice(dialogKey: string): string {
  try {
    return sessionStorage.getItem(storageKey(dialogKey)) ?? '';
  } catch {
    return '';
  }
}

/** Last explicit provider choice per dialog, session-scoped ('' = org default). */
export function useGenerationProviderChoice(dialogKey: string): [string, (value: string) => void] {
  const [value, setValue] = useState(() => readStoredChoice(dialogKey));
  const set = useCallback(
    (next: string) => {
      setValue(next);
      try {
        if (next) sessionStorage.setItem(storageKey(dialogKey), next);
        else sessionStorage.removeItem(storageKey(dialogKey));
      } catch {
        // Private mode / SSR — the in-memory state still works for this mount.
      }
    },
    [dialogKey]
  );
  return [value, set];
}

// Operations the picker can query. `image|video|audio` embed compact studios;
// `avatar` (video-tab embed) and `tts` (dropdown-only, no studios) are fetched
// from the same endpoint.
export type ProviderPickerOperation = CompactOperation | 'avatar' | 'tts';

export function useGenerationProviders(operation: ProviderPickerOperation) {
  const fetch = useFetch();
  return useSWR<GenerationProvidersResponse>(
    `generation-providers:${operation}`,
    async () => {
      const res = await fetch(`/media/generation-providers?operation=${operation}`);
      // A non-OK response (e.g. the endpoint isn't deployed yet) must not break
      // the dialogs — degrade to the default-only path.
      if (!res.ok) return { providers: [], default: null };
      return (await res.json()) as GenerationProvidersResponse;
    },
    { revalidateOnFocus: false, shouldRetryOnError: false, dedupingInterval: 60000 }
  );
}

export const GenerationProviderPicker: FC<{
  operation: ProviderPickerOperation;
  dialogKey: string;
  value: string;
  onChange: (provider: string) => void;
  // true (default): only providers with a registered compact studio are listed.
  // Pass false for dropdown-only operations with no studios (TTS) — every
  // provider the server returns is a valid pin for the generate call.
  requireCompact?: boolean;
}> = ({ operation, dialogKey, value, onChange, requireCompact = true }) => {
  const t = useT();
  const { data } = useGenerationProviders(operation);

  // The server already filters providers to the operation; we additionally
  // keep only providers with a compact studio registered (unless opted out).
  const providers = (data?.providers ?? []).filter(
    (p) =>
      !requireCompact ||
      (operation !== 'tts' && hasCompactStudio(p.identifier, operation))
  );

  // Nothing to choose → hide the row entirely (the dialog is byte-identical to
  // the default-only experience).
  if (!data || providers.length === 0) return null;

  const selectId = `generation-provider-${dialogKey}`;
  const defaultLabel = data.default
    ? t('default_provider_model', 'Default ({{provider}}/{{model}})', {
        provider: data.default.providerId,
        model: data.default.model,
      })
    : t('default_provider', 'Default');
  // A remembered provider that is no longer listed stays visible so the user
  // can see (and change) the stale choice instead of silently falling back.
  const stale = value && !providers.some((p) => p.identifier === value);

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={selectId} className="text-[11px] text-newTextColor/65 shrink-0">
        {t('provider_label', 'Provider:')}
      </label>
      <select
        id={selectId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 min-w-0 px-2 py-1 rounded-lg border border-studioBorder bg-newBgColorInner text-textColor text-xs focus:outline-hidden focus:border-designerAccent"
      >
        <option value="">{defaultLabel}</option>
        {providers.map((p) => (
          <option key={p.identifier} value={p.identifier}>
            {p.name}
          </option>
        ))}
        {stale && <option value={value}>{value}</option>}
      </select>
    </div>
  );
};

export { hasCompactStudio };
