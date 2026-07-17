import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EffectivePermissionsResponse } from './use-permissions';

let mockData: EffectivePermissionsResponse | undefined;
let mockError: Error | undefined;
let mockIsLoading = false;
const mockMutate = vi.fn();
let capturedKey: string | undefined;
let capturedFetcher: (() => Promise<EffectivePermissionsResponse>) | undefined;

vi.mock('swr', () => ({
  default: (key: string, fetcher: () => Promise<EffectivePermissionsResponse>) => {
    capturedKey = key;
    capturedFetcher = fetcher;
    return {
      data: mockData,
      error: mockError,
      isLoading: mockIsLoading,
      mutate: mockMutate,
    };
  },
}));

const mockFetch = vi.fn();
vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));

import { usePermissions } from './use-permissions';

describe('usePermissions', () => {
  beforeEach(() => {
    mockData = undefined;
    mockError = undefined;
    mockIsLoading = false;
    capturedKey = undefined;
    capturedFetcher = undefined;
    mockFetch.mockReset();
    mockMutate.mockReset();
  });

  it('fetches /settings/roles/me', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ role: 'admin', permissions: [], isSuperAdmin: false }),
    });
    renderHook(() => usePermissions());
    expect(capturedKey).toBe('/settings/roles/me');
    const result = await capturedFetcher!();
    expect(mockFetch).toHaveBeenCalledWith('/settings/roles/me');
    expect(result.role).toBe('admin');
  });

  it('throws when the fetch fails (so SWR records the error)', async () => {
    mockFetch.mockResolvedValue({ ok: false });
    renderHook(() => usePermissions());
    await expect(capturedFetcher!()).rejects.toThrow(
      'Failed to load permissions'
    );
  });

  it('reports not-loaded while the request is in flight and denies everything', () => {
    mockIsLoading = true;
    const { result } = renderHook(() => usePermissions());
    expect(result.current.isLoaded).toBe(false);
    expect(result.current.isResolved).toBe(false);
    expect(result.current.hasPermission('settings', 'read')).toBe(false);
    expect(result.current.role).toBeNull();
  });

  it('grants exact resource:action permissions', () => {
    mockData = {
      role: 'admin',
      permissions: ['settings:read', 'posts:create'],
      isSuperAdmin: false,
    };
    const { result } = renderHook(() => usePermissions());
    expect(result.current.isLoaded).toBe(true);
    expect(result.current.isResolved).toBe(true);
    expect(result.current.hasPermission('settings', 'read')).toBe(true);
    expect(result.current.hasPermission('settings', 'update')).toBe(false);
    expect(result.current.hasPermission('media', 'read')).toBe(false);
  });

  it('treats manage as implying every action on the resource', () => {
    mockData = {
      role: 'owner',
      permissions: ['settings:manage'],
      isSuperAdmin: false,
    };
    const { result } = renderHook(() => usePermissions());
    expect(result.current.hasPermission('settings', 'read')).toBe(true);
    expect(result.current.hasPermission('settings', 'delete')).toBe(true);
    expect(result.current.hasPermission('posts', 'read')).toBe(false);
  });

  it('platform super-admin passes every check and counts as owner/admin', () => {
    mockData = { role: null, permissions: [], isSuperAdmin: true };
    const { result } = renderHook(() => usePermissions());
    expect(result.current.hasPermission('anything', 'manage')).toBe(true);
    expect(result.current.isSuperAdmin).toBe(true);
    expect(result.current.isOwner).toBe(true);
    expect(result.current.isAdmin).toBe(true);
  });

  it('exposes owner/admin shortcuts from the role key', () => {
    mockData = { role: 'owner', permissions: [], isSuperAdmin: false };
    const owner = renderHook(() => usePermissions());
    expect(owner.result.current.isOwner).toBe(true);
    expect(owner.result.current.isAdmin).toBe(true);

    mockData = { role: 'admin', permissions: [], isSuperAdmin: false };
    const admin = renderHook(() => usePermissions());
    expect(admin.result.current.isOwner).toBe(false);
    expect(admin.result.current.isAdmin).toBe(true);

    mockData = { role: 'member', permissions: [], isSuperAdmin: false };
    const member = renderHook(() => usePermissions());
    expect(member.result.current.isOwner).toBe(false);
    expect(member.result.current.isAdmin).toBe(false);
  });

  it('is loaded (but unresolved) after a fetch error', () => {
    mockError = new Error('boom');
    const { result } = renderHook(() => usePermissions());
    expect(result.current.isLoaded).toBe(true);
    expect(result.current.isResolved).toBe(false);
    expect(result.current.hasPermission('settings', 'read')).toBe(false);
  });

  it('survives a malformed permissions payload', () => {
    mockData = {
      role: 'member',
      permissions: undefined as unknown as string[],
      isSuperAdmin: false,
    };
    const { result } = renderHook(() => usePermissions());
    expect(result.current.hasPermission('settings', 'read')).toBe(false);
  });

  it('refresh triggers an SWR revalidation', () => {
    mockData = { role: 'admin', permissions: [], isSuperAdmin: false };
    const { result } = renderHook(() => usePermissions());
    result.current.refresh();
    expect(mockMutate).toHaveBeenCalled();
  });
});
