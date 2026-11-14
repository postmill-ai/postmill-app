import type { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import type { DesignerDoc, DesignerOutput } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import { readErrorMessage } from './read-error-message';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const EXPORT_REQUEST_TIMEOUT_MS = 120_000;
export const RENDER_RETRY_BACKOFF_MS = 750;

export type ExportFallbackFormat = 'png' | 'jpeg' | 'transparent' | 'webp';

export const getDefaultFormat = (formatId?: string): 'png' | 'jpeg' | 'webp' => {
  if (!formatId) return 'png';
  if (formatId.startsWith('ig-')) return 'jpeg';
  if (formatId.startsWith('fb-')) return 'jpeg';
  if (formatId.startsWith('x-')) return 'webp';
  if (formatId.startsWith('linkedin-')) return 'webp';
  if (formatId.startsWith('tiktok')) return 'jpeg';
  if (formatId.startsWith('yt-')) return 'jpeg';
  if (formatId.startsWith('pinterest-')) return 'png';
  return 'png';
};

export type ExportStage = 'preview' | 'render' | 'upload';
export type ExportFailureKind = 'http' | 'network' | 'timeout' | 'abort' | 'oversize' | 'unknown';

export interface ExportRequestContext {
  stage: ExportStage;
  outputIndex?: number;
  pageNumber?: number;
  format: string;
  scale: number;
  signal?: AbortSignal;
}

export interface ExportDiagnostic {
  stage: ExportStage;
  output: number;
  page: number;
  format: string;
  scale: number;
  status: number | ExportFailureKind;
  kind: ExportFailureKind;
}

interface FallbackRenderResult {
  blob: Blob;
  usedFormat: ExportFallbackFormat;
  usedQuality: number;
  usedScale: number;
}

const stageLabel = (stage: ExportStage) =>
  stage === 'preview' ? 'Preview' : stage === 'upload' ? 'Upload' : 'Render';

export const isUncertainUpload = (diagnostic: ExportDiagnostic) =>
  diagnostic.stage === 'upload' &&
  (['network', 'timeout', 'unknown'].includes(diagnostic.kind) ||
    (diagnostic.kind === 'http' &&
      typeof diagnostic.status === 'number' &&
      [502, 503, 504].includes(diagnostic.status)));

export const canRetryExport = (diagnostic: ExportDiagnostic) => {
  if (diagnostic.stage === 'upload') {
    return diagnostic.kind === 'http' &&
      typeof diagnostic.status === 'number' &&
      diagnostic.status >= 500 &&
      !isUncertainUpload(diagnostic);
  }
  return diagnostic.kind === 'network' ||
    diagnostic.kind === 'timeout' ||
    (diagnostic.kind === 'http' &&
      typeof diagnostic.status === 'number' &&
      [502, 503, 504].includes(diagnostic.status));
};

const safeExportMessage = (stage: ExportStage, kind: ExportFailureKind, status?: number) => {
  const label = stageLabel(stage);
  const diagnostic = { stage, kind, status: status ?? kind } as ExportDiagnostic;
  const retry = canRetryExport(diagnostic)
    ? stage === 'preview'
      ? ' You can still try the final export.'
      : ' Retry this output; completed exports were kept.'
    : isUncertainUpload(diagnostic)
      ? ' The upload outcome is uncertain. Check Files before uploading again.'
      : '';
  if (kind === 'http') return `${label} failed with HTTP ${status ?? 'error'}.${retry}`;
  if (kind === 'network') return `${label} could not reach the server. Check your connection.${retry}`;
  if (kind === 'timeout') return `${label} took too long.${retry}`;
  if (kind === 'abort') return `${label} was cancelled.`;
  return `${label} could not be completed.${retry}`;
};

const diagnosticFor = (
  context: ExportRequestContext,
  kind: ExportFailureKind,
  status?: number,
  scale = context.scale,
): ExportDiagnostic => ({
  stage: context.stage,
  output: (context.outputIndex ?? 0) + 1,
  page: (context.pageNumber ?? 0) + 1,
  format: context.format,
  scale,
  status: status ?? kind,
  kind,
});

export class DesignerExportError extends Error {
  readonly diagnostic: ExportDiagnostic;
  readonly reported: boolean;
  readonly serverReason?: string;

  constructor(diagnostic: ExportDiagnostic, message?: string, reported = false, serverReason?: string) {
    super(message ?? serverReason ?? safeExportMessage(
      diagnostic.stage,
      diagnostic.kind,
      typeof diagnostic.status === 'number' ? diagnostic.status : undefined,
    ));
    this.name = 'DesignerExportError';
    this.diagnostic = diagnostic;
    this.reported = reported;
    this.serverReason = serverReason;
  }
}

const reportExportFailure = (error: DesignerExportError) => {
  if (error.reported || error.diagnostic.kind === 'abort') return error;
  console.warn('[designer-export]', error.diagnostic);
  return new DesignerExportError(error.diagnostic, error.message, true, error.serverReason);
};

const requestError = (
  context: ExportRequestContext,
  kind: ExportFailureKind,
  status?: number,
) => new DesignerExportError(diagnosticFor(context, kind, status));

const fetchOnce = async <T>(
  path: string,
  init: RequestInit,
  fetchFn: ReturnType<typeof useFetch>,
  context: ExportRequestContext,
  read: (response: Response) => Promise<T>,
): Promise<T> => {
  const isUpload = context.stage === 'upload';
  const controller = isUpload ? null : new AbortController();
  const externalSignal = isUpload ? undefined : context.signal;
  let timedOut = false;
  const abort = () => controller?.abort();
  if (externalSignal?.aborted) throw requestError(context, 'abort');
  externalSignal?.addEventListener('abort', abort, { once: true });
  const timeout = controller
    ? setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, EXPORT_REQUEST_TIMEOUT_MS)
    : null;

  try {
    const response = await fetchFn(path, { ...init, signal: controller?.signal });
    if (!response.ok) {
      const diagnostic = diagnosticFor(context, 'http', response.status);
      const serverReason = response.status >= 400 && response.status < 500
        ? await readErrorMessage(response, '')
        : '';
      throw new DesignerExportError(diagnostic, serverReason || undefined, false, serverReason || undefined);
    }
    return await read(response);
  } catch (error) {
    if (error instanceof DesignerExportError) throw error;
    const kind = externalSignal?.aborted
      ? 'abort'
      : timedOut
        ? 'timeout'
        : (error as { name?: string })?.name === 'AbortError'
          ? 'abort'
          : 'network';
    throw requestError(context, kind);
  } finally {
    if (timeout) clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', abort);
  }
};

