'use client';

import React, { useCallback, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { UtcToLocalDateRender } from '@postmill-ai/react/helpers/utc.date.render';
import { Button } from '@postmill-ai/react/form/button';
import { Input } from '@postmill-ai/react/form/input';
import { PageHeader } from '@postmill-ai/frontend/components/ui/page-header';
import { DataTable, StatusPill } from '@postmill-ai/frontend/components/ui/data-table';
import { EmptyState } from '@postmill-ai/frontend/components/ui/empty-state';
import { usePermissions } from '@postmill-ai/frontend/components/layout/use-permissions';
import { useVariables } from '@postmill-ai/react/helpers/variable.context';

interface ExportJob {
  id: string;
  kind: string;
  status: string;
  archiveSha256?: string;
  expiresAt: string;
  error?: string;
  createdAt: string;
}

export const DataExportTab: React.FC = () => {
  const t = useT();
  const fetch = useFetch();
  const permissions = usePermissions();
  const { backendUrl } = useVariables();
  const [passphrase, setPassphrase] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [downloadLinks, setDownloadLinks] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    const response = await fetch('/org-portability/jobs');
    if (!response.ok) throw new Error(t('org_export_load_failed', 'Could not load organization exports.'));
    return response.json() as Promise<ExportJob[]>;
  }, [fetch, t]);
  const { data: jobs = [], mutate, isLoading } = useSWR<ExportJob[]>(
    permissions.isResolved && permissions.role === 'owner' ? '/org-portability/jobs' : null,
    load,
    {
      refreshInterval: (latest) => latest?.some((job) => ['pending', 'processing'].includes(job.status)) ? 2000 : 0,
    },
  );

  const createExport = async (event: React.FormEvent) => {
    event.preventDefault();
    if (starting) return;
    setStarting(true);
    setError('');
    try {
      const response = await fetch('/org-portability/exports', {
        method: 'POST',
        body: JSON.stringify({ passphrase }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || t('org_export_start_failed', 'Could not start the organization export.'));
      setPassphrase('');
      await mutate();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const issueDownload = async (jobId: string) => {
    setError('');
    try {
      const response = await fetch(`/org-portability/jobs/${jobId}/download`, { method: 'POST' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || t('org_export_download_failed', 'Could not create a download link.'));
      setDownloadLinks((current) => ({
        ...current,
        [jobId]: `${backendUrl.replace(/\/+$/, '')}${body.url}`,
      }));
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  if (permissions.isResolved && permissions.role !== 'owner') {
    return <EmptyState title={t('org_export_owner_only', 'Only an organization owner can export organization data.')} />;
  }

  return (
    <div className="flex flex-col gap-[20px]">
      <PageHeader
        title={t('data_export', 'Organization export')}
        description={t('data_export_description', 'Download a restorable archive of your organization, including files and provider credentials protected by your passphrase.')}
      />
      <form onSubmit={createExport} className="max-w-[560px] rounded-[12px] border border-newTableBorder bg-newBgColorInner p-[16px] flex flex-col gap-[12px]">
        <Input
          name="passphrase"
          type="password"
          disableForm
          label={t('org_export_passphrase', 'Archive passphrase')}
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          required
          minLength={12}
          maxLength={256}
          autoComplete="new-password"
        />
        <p className="text-[12px] text-newTableText">
          {t('org_export_passphrase_help', 'Use at least 12 characters and store this passphrase separately. It is required to import the archive and cannot be recovered.')}
        </p>
        <div>
          <Button type="submit" loading={starting} disabled={passphrase.length < 12}>
            {t('org_export_create', 'Create organization export')}
          </Button>
        </div>
      </form>
      {error && <div role="alert" className="text-[13px] text-dangerText">{error}</div>}
      <DataTable
        columns={[
          {
            key: 'status',
            header: t('status', 'Status'),
            render: (job) => <StatusPill
              status={job.status === 'completed' ? 'green' : job.status === 'failed' || job.status === 'expired' ? 'red' : 'amber'}
              label={t(`org_export_status_${job.status}`, job.status)}
            />,
          },
          { key: 'createdAt', header: t('created', 'Created'), render: (job) => <UtcToLocalDateRender date={job.createdAt} format="YYYY-MM-DD HH:mm" /> },
          { key: 'expiresAt', header: t('expires', 'Expires'), render: (job) => <UtcToLocalDateRender date={job.expiresAt} format="YYYY-MM-DD HH:mm" /> },
          {
            key: 'actions',
            header: t('actions', 'Actions'),
            render: (job) => job.status === 'completed' ? (
              downloadLinks[job.id] ? (
                <a href={downloadLinks[job.id]} className="text-btnPrimaryAccent hover:underline">
                  {t('org_export_download', 'Download archive')}
                </a>
              ) : (
                <Button secondary onClick={() => issueDownload(job.id)}>
                  {t('org_export_create_download', 'Create download link')}
                </Button>
              )
            ) : job.error ? <span className="text-dangerText">{job.error}</span> : null,
          },
        ]}
        data={jobs}
        keyExtractor={(job) => job.id}
        loading={isLoading}
        emptyState={{ title: t('org_export_empty', 'No organization exports yet.') }}
      />
    </div>
  );
};
