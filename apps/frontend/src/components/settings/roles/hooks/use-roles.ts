'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { createFetchError } from '../../shared/fetch-error';

export interface PermissionItem {
  id: string;
  resource: string;
  action: string;
  description?: string | null;
}

export interface RolePermissionLink {
  permission: PermissionItem;
}

export interface RoleItem {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  isSystem: boolean;
  organizationId?: string | null;
  permissions: RolePermissionLink[];
}

export interface TeamMemberItem {
  roleId: string | null;
  user: {
    id: string;
    email: string;
    profile?: { name?: string | null } | null;
  };
}

export const useRoles = () => {
  const fetch = useFetch();
  const load = useCallback(async (): Promise<RoleItem[]> => {
    const res = await fetch('/settings/roles');
    if (!res.ok) throw createFetchError('failed_to_load_roles', 'Failed to load roles');
    return res.json();
  }, [fetch]);
  return useSWR<RoleItem[]>('/settings/roles', load, {
    revalidateOnFocus: false,
  });
};

export const usePermissionsCatalog = () => {
  const fetch = useFetch();
  const load = useCallback(async (): Promise<PermissionItem[]> => {
    const res = await fetch('/settings/roles/permissions');
    if (!res.ok) throw createFetchError('failed_to_load_permissions_catalog', 'Failed to load permissions catalog');
    return res.json();
  }, [fetch]);
  return useSWR<PermissionItem[]>('/settings/roles/permissions', load, {
    revalidateOnFocus: false,
  });
};

export const useTeamMembers = () => {
  const fetch = useFetch();
  const load = useCallback(async (): Promise<TeamMemberItem[]> => {
    const res = await fetch('/settings/team');
    if (!res.ok) throw createFetchError('failed_to_load_team', 'Failed to load team');
    const data: { users?: TeamMemberItem[] } = await res.json();
    return data.users || [];
  }, [fetch]);
  return useSWR<TeamMemberItem[]>('/settings/team/roles-tab', load, {
    revalidateOnFocus: false,
  });
};
