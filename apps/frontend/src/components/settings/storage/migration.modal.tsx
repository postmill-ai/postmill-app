'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface ProviderSummary {
  id: string;
  name: string;
  type: string;
}

interface MigrationModalProps {
  source: ProviderSummary;
  targets: ProviderSummary[];
  onClose: () => void;
  onComplete: () => void;
}

const BATCH_SIZE = 25;

const formatBytes = (bytes: number): string => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

export const MigrationModal: React.FC<MigrationModalProps> = ({
  source,
  targets,
  onClose,
  onComplete,
}) => {
  const translate = useT();
  const fetch = useFetch();
  const [targetId, setTargetId] = useState(targets[0]?.id || '');
  const [running, setRunning] = useState(false);
  const [preview, setPreview] = useState<{ count: number; totalBytes: number } | null>(
    null
  );
  const [progress, setProgress] = useState<{
    migrated: number;
    failed: number;
    total: number;
  } | null>(null);
  const [result, setResult] = useState<{
    migrated: number;
    failed: number;
    errors: string[];
  } | null>(null);
  const [error, setError] = useState('');
  const abortRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/settings/storage/${source.id}/migrate-preview`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setPreview(data);
        }
      } catch {
        // preview is best-effort; migration still works without it
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetch, source.id]);

  const handleMigrate = useCallback(async () => {
    if (!targetId) return;
    setRunning(true);
    abortRef.current = false;
    setError('');

    let cursor: string | undefined = undefined;
    let totalMigrated = 0;
    let totalFailed = 0;
    const allErrors: string[] = [];
    const total = preview?.count ?? 0;
    setProgress({ migrated: 0, failed: 0, total });

    try {
      // Loop bounded batches until the server reports done.
      // Guard against an unexpected non-terminating cursor.
      for (let i = 0; i < 100000; i++) {
        const res = await fetch(
          `/settings/storage/${source.id}/migrate/${targetId}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cursor, limit: BATCH_SIZE }),
          }
        );
        if (!res.ok) {
          const err = await res.json();
          throw new Error(
            err.message || err.error || translate('migration_failed', 'Migration failed')
          );
        }
        const data = await res.json();
        totalMigrated += data.migrated || 0;
        totalFailed += data.failed || 0;
        if (data.errors?.length) allErrors.push(...data.errors);
        setProgress({
          migrated: totalMigrated,
          failed: totalFailed,
          total: total || totalMigrated + totalFailed,
        });
        if (data.done || !data.nextCursor) break;
        cursor = data.nextCursor;
        if (abortRef.current) break;
      }
      setResult({
        migrated: totalMigrated,
        failed: totalFailed,
        errors: allErrors,
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }, [fetch, source.id, targetId, preview]);

  const processed = progress ? progress.migrated + progress.failed : 0;
  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((processed / progress.total) * 100))
      : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-newBgColorInner border border-newTableBorder rounded-[16px] p-[24px] w-full max-w-[500px]">
        <h3 className="text-[18px] font-medium text-textColor mb-[20px]">
          {translate('migrate_files', 'Migrate Files')}
        </h3>

        {!result ? (
          <>
            <p className="text-[14px] text-newTableText mb-[20px]">
              {translate(
                'migrate_files_description',
                'Migrate all files from {{name}} to another storage provider. Files will be copied, verified, and then removed from the source.',
                { name: source.name }
              )}
            </p>

            <div className="mb-[16px] p-[12px] rounded-[8px] bg-btnSimple">
              <div className="flex justify-between text-[13px]">
                <span className="text-newTableText">{translate('files_to_migrate', 'Files to migrate')}</span>
                <span className="text-textColor font-medium">
                  {preview ? preview.count : '…'}
                </span>
              </div>
              <div className="flex justify-between text-[13px] mt-[4px]">
                <span className="text-newTableText">{translate('total_size', 'Total size')}</span>
                <span className="text-textColor font-medium">
                  {preview ? formatBytes(preview.totalBytes) : '…'}
                </span>
              </div>
            </div>

            <div className="mb-[20px]">
              <label htmlFor="migration-target-provider" className="text-[12px] text-newTableText mb-[6px] block">
                {translate('target_provider', 'Target Provider')}
              </label>
              <select
                id="migration-target-provider"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                disabled={running}
                className="w-full bg-newBgColorInner border border-newTableBorder rounded-[8px] px-[12px] py-[8px] text-[14px] text-textColor outline-none focus:border-btnPrimary disabled:opacity-50"
              >
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.type})
                  </option>
                ))}
              </select>
            </div>

            {error && (
              <div className="p-[12px] rounded-[8px] bg-[#3a1a1a] text-[#f87171] text-[13px] mb-[16px]">
                {error}
              </div>
            )}

            {running && (
              <div className="mb-[16px]">
                <div className="flex justify-between text-[12px] text-newTableText mb-[4px]">
                  <span>
                    {progress && progress.total > 0
                      ? translate('migrating_progress', 'Migrating… {{processed}} / {{total}}', {
                          processed,
                          total: progress.total,
                        })
                      : translate('migrating_ellipsis', 'Migrating…')}
                  </span>
                  <span>{percent}%</span>
                </div>
                <div className="h-[6px] bg-newTableHeader rounded-full overflow-hidden">
                  <div
                    className="h-full bg-btnPrimary rounded-full transition-all"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>
            )}

            <div className="flex gap-[12px] justify-end">
              <button
                onClick={() => {
                  abortRef.current = true;
                  onClose();
                }}
                className="px-[16px] py-[8px] rounded-[8px] bg-btnSimple text-newTableText text-[13px] hover:bg-boxHover transition-colors"
              >
                {translate('cancel', 'Cancel')}
              </button>
              <button
                onClick={handleMigrate}
                disabled={running || !targetId || preview?.count === 0}
                className="px-[16px] py-[8px] rounded-[8px] bg-[#f59e0b] text-textColor text-[13px] font-medium hover:bg-[#d97706] transition-colors disabled:opacity-50"
              >
                {running ? translate('migrating', 'Migrating...') : translate('start_migration', 'Start Migration')}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-[12px] mb-[20px]">
              <div className="flex items-center gap-[12px] p-[16px] rounded-[12px] bg-btnSimple">
                <div className="flex-1">
                  <p className="text-[14px] text-textColor font-medium">{translate('migration_complete', 'Migration Complete')}</p>
                  <div className="flex gap-[16px] mt-[8px]">
                    <div>
                      <span className="text-[11px] text-newTableText">{translate('migrated', 'Migrated')}</span>
                      <p className="text-[16px] text-textColor font-medium">
                        {result.migrated}
                      </p>
                    </div>
                    <div>
                      <span className="text-[11px] text-newTableText">{translate('failed', 'Failed')}</span>
                      <p className="text-[16px] text-[#f87171] font-medium">
                        {result.failed}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {result.errors.length > 0 && (
                <div className="p-[12px] rounded-[8px] bg-[#3a1a1a] max-h-[200px] overflow-y-auto">
                  <p className="text-[12px] text-[#f87171] font-medium mb-[6px]">
                    {translate('errors_count', 'Errors ({{count}})', { count: result.errors.length })}
                  </p>
                  {result.errors.map((err, i) => (
                    <p key={i} className="text-[11px] text-[#f87171]/80 mb-[4px] break-all">
                      {err}
                    </p>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-[12px] justify-end">
              <button
                onClick={() => {
                  onComplete();
                  onClose();
                }}
                className="px-[16px] py-[8px] rounded-[8px] bg-btnPrimary text-white text-[13px] font-medium hover:bg-btnPrimary/80 transition-colors"
              >
                {translate('done', 'Done')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
