'use client';

import { useCallback } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useDecisionModal } from '@gitroom/frontend/components/layout/new-modal';
import useSWR from 'swr';
import { ProviderSurfaceDescriptor } from './provider-surface.types';

/**
 * One hook per surface (plan §1.3) — satisfies `react-hooks/rules-of-hooks` and
 * the AGENTS.md "one hook per resource" rule (the resource is the surface). The
 * `set-active` route is reused for "Make Primary" (no new endpoint); `toggle`
 * uses the existing `PUT …/config/:id` upsert with `{ enabled }`.
 */
export function useProviderSurface<Meta = any>(
  descriptor: ProviderSurfaceDescriptor<Meta>,
) {
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();
  const decision = useDecisionModal();

  const swr = useSWR(
    descriptor.swrKey,
    () => descriptor.load(fetch),
    { revalidateOnFocus: false },
  );
  const { mutate } = swr;
  const base = descriptor.basePath;

  const setPrimary = useCallback(
    async (id: string, version?: string) => {
      const res = await fetch(`${base}/config/${id}/set-active`, {
        method: 'POST',
        body: JSON.stringify(version ? { version } : {}),
      });
      if (!res.ok) {
        const err = await res.text();
        toaster.show(
          err || t('set_active_failed', 'Failed to set active provider'),
          'warning',
        );
        return false;
      }
      toaster.show(t('provider_activated', 'Provider activated'), 'success');
      mutate();
      return true;
    },
    [fetch, base, mutate, toaster, t],
  );

  const toggle = useCallback(
    async (id: string, enabled: boolean) => {
      const res = await fetch(`${base}/config/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        toaster.show(t('save_failed', 'Failed to save'), 'warning');
        return false;
      }
      mutate();
      return true;
    },
    [fetch, base, mutate, toaster, t],
  );

  const remove = useCallback(
    async (id: string) => {
      const approved = await decision.open({
        title: t('remove_configuration', 'Remove configuration?'),
        description: t(
          'confirm_remove',
          'Are you sure you want to remove this configuration?',
        ),
        approveLabel: t('remove', 'Remove'),
        cancelLabel: t('cancel', 'Cancel'),
      });
      if (!approved) {
        return false;
      }
      const res = await fetch(`${base}/config/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        toaster.show(t('delete_failed', 'Failed to delete'), 'warning');
        return false;
      }
      toaster.show(t('deleted', 'Configuration deleted'), 'success');
      mutate();
      return true;
    },
    [fetch, base, mutate, toaster, t, decision],
  );

  const save = useCallback(
    async (id: string, body: any) => {
      const res = await fetch(`${base}/config/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        toaster.show(t('save_failed', 'Failed to save'), 'warning');
        return false;
      }
      toaster.show(t('saved', 'Configuration saved'), 'success');
      mutate();
      return true;
    },
    [fetch, base, mutate, toaster, t],
  );

  const test = useCallback(
    async (id: string, body: any) => {
      try {
        const res = await fetch(`${base}/config/${id}/test`, {
          method: 'POST',
          body: JSON.stringify(body ?? {}),
        });
        // Some surfaces (media, content-packs) return HTTP 200 with `{ ok: false }`
        // on a failed connection; others throw a non-2xx. Honor both: a non-2xx
        // OR an explicit `ok === false` in the body is a failure.
        let ok = res.ok;
        if (ok) {
          try {
            const data = await res.clone().json();
            if (data && data.ok === false) ok = false;
          } catch {
            /* non-JSON success body — treat 2xx as success */
          }
        }
        if (ok) {
          toaster.show(t('connection_successful', 'Connection successful!'), 'success');
          return true;
        }
        toaster.show(t('connection_failed', 'Connection failed'), 'warning');
        return false;
      } catch {
        toaster.show(t('connection_failed', 'Connection failed'), 'warning');
        return false;
      }
    },
    [fetch, base, toaster, t],
  );

  return { ...swr, setPrimary, toggle, remove, save, test };
}
