import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { strToU8 } from 'fflate';
import { DesignBulkService, MAX_BULK_ROWS } from './design-bulk.service';
import { DesignRenderService } from './design-render.service';
import { MediaJobLifecycleService } from '@postmill-ai/nestjs-libraries/database/prisma/media-providers/media-job-lifecycle.service';
import { AiSettingsService } from '@postmill-ai/nestjs-libraries/database/prisma/ai-settings/ai-settings.service';
import { DesignService } from '@postmill-ai/nestjs-libraries/database/prisma/design/design.service';
import { DesignerDocService } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.service';
import { FileService } from '@postmill-ai/nestjs-libraries/database/prisma/file/file.service';
import { StorageService } from '@postmill-ai/nestjs-libraries/database/prisma/storage/storage.service';
import { AiMediaService } from '@postmill-ai/nestjs-libraries/ai/governance/media.service';
import { ioRedis } from '@postmill-ai/nestjs-libraries/redis/redis.service';
import { inngest, isInngestEnabled } from '@postmill-ai/nestjs-libraries/inngest/inngest.client';
import { NO_CREDIT } from '@postmill-ai/nestjs-libraries/media/design-render/video-render.service';
import {
  DESIGN_EXPORT_EVENT,
  DESIGN_EXPORT_PROVIDER,
  designExportEventId,
} from '@postmill-ai/nestjs-libraries/media/design-export/design-export.service';
import { applyBulkRow, normalizeBulkImageSource } from '../designer-doc/bulk-variables';
import { readValidatedImageSource } from '../image-source';
import { pageCount } from '../designer-doc/designer-doc.pages';
import { MAX_OUTPUTS, MAX_PAGES_PER_OUTPUT } from '../designer-doc/designer-doc.limits';
import { sanitizeDownloadName } from '../designer-doc/postmill-file';
import { zipBulkEntries, type BulkZipEntry } from './design-bulk-zip';
import type { DesignerDoc, DesignerElement } from './design-render.types';

export const DESIGN_BULK_CREATE_OPERATION = 'design-bulk-create';
const PAYLOAD_TTL_SECONDS = 24 * 60 * 60;
const payloadKey = (jobId: string) => `design-bulk:payload:${jobId}`;
const claimKey = (jobId: string) => `design-bulk:claim:${jobId}`;
const progressKey = (jobId: string) => `design-bulk:progress:${jobId}`;

export interface DesignBulkCreatePayload {
  organizationId: string;
  userId: string;
  nameBase: string;
  folderId?: string;
  folderOwned?: boolean;
  doc: DesignerDoc;
  rows: Record<string, string>[];
  enqueuedAt: string;
}

export interface DesignBulkCreateRowResult {
  row: number;
  designId?: string;
  fileIds: string[];
  error?: string;
}

const errorDetail = (error: unknown, fallback: string): string => {
  const response = (error as BadRequestException)?.getResponse?.();
  if (response && typeof response === 'object') {
    const body = response as { message?: string; issues?: { path?: (string | number)[]; message?: string }[] };
    const issues = (body.issues || []).slice(0, 5).map((issue) =>
      `${(issue.path || []).join('.')}: ${issue.message || 'invalid value'}`
    );
    if (issues.length) return issues.join('; ');
    if (body.message) return body.message;
  }
  return (error as Error)?.message || fallback;
};

