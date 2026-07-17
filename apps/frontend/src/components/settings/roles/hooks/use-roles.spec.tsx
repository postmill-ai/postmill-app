import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Fetcher = () => Promise<unknown>;

const captured: Record<string, Fetcher> = {};

vi.mock('swr', () => ({
  default: (key: string, fetcher: Fetcher) => {
    captured[key] = fetcher;
    return { data: undefined, isLoading: false, mutate: vi.fn() };
  },
}));

const mockFetch = vi.fn();
vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));

import { useRoles, usePermissionsCatalog, useTeamMembers } from './use-roles';

describe('roles SWR hooks', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    for (const key of Object.keys(captured)) {
      delete captured[key];
    }
  });

  describe('useRoles', () => {
    it('fetches GET /settings/roles', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([{ id: 'r1' }]),
      });
      renderHook(() => useRoles());
      const result = await captured['/settings/roles']();
      expect(mockFetch).toHaveBeenCalledWith('/settings/roles');
      expect(result).toEqual([{ id: 'r1' }]);
    });

    it('throws on a failed response', async () => {
      mockFetch.mockResolvedValue({ ok: false });
      renderHook(() => useRoles());
      await expect(captured['/settings/roles']()).rejects.toThrow(
        'Failed to load roles'
      );
    });
  });

  describe('usePermissionsCatalog', () => {
    it('fetches GET /settings/roles/permissions', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([{ id: 'p1' }]),
      });
      renderHook(() => usePermissionsCatalog());
      const result = await captured['/settings/roles/permissions']();
      expect(mockFetch).toHaveBeenCalledWith('/settings/roles/permissions');
      expect(result).toEqual([{ id: 'p1' }]);
    });

    it('throws on a failed response', async () => {
      mockFetch.mockResolvedValue({ ok: false });
      renderHook(() => usePermissionsCatalog());
      await expect(
        captured['/settings/roles/permissions']()
      ).rejects.toThrow('Failed to load permissions catalog');
    });
  });

  describe('useTeamMembers', () => {
    it('fetches GET /settings/team and unwraps users', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ users: [{ roleId: null, user: { id: 'u1' } }] }),
      });
      renderHook(() => useTeamMembers());
      const result = await captured['/settings/team/roles-tab']();
      expect(mockFetch).toHaveBeenCalledWith('/settings/team');
      expect(result).toEqual([{ roleId: null, user: { id: 'u1' } }]);
    });

    it('defaults to an empty list when users is missing', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });
      renderHook(() => useTeamMembers());
      expect(await captured['/settings/team/roles-tab']()).toEqual([]);
    });

    it('throws on a failed response', async () => {
      mockFetch.mockResolvedValue({ ok: false });
      renderHook(() => useTeamMembers());
      await expect(captured['/settings/team/roles-tab']()).rejects.toThrow(
        'Failed to load team'
      );
    });
  });
});
