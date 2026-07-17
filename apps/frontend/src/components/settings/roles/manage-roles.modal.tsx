'use client';

import React, { useCallback, useState } from 'react';
import { Button } from '@gitroom/react/form/button';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import {
  RoleItem,
  useRoles,
  usePermissionsCatalog,
} from '@gitroom/frontend/components/settings/roles/hooks/use-roles';
import { RoleEditor } from '@gitroom/frontend/components/settings/roles/role-editor';

interface EditorState {
  mode: 'create' | 'edit';
  roleId?: string;
  name?: string;
  description?: string;
  permissionIds?: string[];
}

export const ManageRolesModal: React.FC = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const {
    data: roles,
    isLoading: rolesLoading,
    error: rolesError,
    mutate: mutateRoles,
  } = useRoles();
  const { data: catalog } = usePermissionsCatalog();
  const [editor, setEditor] = useState<EditorState | null>(null);

  const openCreate = useCallback(() => {
    setEditor({ mode: 'create' });
  }, []);

  const openEdit = useCallback((role: RoleItem) => {
    setEditor({
      mode: 'edit',
      roleId: role.id,
      name: role.name,
      description: role.description || '',
      permissionIds: role.permissions.map((rp) => rp.permission.id),
    });
  }, []);

  const openClone = useCallback(
    (role: RoleItem) => {
      setEditor({
        mode: 'create',
        name: t('role_name_copy', '{{name}} (Copy)', { name: role.name }),
        description: role.description || '',
        permissionIds: role.permissions.map((rp) => rp.permission.id),
      });
    },
    [t]
  );

  const removeRole = useCallback(
    async (role: RoleItem) => {
      if (
        !(await deleteDialog(
          t(
            'delete_role_confirm',
            'Are you sure you want to delete this role? Members assigned to it will need a new role.'
          )
        ))
      ) {
        return;
      }
      const res = await fetch(`/settings/roles/${role.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        toaster.show(t('role_delete_failed', 'Failed to delete role'), 'warning');
        return;
      }
      toaster.show(t('role_deleted', 'Role deleted'), 'success');
      mutateRoles();
    },
    [fetch, toaster, t, mutateRoles]
  );

  if (editor) {
    return (
      <div className="flex flex-col gap-[16px] max-h-[70vh] overflow-y-auto">
        <RoleEditor
          mode={editor.mode}
          roleId={editor.roleId}
          initialName={editor.name}
          initialDescription={editor.description}
          initialPermissionIds={editor.permissionIds}
          catalog={catalog || []}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            mutateRoles();
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[16px] max-h-[70vh] overflow-y-auto">
      <div className="flex items-center justify-end">
        <Button onClick={openCreate}>{t('create_role', 'Create Role')}</Button>
      </div>

      {rolesError && (
        <div className="bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[24px] flex flex-col items-center gap-[12px]">
          <span className="text-[14px] text-red-500">
            {t('roles_load_failed', 'Failed to load roles')}
          </span>
        </div>
      )}

      {rolesLoading && !rolesError && (
        <div className="bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[24px] animate-pulse">
          {t('loading', 'Loading')}
        </div>
      )}

      {!rolesLoading && !rolesError && (
        <div className="flex flex-col gap-[8px]">
          {(roles || []).map((role) => (
            <div
              key={role.id}
              className="bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[16px] flex items-center gap-[12px]"
            >
              <div className="flex flex-col gap-[4px] flex-1 min-w-0">
                <div className="flex items-center gap-[8px] flex-wrap">
                  <span className="text-[14px] font-semibold truncate">
                    {role.name}
                  </span>
                  <span className="text-[10px] bg-newTableText/20 text-newTableText rounded-[2px] px-[4px] py-[1px]">
                    {role.key}
                  </span>
                  {role.isSystem && (
                    <span className="text-[11px] bg-blue-900/20 text-blue-800 dark:text-blue-400 rounded-[4px] px-[8px] py-[2px]">
                      {t('system_role', 'System')}
                    </span>
                  )}
                </div>
                {role.description && (
                  <span className="text-[12px] text-newTableText truncate">
                    {role.description}
                  </span>
                )}
                <span className="text-[11px] text-newTableText">
                  {role.permissions.length}{' '}
                  {t('permissions_count', 'permissions')}
                </span>
              </div>
              <div className="flex items-center gap-[8px] shrink-0">
                <button
                  type="button"
                  className="text-[12px] text-btnPrimaryAccent hover:underline"
                  onClick={() => openClone(role)}
                >
                  {t('clone', 'Clone')}
                </button>
                {!role.isSystem && (
                  <>
                    <button
                      type="button"
                      className="text-[12px] text-btnPrimaryAccent hover:underline"
                      onClick={() => openEdit(role)}
                    >
                      {t('edit', 'Edit')}
                    </button>
                    <button
                      type="button"
                      className="text-[12px] text-red-600 dark:text-red-500 hover:underline"
                      onClick={() => removeRole(role)}
                    >
                      {t('delete', 'Delete')}
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
