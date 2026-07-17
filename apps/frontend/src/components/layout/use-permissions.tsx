'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

export interface EffectivePermissionsResponse {
  role: string | null;
  permissions: string[];
  isSuperAdmin: boolean;
}

export interface UsePermissionsResult {
  /** true once the permission set has been fetched (or fetching failed) */
  isLoaded: boolean;
  /** true only when the fetch finished successfully */
  isResolved: boolean;
  role: string | null;
  isSuperAdmin: boolean;
  isOwner: boolean;
  isAdmin: boolean;
  hasPermission: (resource: string, action: string) => boolean;
  refresh: () => void;
}

/**
 * Effective RBAC permissions for the acting member in the current org,
 * resolved server-side by GET /settings/roles/me (the same resolution the
 * backend OrgRbacGuard enforces with). `manage` on a resource implies every
 * action on it; platform super-admins pass every check.
 *
 * UI gating only — the backend remains the enforcement point (403).
 */
export const usePermissions = (): UsePermissionsResult => {
  const fetch = useFetch();

  const load = useCallback(async (): Promise<EffectivePermissionsResponse> => {
    const res = await fetch('/settings/roles/me');
    if (!res.ok) {
      throw new Error('Failed to load permissions');
    }
    return res.json();
  }, [fetch]);

  const { data, error, isLoading, mutate } =
    useSWR<EffectivePermissionsResponse>('/settings/roles/me', load, {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    });

  const hasPermission = useCallback(
    (resource: string, action: string): boolean => {
      if (!data) {
        return false;
      }
      if (data.isSuperAdmin) {
        return true;
      }
      const permissions = Array.isArray(data.permissions)
        ? data.permissions
        : [];
      return (
        permissions.includes(`${resource}:manage`) ||
        permissions.includes(`${resource}:${action}`)
      );
    },
    [data]
  );

  const refresh = useCallback(() => {
    mutate();
  }, [mutate]);

  return {
    isLoaded: !isLoading && (data !== undefined || error !== undefined),
    isResolved: data !== undefined,
    role: data?.role ?? null,
    isSuperAdmin: data?.isSuperAdmin ?? false,
    isOwner: data?.role === 'owner' || (data?.isSuperAdmin ?? false),
    isAdmin:
      data?.role === 'owner' ||
      data?.role === 'admin' ||
      (data?.isSuperAdmin ?? false),
    hasPermission,
    refresh,
  };
};
