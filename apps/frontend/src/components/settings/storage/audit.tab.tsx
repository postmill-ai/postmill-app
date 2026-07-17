'use client';

import React, { useCallback, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { DataTable } from '@gitroom/frontend/components/ui/data-table';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { createFetchError } from '@gitroom/frontend/components/settings/shared/fetch-error';

const limit = 25;

interface AuditLogRow {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  entityName: string | null;
  userId: string | null;
  createdAt: string;
}

const useAuditLog = (page: number) => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    const res = await fetch(
      `/settings/storage/audit-log?limit=${limit}&offset=${page * limit}`
    );
    if (!res.ok) throw createFetchError('failed_to_load_audit_logs', 'Failed to load audit logs');
    return res.json();
  }, [fetch, page]);
  return useSWR<{ logs: AuditLogRow[]; total: number }>(
    `audit-log:${page}`,
    load,
    { revalidateOnFocus: false }
  );
};

export const AuditTab: React.FC = () => {
  const t = useT();
  const [currentPage, setCurrentPage] = useState(0);

  const { data, isLoading } = useAuditLog(currentPage);

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;

  const formatDate = (date: string) => {
    return new Date(date).toLocaleString();
  };

  const actionLabel = (action: string) => {
    const map: Record<string, string> = {
      'storage.create': t('audit_action_created', 'Created'),
      'storage.update': t('audit_action_updated', 'Updated'),
      'storage.delete': t('audit_action_deleted', 'Deleted'),
      'storage.mount': t('mounted', 'Mounted'),
      'storage.unmount': t('unmounted', 'Unmounted'),
      'storage.set-default-folder': t('audit_action_set_as_default', 'Set as Default'),
      'storage.migrate': t('audit_action_migrated', 'Migrated'),
    };
    return map[action] || action;
  };

  return (
    <div className="flex flex-col gap-[20px]">
      <h3 className="text-[18px] font-semibold text-textColor">{t('audit_log', 'Audit Log')}</h3>

      <DataTable
        columns={[
          { key: 'action', header: t('action', 'Action'), render: (log: any) => actionLabel(log.action) },
          { key: 'entity', header: t('provider', 'Provider'), render: (log: any) => log.entityName || log.entityId || '—' },
          { key: 'user', header: t('user', 'User'), render: (log: any) => log.userId || t('system', 'System') },
          { key: 'date', header: t('date', 'Date'), render: (log: any) => formatDate(log.createdAt) },
        ]}
        data={logs}
        keyExtractor={(log: any) => log.id}
        loading={isLoading}
        page={currentPage + 1}
        total={total}
        limit={limit}
        onPageChange={(p) => setCurrentPage(p - 1)}
        emptyState={{ title: t('no_audit_logs_yet', 'No audit logs yet.') }}
      />
    </div>
  );
};