export const bulkRowErrorDetail = (
  error: unknown,
  templateDoc: DesignerDoc,
  transformedDoc: DesignerDoc,
  row: Record<string, string>,
): string => {
  const response = (error as BadRequestException)?.getResponse?.();
  const body = response && typeof response === 'object'
    ? response as { issues?: { path?: (string | number)[] }[] }
    : {};
  const issue = (body.issues || []).find((item) => item.path?.at(-1) === 'src');
  if (!issue?.path) return errorDetail(error, 'Invalid DesignerDoc');

  let templateElement: any = (templateDoc as any)[issue.path[0]];
  let transformedElement: any = (transformedDoc as any)[issue.path[0]];
  for (const key of issue.path.slice(1, -1)) {
    templateElement = templateElement?.[key];
    transformedElement = transformedElement?.[key];
  }
  if (!transformedElement || typeof transformedElement.src !== 'string') {
    return errorDetail(error, 'Invalid DesignerDoc');
  }

  let column: string | undefined;
  if (templateElement?.slot?.kind === 'image' && row[templateElement.slot.name] !== undefined) {
    column = templateElement.slot.name;
  } else {
    for (const match of (templateElement?.src || '').matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)) {
      if (row[match[1]] !== undefined) {
        column = match[1];
        break;
      }
    }
  }
  column ||= Object.keys(row).find((key) => normalizeBulkImageSource(row[key]) === transformedElement.src);
  const target = transformedElement.name || transformedElement.id || 'image';
  const hint = column
    ? ` (image column "${column}", element "${target}": use a direct HTTP(S) image URL, same-origin /uploads/ path, data URL, or =IMAGE("https://…"))`
    : '';
  return `${errorDetail(error, 'Invalid DesignerDoc')}${hint}`;
};

interface RemoteImagePreflight {
  row: number;
  url: string;
  documentPath: string;
  column?: string;
}

const rowSchemaPath = (rowIndex: number, column: string): string =>
  `rows[${rowIndex}]${/^[A-Za-z_$][\w$]*$/.test(column) ? `.${column}` : `[${JSON.stringify(column)}]`}`;

@Injectable()
export class DesignBulkCreateService extends DesignBulkService {
  private readonly _logger = new Logger(DesignBulkCreateService.name);

  constructor(
    renderService: DesignRenderService,
    private readonly _lifecycle: MediaJobLifecycleService,
    private readonly _aiSettings: AiSettingsService,
    private readonly _designService: DesignService,
    private readonly _designerDocService: DesignerDocService,
    private readonly _fileService: FileService,
    private readonly _storageService: StorageService,
    private readonly _aiMediaService: AiMediaService,
  ) {
    super(renderService);
  }

  async getJob(orgId: string, jobId: string) {
    const job = await this._aiSettings.getMediaJobById(orgId, jobId);
    if (!job || job.organizationId !== orgId || job.operation !== DESIGN_BULK_CREATE_OPERATION) {
      return null;
    }
    let progress: unknown = null;
    let results: DesignBulkCreateRowResult[] | undefined;
    try {
      const raw = await ioRedis.get(progressKey(jobId));
      if (raw) progress = JSON.parse(raw);
    } catch {
      progress = null;
    }
    try {
      const parsed = job.inputJson ? JSON.parse(job.inputJson) : undefined;
      if (Array.isArray(parsed)) results = parsed;
    } catch {
      results = undefined;
    }
    return {
      id: job.id,
      status: job.status,
      artifactUrl: job.status === 'completed' ? job.artifactUrl : undefined,
      error: job.status === 'failed' ? job.error : undefined,
      progress,
      results,
    };
  }