const waitForRenderRetry = async (context: ExportRequestContext) => {
  if (context.signal?.aborted) throw requestError(context, 'abort');
  await new Promise<void>((resolve, reject) => {
    const signal = context.signal;
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, RENDER_RETRY_BACKOFF_MS);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(requestError(context, 'abort'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
};

const canRetryRender = (error: DesignerExportError) => canRetryExport(error.diagnostic);

class ExportSizeError extends Error {}

export const renderWithFormatFallback = async (
  format: ExportFallbackFormat,
  quality: number,
  scale: number,
  tryRender: (format: ExportFallbackFormat, quality: number, scale: number) => Promise<Blob>,
): Promise<FallbackRenderResult> => {
  const scales = [scale, ...[2, 1].filter((candidate) => candidate < scale)];
  const qualities = format === 'jpeg' || format === 'webp'
    ? [quality, Math.min(quality, 0.7), Math.min(quality, 0.5)]
        .filter((candidate, index, values) => values.indexOf(candidate) === index)
    : [quality];

  for (const nextScale of scales) {
    for (const nextQuality of qualities) {
      const blob = await tryRender(format, nextQuality, nextScale);
      if (blob.size <= MAX_UPLOAD_BYTES) {
        return {
          blob,
          usedFormat: format,
          usedQuality: nextQuality,
          usedScale: nextScale,
        };
      }
    }
  }

  const label = format === 'transparent' ? 'Transparent PNG' : format.toUpperCase();
  throw new ExportSizeError(`Could not reduce ${label} under 10 MB. Choose a smaller scale or JPEG.`);
};

export const renderOutputWithFallback = async (
  doc: DesignerDoc,
  output: DesignerOutput,
  format: ExportFallbackFormat,
  quality: number,
  scale: number,
  fetchFn: ReturnType<typeof useFetch>,
  context: Omit<ExportRequestContext, 'format' | 'scale'> = { stage: 'render' },
): Promise<FallbackRenderResult> => {
  try {
    return await renderWithFormatFallback(format, quality, scale, async (nextFormat, nextQuality, nextScale) => {
      const requestContext: ExportRequestContext = {
        ...context,
        format: nextFormat,
        scale: nextScale,
      };
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return await fetchOnce('/media/designs/render', {
            method: 'POST',
            body: JSON.stringify({
              doc: { ...doc, outputs: [output] },
              outputIndex: 0,
              pageNumber: 0,
              format: nextFormat === 'transparent' ? 'png' : nextFormat,
              quality: nextQuality,
              pixelRatio: nextScale,
              transparent: nextFormat === 'transparent',
            }),
          }, fetchFn, requestContext, (response) => response.blob());
        } catch (error) {
          const failure = error instanceof DesignerExportError
            ? error
            : requestError(requestContext, 'unknown');
          if (attempt === 0 && canRetryRender(failure)) {
            await waitForRenderRetry(requestContext);
            continue;
          }
          throw reportExportFailure(failure);
        }
      }
      throw reportExportFailure(requestError(requestContext, 'unknown'));
    });
  } catch (error) {
    if (error instanceof ExportSizeError) {
      throw reportExportFailure(new DesignerExportError(
        diagnosticFor({ ...context, format, scale }, 'oversize'),
        error.message,
      ));
    }
    throw error;
  }
};

export const renderPdfWithDiagnostics = async (
  doc: DesignerDoc,
  fetchFn: ReturnType<typeof useFetch>,
  context: Omit<ExportRequestContext, 'format' | 'scale'> = { stage: 'render' },
): Promise<Blob> => {
  const requestContext: ExportRequestContext = { ...context, format: 'pdf', scale: 1 };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fetchOnce('/media/designs/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc, format: 'pdf' }),
      }, fetchFn, requestContext, (response) => response.blob());
    } catch (error) {
      const failure = error instanceof DesignerExportError ? error : requestError(requestContext, 'unknown');
      if (attempt === 0 && canRetryRender(failure)) {
        await waitForRenderRetry(requestContext);
        continue;
      }
      throw reportExportFailure(failure);
    }
  }
  throw reportExportFailure(requestError(requestContext, 'unknown'));
};

