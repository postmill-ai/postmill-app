import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PermissionItem } from './hooks/use-roles';

const mockT = vi.fn((_key: string, fallback?: string) => fallback ?? _key);
vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => mockT,
}));

const mockShow = vi.fn();
vi.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mockShow }),
}));

const mockFetch = vi.fn();
vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));

import { RoleEditor, roleKeyFromName } from './role-editor';

const catalog: PermissionItem[] = [
  { id: 'p1', resource: 'posts', action: 'create' },
  { id: 'p2', resource: 'posts', action: 'read' },
  { id: 'p3', resource: 'settings', action: 'read' },
];

describe('roleKeyFromName', () => {
  it('slugifies the display name', () => {
    expect(roleKeyFromName('Content Manager')).toBe('content-manager');
    expect(roleKeyFromName('  Ops / Legal!  ')).toBe('ops-legal');
  });
});

describe('RoleEditor', () => {
  let onClose: ReturnType<typeof vi.fn>;
  let onSaved: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch.mockReset();
    mockShow.mockReset();
    onClose = vi.fn();
    onSaved = vi.fn();
  });

  const renderCreate = () =>
    render(
      <RoleEditor
        mode="create"
        catalog={catalog}
        onClose={onClose}
        onSaved={onSaved}
      />
    );

  it('groups the catalog by resource', () => {
    renderCreate();
    expect(screen.getByText('posts')).toBeDefined();
    expect(screen.getByText('settings')).toBeDefined();
    expect(screen.getByLabelText('posts:create')).toBeDefined();
    expect(screen.getByLabelText('settings:read')).toBeDefined();
  });

  it('requires a name before saving', () => {
    renderCreate();
    fireEvent.click(screen.getByRole('button', { name: 'Create Role' }));
    expect(mockShow).toHaveBeenCalledWith('Role name is required', 'warning');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('requires at least one permission before saving', () => {
    renderCreate();
    fireEvent.change(screen.getByLabelText('Role name'), {
      target: { value: 'Content Manager' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Role' }));
    expect(mockShow).toHaveBeenCalledWith(
      'Select at least one permission',
      'warning'
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('creates a role with a derived key and the selected permissions', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    renderCreate();
    fireEvent.change(screen.getByLabelText('Role name'), {
      target: { value: 'Content Manager' },
    });
    fireEvent.click(screen.getByLabelText('posts:create'));
    fireEvent.click(screen.getByLabelText('settings:read'));
    fireEvent.click(screen.getByRole('button', { name: 'Create Role' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockFetch).toHaveBeenCalledWith('/settings/roles', {
      method: 'POST',
      body: JSON.stringify({
        key: 'content-manager',
        name: 'Content Manager',
        description: undefined,
        permissionIds: ['p1', 'p3'],
      }),
    });
    expect(mockShow).toHaveBeenCalledWith('Role created', 'success');
  });

  it('the resource group toggle selects/deselects every action in the group', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    renderCreate();
    fireEvent.change(screen.getByLabelText('Role name'), {
      target: { value: 'X' },
    });
    fireEvent.click(screen.getByLabelText('posts all'));
    fireEvent.click(screen.getByRole('button', { name: 'Create Role' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const body = JSON.parse(
      (mockFetch.mock.calls[0][1] as { body: string }).body
    );
    expect(body.permissionIds).toEqual(['p1', 'p2']);
  });

  it('edits an existing role via PUT without a key', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    render(
      <RoleEditor
        mode="edit"
        roleId="r9"
        initialName="Old Name"
        initialDescription="Old description"
        initialPermissionIds={['p2']}
        catalog={catalog}
        onClose={onClose}
        onSaved={onSaved}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save Role' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockFetch).toHaveBeenCalledWith('/settings/roles/r9', {
      method: 'PUT',
      body: JSON.stringify({
        name: 'Old Name',
        description: 'Old description',
        permissionIds: ['p2'],
      }),
    });
    expect(mockShow).toHaveBeenCalledWith('Role updated', 'success');
  });

  it('shows the backend error message on failure and keeps the editor open', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ message: 'Invalid permission IDs: x' }),
    });
    renderCreate();
    fireEvent.change(screen.getByLabelText('Role name'), {
      target: { value: 'Bad' },
    });
    fireEvent.click(screen.getByLabelText('posts:create'));
    fireEvent.click(screen.getByRole('button', { name: 'Create Role' }));

    await waitFor(() =>
      expect(mockShow).toHaveBeenCalledWith(
        'Invalid permission IDs: x',
        'warning'
      )
    );
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('falls back to a generic error for non-JSON error bodies', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.reject(new Error('not json')),
    });
    renderCreate();
    fireEvent.change(screen.getByLabelText('Role name'), {
      target: { value: 'Bad' },
    });
    fireEvent.click(screen.getByLabelText('posts:create'));
    fireEvent.click(screen.getByRole('button', { name: 'Create Role' }));

    await waitFor(() =>
      expect(mockShow).toHaveBeenCalledWith('Failed to save role', 'warning')
    );
  });

  it('cancel calls onClose', () => {
    renderCreate();
    fireEvent.click(screen.getAllByText('Cancel')[0]);
    expect(onClose).toHaveBeenCalled();
  });
});
