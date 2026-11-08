'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { useRouter } from 'next/navigation';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { Button } from '@postmill-ai/react/form/button';
import { Input } from '@postmill-ai/react/form/input';
import { StepFrame } from '@postmill-ai/frontend/components/setup/step-frame';
import { usePermissions } from '@postmill-ai/frontend/components/layout/use-permissions';

const CHUNK_BYTES = 8 * 1024 * 1024;

type ImportJob = {
  id: string;
  status: string;
  error?: string;
  progress?: { uploadedBytes?: number };
};

type ArchiveSummary = {
  source: { name: string };
  createdAt: string;
  missingAssets: number;
};

const blobBase64 = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error('Could not read the archive chunk.'));
  reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
  reader.readAsDataURL(blob);
});

const responseError = async (response: Response, fallback: string): Promise<string> => {
  const body = await response.json().catch(() => ({}));
  return typeof body.message === 'string' ? body.message : fallback;
};

export function StepImport() {
  const t = useT();
  const fetch = useFetch();
  const router = useRouter();
  const permissions = usePermissions();
  const { mutate: globalMutate } = useSWRConfig();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [job, setJob] = useState<ImportJob | null>(null);
  const [summary, setSummary] = useState<ArchiveSummary | null>(null);
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'validating' | 'ready' | 'starting' | 'processing' | 'completed' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pollAttempt, setPollAttempt] = useState(0);

  const loadJob = useCallback(async (url: string) => (await fetch(url)).json(), [fetch]);
  const { data: polled } = useSWR<ImportJob>(
    ['validating', 'processing'].includes(phase) && job?.id ? `/org-portability/import-uploads/${job.id}?pollAttempt=${pollAttempt}` : null,
    loadJob,
    { refreshInterval: 2000, revalidateOnFocus: false },
  );

  useEffect(() => {
    if (!polled) return;
    setJob(polled);
    if (polled.status === 'ready') {
      setSummary(polled.progress as unknown as ArchiveSummary);
      setPhase('ready');
      return;
    }
    if (polled.status === 'completed') {
      setPhase('completed');
      return;
    }
    if (polled.status === 'uploading') {
      setPhase('error');
      setError(polled.error || t('setup_import_validation_retry', 'Verification could not finish. Retry verification; you do not need to upload the archive again.'));
      return;
    }
    if (polled.status === 'failed' || polled.status === 'expired') {
      setPhase('error');
      setError(polled.error || t('setup_import_failed', 'The organization import failed. Upload the archive and try again.'));
    }
  }, [polled, t]);

  useEffect(() => {
    if (phase !== 'completed') return;
    void globalMutate(
      '/user/self',
      (previous: any) => previous ? { ...previous, setupCompleted: true } : previous,
      { revalidate: true },
    ).then(() => router.replace('/dashboard'));
  }, [phase, globalMutate, router]);

  const uploadAndValidate = useCallback(async () => {
    if (!file || passphrase.length < 12) return;
    const retryValidation = job?.status === 'uploading' && job.progress?.uploadedBytes === file.size;
    setPhase(retryValidation ? 'validating' : 'uploading');
    setError(null);
    setSummary(null);
    try {
      let created = job;
      if (!retryValidation) {
        const createdResponse = await fetch('/org-portability/import-uploads', { method: 'POST' });
        if (!createdResponse.ok) throw new Error(await responseError(createdResponse, t('setup_import_start_failed', 'Could not start the import.')));
        created = await createdResponse.json() as ImportJob;
        setJob(created);
        for (let offset = 0; offset < file.size;) {
          const chunk = file.slice(offset, Math.min(offset + CHUNK_BYTES, file.size));
          const data = await blobBase64(chunk);
          const response = await fetch(`/org-portability/import-uploads/${created.id}/chunks`, {
            method: 'PUT',
            body: JSON.stringify({ offset, data }),
          });
          if (!response.ok) throw new Error(await responseError(response, t('setup_import_upload_failed', 'The archive upload failed. Retry the same chunk.')));
          const uploaded = await response.json();
          offset = uploaded.uploadedBytes;
          setJob({ ...created, progress: { uploadedBytes: offset } });
        }
      }
      if (!created) throw new Error(t('setup_import_start_failed', 'Could not start the import.'));
      const validatedResponse = await fetch(`/org-portability/import-uploads/${created.id}/validate`, {
        method: 'POST',
        body: JSON.stringify({ passphrase }),
      });
      if (!validatedResponse.ok) throw new Error(await responseError(validatedResponse, t('setup_import_validation_failed', 'The archive could not be validated. Check the file and passphrase.')));
      setJob(await validatedResponse.json());
      setPollAttempt((attempt) => attempt + 1);
      setPhase('validating');
    } catch (caught) {
      setPhase('error');
      setError(caught instanceof Error ? caught.message : t('setup_import_failed', 'The organization import failed.'));
    }
  }, [file, job, passphrase, fetch, t]);

  const commit = useCallback(async () => {
    if (!job) return;
    setPhase('starting');
    setError(null);
    try {
      const response = await fetch(`/org-portability/import-uploads/${job.id}/commit`, {
        method: 'POST',
        body: JSON.stringify({ passphrase }),
      });
      if (!response.ok) throw new Error(await responseError(response, t('setup_import_start_failed', 'Could not start the background import.')));
      setJob(await response.json());
      setPollAttempt((attempt) => attempt + 1);
      setPhase('processing');
    } catch (caught) {
      setPhase('error');
      setError(caught instanceof Error ? caught.message : t('setup_import_failed', 'The organization import failed.'));
    }
  }, [job, passphrase, fetch, t]);

  const busy = ['uploading', 'validating', 'starting', 'processing', 'completed'].includes(phase);
  const retryValidation = Boolean(file && job?.status === 'uploading' && job.progress?.uploadedBytes === file.size);
  const isOwner = !permissions.isResolved || permissions.isOwner || permissions.isSuperAdmin;

  return (
    <StepFrame
      title={t('setup_import_title', 'Move an existing organization (optional)')}
      subtitle={t(
        'setup_import_subtitle',
        'Import a Postmill organization export into this empty workspace. You can also skip this step and configure a new workspace. Imported channels, providers and automation stay disabled until you review and enable them.',
      )}
    >
      <div className="max-w-[680px] flex flex-col gap-[18px] bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[20px]">
        {!isOwner && (
          <p className="text-[13px] text-newTableText">
            {t('setup_import_owner_only', 'Only an organization owner can import an organization. Ask the owner to complete this step.')}
          </p>
        )}
        <div className="flex flex-col gap-[8px]">
          <label htmlFor="organization-archive" className="text-[14px] font-[500] text-textColor">
            {t('setup_import_archive', 'Organization export (.zip)')}
          </label>
          <input
            ref={inputRef}
            id="organization-archive"
            type="file"
            accept=".zip,application/zip"
            disabled={!isOwner || busy}
            onChange={(event) => {
              setFile(event.target.files?.[0] || null);
              setJob(null);
              setSummary(null);
              setPhase('idle');
              setError(null);
            }}
            className="bg-newBgColor border border-newTableBorder rounded-[8px] p-[10px] text-textColor text-[13px] file:me-[12px] file:bg-btnPrimary file:text-white file:border-0 file:rounded-[6px] file:px-[12px] file:py-[8px] cursor-pointer"
          />
          {file && (
            <span className="text-[12px] text-newTableText">
              {file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB
            </span>
          )}
        </div>

        <Input
          disableForm
          label={t('setup_import_passphrase', 'Archive passphrase')}
          name="organization-import-passphrase"
          type="password"
          autoComplete="off"
          value={passphrase}
          disabled={!isOwner || busy}
          onChange={(event) => setPassphrase(event.target.value)}
          placeholder={t('setup_import_passphrase_placeholder', 'At least 12 characters')}
        />

        {job?.progress?.uploadedBytes !== undefined && file && phase === 'uploading' && (
          <div className="text-[13px] text-newTableText" role="status">
            {t('setup_import_uploaded', 'Uploaded {{uploaded}} of {{total}} MB', {
              uploaded: (job.progress.uploadedBytes / (1024 * 1024)).toFixed(1),
              total: (file.size / (1024 * 1024)).toFixed(1),
            })}
          </div>
        )}

        {summary && (
          <div className="rounded-[8px] border border-newTableBorder bg-newBgColor p-[12px] text-[13px] text-textColor">
            <div className="font-[600]">{t('setup_import_verified', 'Archive verified')}: {summary.source.name}</div>
            {summary.missingAssets > 0 && (
              <p className="mt-[6px] text-newTableText">
                {t('setup_import_missing_assets', '{{count}} source file(s) were already missing. Their references will be cleared.', { count: summary.missingAssets })}
              </p>
            )}
          </div>
        )}

        {phase === 'validating' && (
          <p className="text-[13px] text-newTableText" role="status">
            {t('setup_import_validating', 'Verifying the archive in the background. You will be able to start the import when verification finishes.')}
          </p>
        )}
        {phase === 'processing' && (
          <p className="text-[13px] text-newTableText" role="status">
            {t('setup_import_processing', 'Importing in the background. Keep this page open; you will be redirected when it finishes.')}
          </p>
        )}
        {error && <div className="text-[13px] text-dangerText" role="alert">{error}</div>}

        <div className="flex items-center gap-[12px]">
          {phase !== 'ready' && !busy && (
            <Button
              onClick={uploadAndValidate}
              disabled={!isOwner || !file || passphrase.length < 12}
              loading={phase === 'uploading'}
              className="bg-btnPrimary text-white"
            >
              {retryValidation
                ? t('setup_import_retry_button', 'Retry verification')
                : t('setup_import_validate_button', 'Upload and verify archive')}
            </Button>
          )}
          {phase === 'ready' && (
            <Button onClick={commit} className="bg-btnPrimary text-white">
              {t('setup_import_commit_button', 'Import organization')}
            </Button>
          )}
        </div>
      </div>
    </StepFrame>
  );
}