export const uploadExportBlob = async (
  endpoint: string,
  formData: FormData,
  fetchFn: ReturnType<typeof useFetch>,
  context: Omit<ExportRequestContext, 'stage' | 'signal'>,
): Promise<{ id: string; path: string }> => {
  const requestContext: ExportRequestContext = { ...context, stage: 'upload' };
  try {
    return await fetchOnce(
      endpoint,
      { method: 'POST', body: formData },
      fetchFn,
      requestContext,
      async (response) => {
        try {
          const saved = await response.json() as { id?: unknown; path?: unknown };
          if (typeof saved.id !== 'string' || typeof saved.path !== 'string') {
            throw requestError(requestContext, 'http', response.status);
          }
          return { id: saved.id, path: saved.path };
        } catch (error) {
          if (error instanceof DesignerExportError) throw error;
          throw requestError(requestContext, 'http', response.status);
        }
      },
    );
  } catch (error) {
    throw reportExportFailure(error instanceof DesignerExportError ? error : requestError(requestContext, 'unknown'));
  }
};

export interface StaticExportTask {
  key: string;
  outputId: string;
  outputIndex: number;
  pageNumber: number;
  format: string;
  scale: number;
  fileName: string;
  alt?: string;
  render: () => Promise<Blob>;
}

export interface StaticExportCompleted {
  key: string;
  id: string;
  path: string;
  name: string;
  outputId: string;
  outputIndex: number;
  pageNumber: number;
  alt?: string;
}

