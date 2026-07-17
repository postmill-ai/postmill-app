'use client';

import { FC, useCallback, useMemo, useRef, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useBulkImport, BulkRow } from './useBulkImport';
import { DataTable } from '@gitroom/frontend/components/ui/data-table';

// 5 MB is generous for a text CSV of posts; anything larger is almost certainly a
// mistaken upload and would block the main thread in `readAsText`.
const MAX_CSV_BYTES = 5 * 1024 * 1024;

// Minimal RFC-4180 parser: honours double-quoted fields (which may embed commas,
// newlines, and escaped `""` quotes) so post content containing a comma isn't
// truncated and shifted into the channel/date columns.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r') {
      // ignore — handled by the following \n (or end of input)
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop blank rows (trailing newline, empty lines).
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// Rendered as the body of the "Bulk Import" modal, opened from the layout "+" create
// menu (`CreateMenuItems`). The modal supplies the title bar + outer padding, so this
// component is just the CSV picker / preview / results.
export const BulkImport: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const { submit, loading, results, error } = useBulkImport();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [parseError, setParseError] = useState('');

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setParseError('');
      setRows([]);
      const file = e.target.files?.[0];
      // Reset the input so re-selecting the same (fixed) file re-triggers onChange.
      e.target.value = '';
      if (!file) return;
      if (file.size > MAX_CSV_BYTES) {
        setParseError('File is too large (max 5 MB).');
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => setParseError('Could not read the file.');
      reader.onload = (evt) => {
        const text = (evt.target?.result as string) || '';
        const parsedRows = parseCsv(text);
        if (parsedRows.length === 0) {
          setParseError('The file is empty.');
          return;
        }
        const header = parsedRows[0].map((h) => h.trim().toLowerCase());
        const contentIdx = header.indexOf('content');
        const channelIdx = header.indexOf('channel');
        const dateIdx =
          header.indexOf('schedule_at') >= 0
            ? header.indexOf('schedule_at')
            : header.indexOf('date');
        const mediaIdx = header.indexOf('media_url');
        const campaignIdx = header.indexOf('campaign_id');

        if (contentIdx < 0 || channelIdx < 0 || dateIdx < 0) {
          setParseError(
            'Invalid or missing header. Required columns: content, channel, schedule_at (or date).'
          );
          return;
        }
        if (parsedRows.length < 2) {
          setParseError('No data rows found below the header.');
          return;
        }

        const parsed: BulkRow[] = [];
        for (let i = 1; i < parsedRows.length; i++) {
          const cols = parsedRows[i];
          parsed.push({
            content: (cols[contentIdx] || '').trim(),
            channels: (cols[channelIdx] || '')
              .split(';')
              .map((c) => c.trim())
              .filter(Boolean),
            scheduleAt: (cols[dateIdx] || '').trim(),
            mediaUrl: mediaIdx >= 0 ? (cols[mediaIdx] || '').trim() : undefined,
            campaignId:
              campaignIdx >= 0 ? (cols[campaignIdx] || '').trim() : undefined,
          });
        }
        setRows(parsed);
      };
      reader.readAsText(file);
    },
    [],
  );

  const handleSubmit = useCallback(async () => {
    if (rows.length === 0) return;
    await submit(rows);
  }, [rows, submit]);

  return (
    <div className="flex flex-col gap-[16px]">
      <p className="text-[13px] text-newTableText">
        {t(
          'bulk_import_desc',
          'Upload a CSV with columns: content, channel, schedule_at, media_url (optional), campaign_id (optional). Rows are validated independently and errors do not block the batch.',
        )}
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        onChange={handleFileUpload}
        className="hidden"
      />
      <button
        onClick={() => fileInputRef.current?.click()}
        className="px-[16px] py-[8px] bg-btnPrimary text-white rounded-[8px] text-[14px] font-medium self-start"
      >
        {t('upload_csv', 'Upload CSV')}
      </button>

      {rows.length > 0 && (
        <div className="flex flex-col gap-[8px]">
          <h3 className="text-[14px] font-medium">
            {t('preview', 'Preview')} ({rows.length} {t('rows', 'rows')})
          </h3>
          <div className="max-h-[300px] overflow-y-auto border border-newTableBorder rounded-[8px]">
            <DataTable
              columns={[
                { key: 'idx', header: '#', width: '40px', render: (row: any) => row._idx + 1 },
                { key: 'content', header: t('content', 'Content'), render: (row: BulkRow) => <span className="max-w-[200px] truncate block">{row.content}</span> },
                { key: 'channels', header: t('channels', 'Channels'), render: (row: BulkRow) => row.channels.join(', ') },
                { key: 'schedule', header: t('schedule', 'Schedule'), render: (row: BulkRow) => row.scheduleAt },
              ]}
              data={rows.slice(0, 50).map((row, i) => ({ ...row, _idx: i }))}
              keyExtractor={(row: any) => `preview-${row._idx}`}
            />
          </div>
          {rows.length > 50 && (
            <p className="text-[12px] text-newTableText">
              {t(
                'showing_first_50',
                'Showing first 50 rows. All {{count}} rows will be imported.',
                { count: rows.length },
              )}
            </p>
          )}

          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-[16px] py-[8px] bg-btnPrimary text-white rounded-[8px] text-[14px] font-medium self-start disabled:opacity-50"
          >
            {loading
              ? t('importing', 'Importing...')
              : t('import_all', 'Import All')}
          </button>
        </div>
      )}

      {(error || parseError) && (
        <div className="text-red-500 text-[13px]">{error || parseError}</div>
      )}

      {results && results.length > 0 && (
        <div className="flex flex-col gap-[8px]">
          <h3 className="text-[14px] font-medium">
            {t('results', 'Results')}
          </h3>
          <div className="max-h-[300px] overflow-y-auto border border-newTableBorder rounded-[8px]">
            <DataTable
              columns={[
                { key: 'idx', header: '#', width: '40px', render: (r: any) => r._idx + 1 },
                { key: 'status', header: t('status', 'Status:'), render: (r: any) => r.success ? t('success', 'Success') : t('failed', 'Failed') },
                { key: 'details', header: t('details', 'Details'), render: (r: any) => (
                  <>
                    {r.error && <span className="text-red-500">{r.error}</span>}
                    {r.warnings && r.warnings.length > 0 && <span className="text-yellow-500">{r.warnings.join('; ')}</span>}
                    {r.success && !r.warnings?.length && <span className="text-green-500">{t('created', 'Created')}</span>}
                  </>
                )},
              ]}
              data={results.map((r) => ({ ...r, _idx: r.index }))}
              keyExtractor={(r: any) => `result-${r.index}`}
            />
          </div>
        </div>
      )}
    </div>
  );
};