  async enqueueBulkCreate(
    orgId: string,
    userId: string,
    input: {
      doc: DesignerDoc;
      rows: Record<string, string>[];
      nameBase?: string;
      folderId?: string;
    }
  ) {
    const doc = this._designerDocService.validate(input.doc);
    if (doc.mode !== 'image') {
      throw new BadRequestException('Bulk Create currently supports static image designs only.');
    }
    if (!input.rows.length) throw new BadRequestException('Add at least one data row.');
    if (input.rows.length > MAX_BULK_ROWS) {
      throw new BadRequestException(`Bulk Create is limited to ${MAX_BULK_ROWS} rows.`);
    }
    const rows = input.rows.map((row) => {
      const entries = Object.entries(row);
      if (entries.length > 100) {
        throw new BadRequestException('Each Bulk Create row is limited to 100 columns.');
      }
      for (const [key, value] of entries) {
        if (!key.trim() || key.length > 120 || typeof value !== 'string' || value.length > 10000) {
          throw new BadRequestException('Spreadsheet values must be strings of at most 10,000 characters with named columns.');
        }
      }
      return Object.fromEntries(entries);
    });
    const templateSources = this._templateSources(doc);
    const sources: RemoteImagePreflight[] = [];
    const sourceUrls = new Set<string>();
    for (const [index, row] of rows.entries()) {
      const transformedDoc = applyBulkRow(doc, row);
      try {
        const validatedDoc = this._designerDocService.validate(transformedDoc);
        this._collectRemoteImageSources(
          doc, validatedDoc, row, index, templateSources, sources, sourceUrls,
        );
      } catch (error) {
        throw new BadRequestException(
          `Row ${index + 1}: ${bulkRowErrorDetail(error, doc, transformedDoc, row)}`.slice(0, 1000)
        );
      }
    }
    await this._preflightRemoteImages(sources);
    if (input.folderId) await this._fileService.getFolder(orgId, input.folderId);

    const nameBase = sanitizeDownloadName(input.nameBase || 'Bulk variation') || 'Bulk variation';
    const job = await this._lifecycle.createPendingJob({
      organizationId: orgId,
      userId,
      provider: DESIGN_EXPORT_PROVIDER,
      operation: DESIGN_BULK_CREATE_OPERATION,
      costUsd: 0,
      creditType: NO_CREDIT,
    });
    const folderId = input.folderId || (await this._fileService.createFolder(orgId, {
      name: `${nameBase} (${job.id})`,
    })).id;
    const payload: DesignBulkCreatePayload = {
      organizationId: orgId,
      userId,
      nameBase,
      folderId,
      folderOwned: !input.folderId,
      doc,
      rows,
      enqueuedAt: new Date().toISOString(),
    };
    await ioRedis.set(payloadKey(job.id), JSON.stringify(payload), 'EX', PAYLOAD_TTL_SECONDS);
    if (isInngestEnabled()) {
      await inngest.send({
        name: DESIGN_EXPORT_EVENT,
        data: { jobId: job.id },
        id: designExportEventId(job.id),
      });
    }
    return { id: job.id, status: job.status };
  }

  private _collectRemoteImageSources(
    templateDoc: DesignerDoc,
    transformedDoc: DesignerDoc,
    row: Record<string, string>,
    rowIndex: number,
    templateSources: Set<string>,
    sources: RemoteImagePreflight[],
    sourceUrls: Set<string>,
  ): void {
    const collect = (
      templateElement: DesignerElement,
      element: DesignerElement,
      elementPath: string,
    ) => {
      const add = (
        url: string | undefined,
        templateUrl: string | undefined,
        documentPath: string,
      ) => {
        if (
          !url || !/^https?:\/\//i.test(url) || templateSources.has(url) || sourceUrls.has(url)
        ) return;
        let column: string | undefined;
        if (templateElement.slot?.kind === 'image' && row[templateElement.slot.name] !== undefined) {
          column = templateElement.slot.name;
        } else {
          for (const match of (templateUrl || '').matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)) {
            if (row[match[1]] !== undefined) {
              column = match[1];
              break;
            }
          }
        }
        column ||= Object.keys(row).find((key) => normalizeBulkImageSource(row[key]) === url);
        sourceUrls.add(url);
        sources.push({ row: rowIndex + 1, url, documentPath, column });
      };

      add(element.src, templateElement.src, `${elementPath}.src`);
      for (const [overrideId, override] of Object.entries(element.symbolOverrides || {})) {
        add(
          override.src,
          templateElement.symbolOverrides?.[overrideId]?.src,
          `${elementPath}.symbolOverrides.${overrideId}.src`,
        );
      }
    };
    const collectChildren = (
      templateChildren: DesignerElement[] | undefined,
      children: DesignerElement[] | undefined,
      path: string,
    ) => {
      for (const [elementIndex, element] of (children || []).entries()) {
        const templateElement = templateChildren?.[elementIndex];
        if (templateElement) collect(templateElement, element, `${path}.${elementIndex}`);
      }
    };