export interface StaticExportFailure {
  key: string;
  outputId: string;
  outputIndex: number;
  pageNumber: number;
  stage: ExportStage;
  diagnostic: ExportDiagnostic;
  message: string;
  serverReason?: string;
}

export interface StaticExportPendingUpload {
  task: StaticExportTask;
  blob: Blob;
}

export interface StaticExportBatchState {
  completed: StaticExportCompleted[];
  failures: StaticExportFailure[];
  pendingUploads: StaticExportPendingUpload[];
}

export const emptyStaticExportBatch = (): StaticExportBatchState => ({
  completed: [],
  failures: [],
  pendingUploads: [],
});

const taskFailure = (
  error: unknown,
  task: StaticExportTask,
  stage: ExportStage,
) => {
  if (error instanceof DesignerExportError) return error;
  return reportExportFailure(new DesignerExportError(diagnosticFor({
    stage,
    outputIndex: task.outputIndex,
    pageNumber: task.pageNumber,
    format: task.format,
    scale: task.scale,
  }, 'unknown')));
};

export const runStaticExportBatch = async (
  tasks: StaticExportTask[],
  upload: (blob: Blob, task: StaticExportTask) => Promise<{ id: string; path: string }>,
  previous: StaticExportBatchState = emptyStaticExportBatch(),
  options: {
    retryFailedOnly?: boolean;
    outputId?: string;
    signal?: AbortSignal;
    onTaskSettled?: (task: StaticExportTask) => void;
  } = {},
): Promise<StaticExportBatchState> => {
  const currentKeys = new Set(tasks.map((task) => task.key));
  const completed = new Map(previous.completed.filter((file) => currentKeys.has(file.key)).map((file) => [file.key, file]));
  const failures = new Map(previous.failures.filter((failure) => currentKeys.has(failure.key)).map((failure) => [failure.key, failure]));
  const pendingUploads = new Map(previous.pendingUploads.filter((pending) => currentKeys.has(pending.task.key)).map((pending) => [pending.task.key, pending]));
  const eligible = tasks.filter((task) =>
    !completed.has(task.key) &&
    (!options.retryFailedOnly ||
      (failures.has(task.key) && (!options.outputId || task.outputId === options.outputId))),
  );

  for (const task of eligible) {
    if (options.signal?.aborted) break;
    let blob: Blob;
    try {
      blob = pendingUploads.get(task.key)?.blob ?? await task.render();
    } catch (error) {
      if ((error instanceof DesignerExportError && error.diagnostic.kind === 'abort') ||
        (error as { name?: string })?.name === 'AbortError') {
        break;
      }
      const failure = taskFailure(error, task, 'render');
      failures.set(task.key, {
        key: task.key,
        outputId: task.outputId,
        outputIndex: task.outputIndex,
        pageNumber: task.pageNumber,
        stage: failure.diagnostic.stage,
        diagnostic: failure.diagnostic,
        message: failure.message,
        serverReason: failure.serverReason,
      });
      options.onTaskSettled?.(task);
      continue;
    }

    if (options.signal?.aborted) break;
    try {
      const saved = await upload(blob, task);
      completed.set(task.key, {
        key: task.key,
        id: saved.id,
        path: saved.path,
        name: task.fileName,
        outputId: task.outputId,
        outputIndex: task.outputIndex,
        pageNumber: task.pageNumber,
        alt: task.alt,
      });
      failures.delete(task.key);
      pendingUploads.delete(task.key);
    } catch (error) {
      const failure = taskFailure(error, task, 'upload');
      pendingUploads.set(task.key, { task, blob });
      failures.set(task.key, {
        key: task.key,
        outputId: task.outputId,
        outputIndex: task.outputIndex,
        pageNumber: task.pageNumber,
        stage: 'upload',
        diagnostic: failure.diagnostic,
        message: failure.message,
        serverReason: failure.serverReason,
      });
    }
    options.onTaskSettled?.(task);
  }

  return {
    completed: Array.from(completed.values()),
    failures: Array.from(failures.values()),
    pendingUploads: Array.from(pendingUploads.values()),
  };
};
