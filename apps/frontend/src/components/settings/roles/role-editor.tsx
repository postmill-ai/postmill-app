'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { Button } from '@gitroom/react/form/button';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { PermissionItem } from '@gitroom/frontend/components/settings/roles/hooks/use-roles';

/** Derives a stable machine key from a display name (create flow only). */
export const roleKeyFromName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);

export interface RoleEditorProps {
  mode: 'create' | 'edit';
  roleId?: string;
  initialName?: string;
  initialDescription?: string;
  initialPermissionIds?: string[];
  catalog: PermissionItem[];
  onClose: () => void;
  onSaved: () => void;
}

export const RoleEditor: React.FC<RoleEditorProps> = ({
  mode,
  roleId,
  initialName,
  initialDescription,
  initialPermissionIds,
  catalog,
  onClose,
  onSaved,
}) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const [name, setName] = useState(initialName || '');
  const [description, setDescription] = useState(initialDescription || '');
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialPermissionIds || [])
  );
  const [saving, setSaving] = useState(false);

  const grouped = useMemo(() => {
    const byResource = new Map<string, PermissionItem[]>();
    for (const permission of catalog) {
      const list = byResource.get(permission.resource) || [];
      list.push(permission);
      byResource.set(permission.resource, list);
    }
    return Array.from(byResource.entries());
  }, [catalog]);

  const togglePermission = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleResource = useCallback(
    (permissions: PermissionItem[], checked: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const permission of permissions) {
          if (checked) {
            next.add(permission.id);
          } else {
            next.delete(permission.id);
          }
        }
        return next;
      });
    },
    []
  );

  const save = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toaster.show(t('role_name_required', 'Role name is required'), 'warning');
      return;
    }
    if (selected.size === 0) {
      toaster.show(
        t('role_permissions_required', 'Select at least one permission'),
        'warning'
      );
      return;
    }
    setSaving(true);
    try {
      const body =
        mode === 'create'
          ? {
              key: roleKeyFromName(trimmedName),
              name: trimmedName,
              description: description.trim() || undefined,
              permissionIds: Array.from(selected),
            }
          : {
              name: trimmedName,
              description: description.trim() || undefined,
              permissionIds: Array.from(selected),
            };
      const res = await fetch(
        mode === 'create' ? '/settings/roles' : `/settings/roles/${roleId}`,
        {
          method: mode === 'create' ? 'POST' : 'PUT',
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) {
        let message = '';
        try {
          const err: { message?: string | string[] } = await res.json();
          message = Array.isArray(err.message)
            ? err.message.join(', ')
            : err.message || '';
        } catch {
          // non-JSON error body — fall through to the generic message
        }
        toaster.show(
          message || t('role_save_failed', 'Failed to save role'),
          'warning'
        );
        return;
      }
      toaster.show(
        mode === 'create'
          ? t('role_created', 'Role created')
          : t('role_updated', 'Role updated'),
        'success'
      );
      onSaved();
    } finally {
      setSaving(false);
    }
  }, [name, description, selected, mode, roleId, fetch, toaster, t, onSaved]);

  return (
    <div className="bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[24px] flex flex-col gap-[16px]">
      <div className="flex items-center justify-between">
        <h4 className="text-[16px] font-semibold">
          {mode === 'create'
            ? t('create_role', 'Create Role')
            : t('edit_role', 'Edit Role')}
        </h4>
        <button
          type="button"
          className="text-[12px] text-newTableText hover:underline"
          onClick={onClose}
        >
          {t('cancel', 'Cancel')}
        </button>
      </div>

      <div className="flex flex-col gap-[8px]">
        <label className="text-[13px] text-newTableText" htmlFor="role-name">
          {t('role_name', 'Role name')}
        </label>
        <input
          id="role-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('role_name_placeholder', 'e.g. Content Manager')}
          className="w-full px-[12px] py-[8px] bg-newBgColor border border-newTableBorder rounded-[8px] text-[14px] outline-none"
        />
      </div>

      <div className="flex flex-col gap-[8px]">
        <label
          className="text-[13px] text-newTableText"
          htmlFor="role-description"
        >
          {t('role_description', 'Description (optional)')}
        </label>
        <input
          id="role-description"
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t(
            'role_description_placeholder',
            'What can this role do?'
          )}
          className="w-full px-[12px] py-[8px] bg-newBgColor border border-newTableBorder rounded-[8px] text-[14px] outline-none"
        />
      </div>

      <div className="flex flex-col gap-[12px]">
        <div className="text-[13px] text-newTableText">
          {t('role_permissions', 'Permissions')}
        </div>
        {grouped.map(([resource, permissions]) => {
          const allChecked = permissions.every((p) => selected.has(p.id));
          return (
            <div
              key={resource}
              className="border border-newTableBorder rounded-[8px] p-[12px] flex flex-col gap-[8px]"
            >
              <label className="flex items-center gap-[8px] cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-btnPrimary w-[14px] h-[14px]"
                  checked={allChecked}
                  onChange={(e) => toggleResource(permissions, e.target.checked)}
                  aria-label={`${resource} all`}
                />
                <span className="text-[13px] font-semibold capitalize">
                  {resource.replace(/-/g, ' ')}
                </span>
              </label>
              <div className="flex flex-wrap gap-x-[16px] gap-y-[6px] ps-[22px]">
                {permissions.map((permission) => (
                  <label
                    key={permission.id}
                    className="flex items-center gap-[6px] cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      className="accent-btnPrimary w-[14px] h-[14px]"
                      checked={selected.has(permission.id)}
                      onChange={() => togglePermission(permission.id)}
                      aria-label={`${permission.resource}:${permission.action}`}
                    />
                    <span className="text-[12px] capitalize">
                      {permission.action}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex gap-[8px]">
        <Button onClick={save} loading={saving}>
          {mode === 'create'
            ? t('create_role', 'Create Role')
            : t('save_role', 'Save Role')}
        </Button>
        <Button secondary onClick={onClose}>
          {t('cancel', 'Cancel')}
        </Button>
      </div>
    </div>
  );
};