    for (const [outputIndex, output] of transformedDoc.outputs.entries()) {
      if (!('children' in output)) continue;
      const templateOutput = templateDoc.outputs[outputIndex];
      if (!templateOutput || !('children' in templateOutput)) continue;
      collectChildren(templateOutput.children, output.children, `outputs.${outputIndex}.children`);
      for (const [pageIndex, page] of (output.pages || []).entries()) {
        collectChildren(
          templateOutput.pages?.[pageIndex]?.children,
          page.children,
          `outputs.${outputIndex}.pages.${pageIndex}.children`,
        );
      }
    }
    for (const [symbolIndex, symbol] of (transformedDoc.symbols || []).entries()) {
      collectChildren(
        templateDoc.symbols?.[symbolIndex]?.children,
        symbol.children,
        `symbols.${symbolIndex}.children`,
      );
    }
  }

  private async _preflightRemoteImages(sources: RemoteImagePreflight[]): Promise<void> {
    for (const source of sources) {
      try {
        await readValidatedImageSource(source.url);
      } catch (error) {
        const path = source.column
          ? `${rowSchemaPath(source.row - 1, source.column)} (${source.documentPath})`
          : source.documentPath;
        throw new BadRequestException(
          `Row ${source.row}: ${path}: ${errorDetail(error, 'Image preflight failed')}`.slice(0, 1000),
        );
      }
    }
  }

  private _templateSources(doc: DesignerDoc): Set<string> {
    const sources = new Set<string>();
    const collect = (element: DesignerElement) => {
      if (element.src) sources.add(element.src);
      for (const override of Object.values(element.symbolOverrides || {})) {
        if (override.src) sources.add(override.src);
      }
    };
    for (const output of doc.outputs) {
      if (!('children' in output)) continue;
      for (const element of output.children || []) collect(element);
      for (const page of output.pages || []) {
        for (const element of page.children || []) collect(element);
      }
    }
    for (const symbol of doc.symbols || []) {
      for (const element of symbol.children || []) collect(element);
    }
    return sources;
  }

  private async _writeProgress(jobId: string, done: number, total: number): Promise<boolean> {
    try {
      const job = await this._aiSettings.getMediaJobByIdUnscoped(jobId);
      if (job?.status !== 'processing') return false;
      await this._aiSettings.updateMediaJob(job.organizationId, jobId, { status: 'processing' });
      await ioRedis.set(
        progressKey(jobId),
        JSON.stringify({ done, total, updatedAt: Date.now() }),
        'EX',
        PAYLOAD_TTL_SECONDS
      );
    } catch {
      // A transient progress failure must not stop the batch itself.
    }
    return true;
  }

  private async _persistRemoteImages(
    orgId: string,
    doc: DesignerDoc,
    cache: Map<string, { id: string; path: string }>,
    templateSources: Set<string>
  ): Promise<void> {
    const importUrl = async (url: string) => {
      if (!cache.has(url)) {
        cache.set(url, await this._aiMediaService.saveUrlToFile(orgId, url, 'bulk-create'));
      }
      return cache.get(url)!;
    };
    const persist = async (element: DesignerElement) => {
      if (element.src && !templateSources.has(element.src) && /^https?:\/\//i.test(element.src)) {
        const file = await importUrl(element.src);
        element.src = file.path;
        element.fileId = file.id;
      }
      for (const override of Object.values(element.symbolOverrides || {})) {
        if (!override.src || templateSources.has(override.src) || !/^https?:\/\//i.test(override.src)) continue;
        const file = await importUrl(override.src);
        override.src = file.path;
        override.fileId = file.id;
      }
    };
    for (const output of doc.outputs) {
      if (!('children' in output)) continue;
      for (const element of output.children || []) await persist(element);
      for (const page of output.pages || []) {
        for (const element of page.children || []) await persist(element);
      }
    }
    for (const symbol of doc.symbols || []) {
      for (const element of symbol.children || []) await persist(element);
    }
  }

  private async _saveBuffer(
    orgId: string,
    data: { name: string; bytes: Buffer; folderId?: string; jobId: string }
  ): Promise<{ id: string; path: string }> {
    const adapter = await this._storageService.getLocalAdapterForOrg(orgId, true);
    const path = await adapter.writeBuffer(data.bytes, 'image/png');
    return this._fileService.saveGeneratedMedia(orgId, {
      name: data.name,
      path,
      type: 'image',
      folderId: data.folderId,
      fileSize: data.bytes.length,
      metadata: { source: DESIGN_BULK_CREATE_OPERATION, jobId: data.jobId, mime: 'image/png' },
    });
  }

  private async _rollbackBulkCreate(
    orgId: string,
    payload: DesignBulkCreatePayload | undefined,
    designIds: string[],
    previewFileIds: string[],
    generatedFileIds: Set<string>,
    remoteImageCache: Map<string, { id: string; path: string }>,
  ): Promise<void> {
    if (!payload) return;
    for (const id of designIds) {
      try {
        await this._designService.deleteDesign(orgId, id);
      } catch (error) {
        this._logger.warn(`Bulk Create rollback could not delete design ${id}: ${(error as Error)?.message}`);
      }
    }
    const fileIds = new Set([
      ...generatedFileIds,
      ...previewFileIds,
      ...[...remoteImageCache.values()].map((file) => file.id),
    ]);
    for (const id of fileIds) {
      try {
        await this._fileService.deleteFile(orgId, id);
      } catch (error) {
        this._logger.warn(`Bulk Create rollback could not delete file ${id}: ${(error as Error)?.message}`);
      }
    }
    if (payload.folderOwned) {
      try {
        await this._fileService.deleteFolder(orgId, payload.folderId);
      } catch (error) {
        this._logger.warn(`Bulk Create rollback could not delete batch folder: ${(error as Error)?.message}`);
      }
    }
  }

  async processBulkCreate(jobId: string): Promise<void> {
    const job = await this._aiSettings.getMediaJobByIdUnscoped(jobId);
    if (!job || job.operation !== DESIGN_BULK_CREATE_OPERATION || job.status !== 'pending') return;
    const orgId = job.organizationId;
    const raw = await ioRedis.get(payloadKey(jobId));
    if (!raw) {
      await this._aiSettings.updateMediaJob(orgId, jobId, {
        status: 'failed',
        error: 'Bulk Create payload expired — please start the batch again',
      });
      return;
    }
    const claimed = (await ioRedis.set(claimKey(jobId), '1', 'EX', PAYLOAD_TTL_SECONDS, 'NX')) !== null;
    if (!claimed) return;
    await this._aiSettings.updateMediaJob(orgId, jobId, { status: 'processing' });

    const results: DesignBulkCreateRowResult[] = [];
    const remoteImageCache = new Map<string, { id: string; path: string }>();
    const designIds: string[] = [];
    const previewFileIds: string[] = [];
    const generatedFileIds = new Set<string>();
    let payload: DesignBulkCreatePayload | undefined;
    try {
      payload = JSON.parse(raw) as DesignBulkCreatePayload;
      const rows = payload.rows.slice(0, MAX_BULK_ROWS);
      const templateSources = this._templateSources(payload.doc);
      const zipEntries: BulkZipEntry[] = [];
      let zipBytes = 0;
      let succeeded = 0;
      const rowCount = Math.min(rows.length, MAX_BULK_ROWS);
      for (let index = 0; index < rowCount; index++) {
        const result: DesignBulkCreateRowResult = { row: index + 1, fileIds: [] };
        try {
          const doc = applyBulkRow(payload.doc, rows[index]);
          await this._persistRemoteImages(orgId, doc, remoteImageCache, templateSources);
          const name = `${payload.nameBase} ${index + 1}`;
          const design = await this._designService.createDesign(orgId, payload.userId, { name, doc });
          designIds.push(design.id);
          if (design.previewFileId) previewFileIds.push(design.previewFileId);
          result.designId = design.id;
          const outputCount = Math.min(doc.outputs.length, MAX_OUTPUTS);
          for (let outputIndex = 0; outputIndex < outputCount; outputIndex++) {
            const output = doc.outputs[outputIndex];
            if (!('children' in output)) continue;
            const pages = Math.min(pageCount(output), MAX_PAGES_PER_OUTPUT);
            for (let page = 0; page < pages; page++) {
              const bytes = await this._renderService.renderPage(doc, outputIndex, { orgId }, page);
              zipBytes += bytes.length;
              if (zipBytes > 128 * 1024 * 1024) {
                throw new Error('Bulk Create PNG output exceeds the 128 MB batch limit.');
              }
              const filename = `row-${String(index + 1).padStart(3, '0')}-output-${outputIndex + 1}-page-${page + 1}.png`;
              const file = await this._saveBuffer(orgId, {
                name: `${payload.nameBase} ${filename}`,
                bytes,
                folderId: payload.folderId,
                jobId,
              });
              generatedFileIds.add(file.id);
              result.fileIds.push(file.id);
              zipEntries.push({ name: filename, data: new Uint8Array(bytes), compress: false });
            }
          }
          succeeded++;
        } catch (error) {
          result.error = errorDetail(error, 'Row failed').slice(0, 500);
          this._logger.warn(`Bulk Create ${jobId}: row ${index + 1} failed: ${result.error}`);
          results.push(result);
          throw new Error(`Row ${index + 1}: ${result.error}`);
        }
        results.push(result);
        if (!(await this._writeProgress(jobId, index + 1, rows.length))) {
          throw new Error('Bulk Create was cancelled before completion');
        }
      }

      if (!succeeded) throw new Error(results[0]?.error || 'Every Bulk Create row failed.');
      const bytes = await zipBulkEntries([
        {
          name: 'results.json',
          data: strToU8(JSON.stringify(results, null, 2)),
          compress: true,
        },
        ...zipEntries,
      ]);
      const adapter = await this._storageService.getLocalAdapterForOrg(orgId, true);
      const artifactPath = await adapter.writeBuffer(bytes, 'application/zip');
      const artifactFile = await this._fileService.saveGeneratedMedia(orgId, {
        name: `${payload.nameBase}.zip`,
        path: artifactPath,
        type: 'document',
        folderId: payload.folderId,
        fileSize: bytes.length,
        metadata: { source: DESIGN_BULK_CREATE_OPERATION, jobId, mime: 'application/zip' },
      });
      generatedFileIds.add(artifactFile.id);
      const current = await this._aiSettings.getMediaJobByIdUnscoped(jobId);
      if (current?.status !== 'processing') {
        throw new Error('Bulk Create was cancelled before completion');
      }
      await this._aiSettings.updateMediaJob(orgId, jobId, {
        status: 'completed',
        artifactUrl: artifactPath,
        inputJson: JSON.stringify(results),
        error: null,
      });
    } catch (error) {
      await this._rollbackBulkCreate(
        orgId,
        payload,
        designIds,
        previewFileIds,
        generatedFileIds,
        remoteImageCache,
      );
      for (const result of results) {
        delete result.designId;
        result.fileIds = [];
      }
      const message = ((error as Error)?.message || 'Bulk Create failed').slice(0, 1000);
      this._logger.warn(`Bulk Create ${jobId} failed: ${message}`);
      await this._aiSettings.updateMediaJob(orgId, jobId, {
        status: 'failed',
        error: message,
        inputJson: results.length ? JSON.stringify(results) : undefined,
      });
    } finally {
      await Promise.all([
        ioRedis.del(payloadKey(jobId)),
        ioRedis.del(claimKey(jobId)),
      ]);
    }
  }
}
