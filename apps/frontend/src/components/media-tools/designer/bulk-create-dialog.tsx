'use client';

import React, { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import {
  applyBulkAssignments,
  collectBulkAssignmentTargets,
  collectBulkVariables,
  type BulkVariable,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/bulk-variables';
import { parseSpreadsheetText } from '@postmill-ai/frontend/components/shared/csv';
import { Button } from '@postmill-ai/react/form/button';
import { buildBulkTemplateCsv, inferBulkHeaderKind } from './bulk-create-template';

type Store = ReturnType<typeof import('./designer.store').createDesignerStore>;
type Row = Record<string, string>;

interface BulkCreateDialogProps {
  store: Store;
  onClose: () => void;
}

interface JobResult {
  row: number;
  designId?: string;
  fileIds: string[];
  error?: string;
}

interface BulkJob {
  id: string;
  status: string;
  artifactUrl?: string;
  error?: string | null;
  progress?: { done: number; total: number };
  results?: JobResult[];
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export const BulkCreateDialog: FC<BulkCreateDialogProps> = ({ store, onClose }) => {
  const t = useT();
  const fetch = useFetch();
  const fileInput = useRef<HTMLInputElement>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [sourceRows, setSourceRows] = useState<Row[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [job, setJob] = useState<BulkJob | null>(null);
  const doc = store((state) => state.doc);
  const designName = store((state) => state.designName);
  const selectedIds = store((state) => state.selectedIds);
  const variables = useMemo(() => collectBulkVariables(doc), [doc]);
  const assignmentTargets = useMemo(() => collectBulkAssignmentTargets(doc), [doc]);

  const rows = useMemo(() => sourceRows.map((source) => {
    if (!variables.length) return source;
    const mapped: Row = {};
    for (const variable of variables) {
      mapped[variable.name] = source[mapping[variable.name]] ?? '';
    }
    return mapped;
  }), [sourceRows, mapping, variables]);

  useEffect(() => () => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
  }, []);

  const poll = useCallback((jobId: string) => {
    const tick = async () => {
      try {
        const response = await fetch(`/media/designs/bulk-create/${jobId}`);
        if (!response.ok) throw new Error(t('designer_bulk_status_failed', 'Could not read the Bulk Create status.'));
        const next = await response.json() as BulkJob;
        setJob(next);
        if (next.status === 'completed' || next.status === 'failed') return;
        pollTimer.current = setTimeout(tick, 2000);
      } catch (cause) {
        setError((cause as Error).message);
      }
    };
    void tick();
  }, [fetch, t]);

  const handleFile = (file?: File) => {
    setError('');
    setPreviewUrl('');
    setJob(null);
    if (!file) return;
    setHeaders([]);
    setSourceRows([]);
    setMapping({});
    setAssignments({});
    if (file.size > MAX_FILE_BYTES) {
      setError(t('designer_bulk_file_too_large', 'The spreadsheet is too large (maximum 5 MB).'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setError(t('designer_bulk_read_failed', 'Could not read the spreadsheet.'));
    reader.onload = () => {
      try {
        const parsed = parseSpreadsheetText(String(reader.result || ''));
        if (parsed.length < 2) {
          setError(t('designer_bulk_no_rows', 'Add a header row and at least one data row.'));
          return;
        }
        const nextHeaders = parsed[0].map((header) => header.trim());
        if (nextHeaders.some((header) => !header)) {
          setError(t('designer_bulk_blank_header', 'Every column needs a header.'));
          return;
        }
        if (new Set(nextHeaders).size !== nextHeaders.length) {
          setError(t('designer_bulk_duplicate_header', 'Column headers must be unique.'));
          return;
        }
        if (parsed.length - 1 > 200) {
          setError(t('designer_bulk_too_many_rows', 'Bulk Create is limited to 200 data rows.'));
          return;
        }
        const nextRows = parsed.slice(1).map((cells) => Object.fromEntries(
          nextHeaders.map((header, index) => [header, cells[index] ?? ''])
        ));
        const selected = new Set(selectedIds);
        const orderedTargets = [...assignmentTargets].sort((a, b) =>
          Number(selected.has(b.elementId)) - Number(selected.has(a.elementId))
        );
        setHeaders(nextHeaders);
        setSourceRows(nextRows);
        setMapping(Object.fromEntries(variables.map((variable) => [
          variable.name,
          nextHeaders.includes(variable.name)
            ? variable.name
            : nextHeaders.find((header) => inferBulkHeaderKind(header) === variable.kind) || nextHeaders[0],
        ])));
        setAssignments(Object.fromEntries(orderedTargets.map((target) => [
          target.id,
          selected.has(target.elementId)
            ? nextHeaders.find((header) => inferBulkHeaderKind(header) === target.kind) || ''
            : '',
        ])));
      } catch (cause) {
        setError((cause as Error).message || t('designer_bulk_parse_failed', 'Could not parse the spreadsheet.'));
      }
    };
    reader.readAsText(file);
  };

  const applyAssignments = () => {
    setError('');
    setPreviewUrl('');
    try {
      const nextDoc = applyBulkAssignments(doc, assignments);
      const nextVariables = collectBulkVariables(nextDoc);
      setMapping((current) => Object.fromEntries(nextVariables.map((variable) => [
        variable.name,
        current[variable.name] || (headers.includes(variable.name) ? variable.name : headers[0]),
      ])));
      store.getState().setDoc(nextDoc);
      store.getState().pushHistory('Assign Bulk Create variables');
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const generatePreview = async () => {
    if (!rows.length) return;
    setPreviewLoading(true);
    setError('');
    try {
      const response = await fetch('/media/designs/bulk-generate', {
        method: 'POST',
        body: JSON.stringify({ doc, rows: [rows[0]] }),
      });
      if (!response.ok) throw new Error(t('designer_bulk_preview_failed', 'Could not render the preview.'));
      const data = await response.json() as { images?: string[] };
      if (!data.images?.[0]) throw new Error(t('designer_bulk_preview_failed', 'Could not render the preview.'));
      setPreviewUrl(data.images[0]);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setPreviewLoading(false);
    }
  };

  const start = async () => {
    if (!rows.length || starting) return;
    setStarting(true);
    setError('');
    try {
      const response = await fetch('/media/designs/bulk-create', {
        method: 'POST',
        body: JSON.stringify({
          doc,
          rows,
          nameBase: designName || 'Bulk variation',
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || t('designer_bulk_start_failed', 'Could not start Bulk Create.'));
      }
      const created = await response.json() as { id: string; status: string };
      setJob({ id: created.id, status: created.status });
      poll(created.id);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const downloadTemplate = () => {
    const csv = buildBulkTemplateCsv(headers, (header) =>
      variables.find((variable) => mapping[variable.name] === header)?.kind ||
      assignmentTargets.find((target) => assignments[target.id] === header)?.kind ||
      inferBulkHeaderKind(header)
    );
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${(designName || 'bulk-create').replace(/[\\/"]/g, '-')}-template.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const completed = job?.status === 'completed';
  const failed = job?.status === 'failed';
  const progress = job?.progress;
  const results = job?.results || [];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12px] text-newTextColor/65">
        {t('designer_bulk_description', 'Generate editable design variations from CSV or TSV data. Map columns to text, image, and color variables, preview one row, then create the batch.')}
      </p>
      <details className="rounded-md border border-studioBorder p-3 text-[12px] text-newTextColor/65">
        <summary className="cursor-pointer font-medium text-textColor">
          {t('designer_bulk_spreadsheet_format', 'Spreadsheet format')}
        </summary>
        <div className="mt-2 space-y-2">
          <p>{t('designer_bulk_format_headers', 'Use the first row for unique column headers. Plain text works for text; use #RRGGBB for colors.')}</p>
          <p>{t('designer_bulk_format_images', 'Images accept direct HTTPS URLs, Google Drive sharing links, or =IMAGE("https://…") formulas. Single-quoted formulas and semicolon argument separators work too.')}</p>
          <p>{t('designer_bulk_format_atomic', 'Every row is validated first. If any row fails, the whole batch stops without partial designs or a ZIP.')}</p>
          <Button secondary onClick={downloadTemplate}>
            {t('designer_bulk_download_template', 'Download CSV template')}
          </Button>
        </div>
      </details>
      {!job && (
        <>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.tsv,text/csv,text/tab-separated-values"
            className="hidden"
            onChange={(event) => {
              handleFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          <Button
            secondary
            onClick={() => fileInput.current?.click()}
            className="border-dashed border-designerAccent/50 text-btnPrimaryAccent"
          >
            {t('designer_bulk_choose_file', 'Choose CSV or TSV file')}
          </Button>
          {!!sourceRows.length && (
            <div className="text-[11px] text-textColor/60">
              {t('designer_bulk_rows_loaded', '{{count}} data rows loaded', { count: sourceRows.length })}
            </div>
          )}
          {!!variables.length && !!headers.length && (
            <div className="space-y-2">
              <div className="text-[12px] font-medium text-textColor/70">{t('designer_bulk_map_columns', 'Map spreadsheet columns')}</div>
              {variables.map((variable: BulkVariable) => (
                <label key={variable.name} className="grid grid-cols-[1fr_1.4fr] items-center gap-3 text-[12px]">
                  <span className="text-textColor/70">
                    {variable.name} · {t(`designer_bulk_kind_${variable.kind}`, variable.kind)}
                  </span>
                  <select
                    aria-label={t('designer_bulk_mapping_for', 'Column for {{name}}', { name: variable.name })}
                    value={mapping[variable.name] || ''}
                    onChange={(event) => setMapping((current) => ({ ...current, [variable.name]: event.target.value }))}
                    className="h-[30px] px-2 rounded-md bg-newBgColor border border-studioBorder text-textColor"
                  >
                    {headers.map((header) => <option key={header} value={header}>{header}</option>)}
                  </select>
                </label>
              ))}
            </div>
          )}
          {!!rows.length && !!assignmentTargets.length && (
            <div className="space-y-2 rounded-md border border-studioBorder p-3">
              <div className="text-[12px] font-medium text-textColor/70">
                {t('designer_bulk_assign_elements', 'Assign design elements')}
              </div>
              <p className="text-[11px] text-textColor/55">
                {t('designer_bulk_assign_description', 'Choose a spreadsheet column for each text, image, or color you want to vary. One column can feed multiple elements.')}
              </p>
              <div className="max-h-[260px] space-y-2 overflow-y-auto">
                {assignmentTargets.map((target) => (
                  <label key={target.id} className="grid grid-cols-[1fr_1.4fr] items-center gap-3 text-[12px]">
                    <span className="text-textColor/70">
                      {target.label} · {t(`designer_bulk_kind_${target.kind}`, target.kind)}
                    </span>
                    <select
                      aria-label={t('designer_bulk_assignment_for', 'Column for {{name}} ({{kind}})', {
                        name: target.label,
                        kind: target.kind,
                      })}
                      value={assignments[target.id] || ''}
                      onChange={(event) => {
                        setAssignments((current) => ({ ...current, [target.id]: event.target.value }));
                        setPreviewUrl('');
                      }}
                      className="h-[30px] px-2 rounded-md bg-newBgColor border border-studioBorder text-textColor"
                    >
                      <option value="">{t('designer_bulk_not_assigned', 'Do not assign')}</option>
                      {headers.map((header) => <option key={header} value={header}>{header}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              <Button
                secondary
                disabled={!Object.values(assignments).some((column) => !!column)}
                onClick={applyAssignments}
              >
                {t('designer_bulk_apply_assignments', 'Apply variable assignments')}
              </Button>
            </div>
          )}
          {!!rows.length && !variables.length && !assignmentTargets.length && (
            <p className="text-[11px] text-dangerText">
              {t('designer_bulk_no_variables', 'Add an editable text, image, or color element before creating variations.')}
            </p>
          )}
          {!!rows.length && (
            <div className="flex gap-2">
              <Button secondary loading={previewLoading} disabled={!variables.length} onClick={generatePreview}>
                {t('designer_bulk_preview', 'Preview first row')}
              </Button>
              <Button loading={starting} disabled={!variables.length} onClick={start}>
                {t('designer_bulk_start', 'Create {{count}} variations', { count: rows.length })}
              </Button>
            </div>
          )}
          {previewUrl && (
            <div className="rounded-md border border-studioBorder p-2 bg-designerCanvas flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element -- server-rendered row preview */}
              <img src={previewUrl} alt={t('designer_bulk_preview_alt', 'First Bulk Create row')} className="max-h-[300px] object-contain" />
            </div>
          )}
        </>
      )}

      {job && (
        <div className="space-y-3">
          <div className="text-[13px] font-medium text-textColor">
            {completed
              ? t('designer_bulk_complete', 'Bulk Create complete')
              : failed
                ? t('designer_bulk_failed', 'Bulk Create failed')
                : t('designer_bulk_running', 'Creating variations…')}
          </div>
          {progress && (
            <div className="text-[12px] text-textColor/60">
              {t('designer_bulk_progress', '{{done}} of {{total}} rows processed', progress)}
            </div>
          )}
          {job.error && <div role="alert" className="text-[12px] text-dangerText">{job.error}</div>}
          {completed && job.artifactUrl && (
            <a href={job.artifactUrl} target="_blank" rel="noreferrer" className="inline-block px-3 py-2 rounded-md bg-designerAccent text-[12px] text-white hover:bg-designerAccent/80">
              {t('designer_bulk_download_zip', 'Download PNG bundle (.zip)')}
            </a>
          )}
          {!!results.length && (
            <div className="max-h-[260px] overflow-y-auto rounded-md border border-studioBorder divide-y divide-studioBorder">
              {results.map((result) => (
                <div key={result.row} className="flex items-center justify-between gap-3 p-2 text-[12px]">
                  <span className="text-textColor/70">{t('designer_bulk_row', 'Row {{row}}', { row: result.row })}</span>
                  {result.designId ? (
                    <a href={`/media/designer?designId=${result.designId}`} className="text-btnPrimaryAccent hover:underline">
                      {t('designer_bulk_open_design', 'Open editable design')}
                    </a>
                  ) : (
                    <span className="text-dangerText">{result.error || t('designer_bulk_row_failed', 'Failed')}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {error && <div role="alert" className="text-[12px] text-dangerText">{error}</div>}
      <div className="flex justify-end">
        <Button secondary onClick={onClose}>
          {t('close', 'Close')}
        </Button>
      </div>
    </div>
  );
};
