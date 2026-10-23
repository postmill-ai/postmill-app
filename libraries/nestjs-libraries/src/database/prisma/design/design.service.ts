import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createReadStream, promises as fs } from 'fs';
import { resolve, relative, isAbsolute } from 'path';
import { tmpdir } from 'os';
import { DesignRepository } from '@postmill-ai/nestjs-libraries/database/prisma/design/design.repository';
import { DesignerDocService } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.service';
import type { DesignerDoc } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import { DESIGNER_DOC_VERSION } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.limits';
import {
  hasZipMagic,
  parseDesignJson,
  parsePostmillFile,
  parsePostmillFileStream,
  PostmillFileError,
  sanitizeDownloadName,
  ParsedPostmillFile,
  PostmillFileManifest,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/postmill-file';
import {
  rewriteDocFileRefs,
  FileRefRemap,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/doc-file-refs';
import { DESIGN_IMPORT_MAX_BYTES } from '@postmill-ai/nestjs-libraries/upload/design-import.validation';
import { FileService } from '@postmill-ai/nestjs-libraries/database/prisma/file/file.service';
import { StorageService } from '@postmill-ai/nestjs-libraries/database/prisma/storage/storage.service';
import { BrandsService } from '@postmill-ai/nestjs-libraries/brands/brands.service';
import { DesignPreviewService } from '@postmill-ai/nestjs-libraries/media/design-render/design-preview.service';
import { isBlankDoc } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc-blank';

// Resolve a multer-supplied spool path and confine it to the OS temp dir,
// returning the resolved path only when it stays inside tmpdir (else null).
// The containment test is a `path.relative` escape check — the sanitizer shape
// CodeQL's js/path-injection query recognizes — and sinks must use the
// returned (resolved) value, not the raw input. Same pattern as
// upload/custom.upload.validation.ts.
const resolveInsideTmp = (p: string): string | null => {
  const resolved = resolve(p);
  const rel = relative(resolve(tmpdir()), resolved);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? resolved : null;
};

/** First bytes of a disk-spooled upload, for zip-vs-json detection without reading the file. */
const readFileHead = async (path: string): Promise<Buffer> => {
  const safePath = resolveInsideTmp(path);
  if (!safePath) {
    throw new BadRequestException('Invalid file upload.');
  }
  const handle = await fs.open(safePath, 'r');
  try {
    const head = Buffer.alloc(4);
    await handle.read(head, 0, 4, 0);
    return head;
  } finally {
    await handle.close();
  }
};

/**
 * Every `.pdesign` parse failure maps to a 400 whose message names the actual
 * problem — a corrupt upload and a file written by a NEWER Postmill must not
 * read the same to the user.
 */
const importErrorToHttp = (err: unknown): BadRequestException => {
  if (err instanceof PostmillFileError) {
    switch (err.code) {
      case 'corrupt':
        return new BadRequestException('The uploaded file is not a readable .pdesign archive');
      case 'missing-entry':
        return new BadRequestException('The .pdesign file is missing its manifest or document');
      case 'wrong-type':
        return new BadRequestException('This is not a Postmill design file');
      case 'unsupported-format-version':
      case 'unsupported-doc-version':
        return new BadRequestException(err.message);
      default:
        return new BadRequestException('The uploaded file is not valid JSON');
    }
  }
  return new BadRequestException('Could not read the uploaded design file');
};

@Injectable()
export class DesignService {
  private readonly _logger = new Logger(DesignService.name);

  /**
   * Best-effort throttle for server-side video preview regen: at most one
   * render per design per window. In-memory only — a restart loses the state
   * (acceptable: the next save just renders again), and the map is cleared if
   * it ever grows past a bound so long-lived processes don't accumulate ids.
   */
  private static readonly PREVIEW_REGEN_THROTTLE_MS = 60_000;
  private static readonly PREVIEW_REGEN_MAP_CAP = 10_000;
  private readonly _previewRegenAt = new Map<string, number>();

  constructor(
    private readonly _designRepository: DesignRepository,
    private readonly _designerDocService: DesignerDocService,
    private readonly _fileService: FileService,
    private readonly _designPreviewService: DesignPreviewService,
    private readonly _storageService: StorageService,
    private readonly _brandsService: BrandsService,
  ) {}

  async getDesign(orgId: string, id: string) {
    return this._designRepository.findById(orgId, id);
  }

  async listDesigns(orgId: string, page: number = 1, limit: number = 20) {
    const [designs, total] = await Promise.all([
      this._designRepository.findByOrg(orgId, page, limit),
      this._designRepository.countByOrg(orgId),
    ]);
    return {
      designs: designs.map((design) => ({
        ...design,
        previewUrl: (design as any).previewFile?.path ?? design.previewDataUrl ?? null,
        mode: (design.doc as any)?.mode === 'video' ? 'video' : 'image',
      })),
      total,
      page,
      limit,
    };
  }

  async createDesign(orgId: string, userId: string, data: {
    name: string;
    doc: any;
    width?: number;
    height?: number;
    previewDataUrl?: string;
    previewFileId?: string;
    campaignId?: string;
  }) {
    let payload: any = { ...data, organizationId: orgId, createdById: userId };
    if (data.previewFileId) {
      await this._assertOwnedFile(orgId, data.previewFileId);
    }
    if (data.doc !== undefined) {
      const validatedDoc = this._designerDocService.validate(data.doc);
      const firstOutput = validatedDoc.outputs[0];
      payload = {
        ...payload,
        doc: validatedDoc,
        width: firstOutput.width,
        height: firstOutput.height,
      };
      if (validatedDoc.mode === 'video') {
        // A client live-stage snapshot of a video doc is an unpainted black
        // frame — render the poster server-side instead. Creates are never
        // throttled.
        const regenId = await this._renderVideoPreview(orgId, validatedDoc);
        if (regenId) {
          await this._cleanupReplacedFile(orgId, data.previewFileId, regenId);
          payload.previewFileId = regenId;
        }
      }
    }
    return this._designRepository.create(payload);
  }

  async updateDesign(orgId: string, id: string, data: {
    name?: string;
    doc?: any;
    width?: number;
    height?: number;
    previewDataUrl?: string;
    previewFileId?: string;
  }) {
    let payload: any = { ...data };
    if (data.previewFileId) {
      await this._assertOwnedFile(orgId, data.previewFileId);
    } else if (data.previewDataUrl) {
      // The save fell back to a data-URL preview (thumbnail upload failed) —
      // clear the stale file pointer so the fresher data URL wins in listings.
      payload.previewFileId = null;
    }
    if (data.doc !== undefined) {
      const validatedDoc = this._designerDocService.validate(data.doc);
      const firstOutput = validatedDoc.outputs[0];
      payload = {
        ...payload,
        doc: validatedDoc,
        width: firstOutput.width,
        height: firstOutput.height,
      };
      if (validatedDoc.mode === 'video' && this._previewRegenDue(id)) {
        const regenId = await this._renderVideoPreview(orgId, validatedDoc);
        if (regenId) {
          // Supersede both the client's snapshot file (below) and the stored
          // preview (the previous-row lookup + cleanup further down).
          await this._cleanupReplacedFile(orgId, data.previewFileId, regenId);
          payload.previewFileId = regenId;
        }
      }
    }
    // Only look up the previous row when this write moves the preview pointer.
    const previous = payload.previewFileId !== undefined
      ? await this._designRepository.findById(orgId, id)
      : null;
    const updated = await this._designRepository.update(id, orgId, payload);
    await this._cleanupReplacedFile(orgId, previous?.previewFileId, payload.previewFileId);
    return updated;
  }

  async deleteDesign(orgId: string, id: string) {
    return this._designRepository.softDelete(id, orgId);
  }

  // ── Version history ─────────────────────────────────────────────────────

  /**
   * Retention caps, env-tunable. Named (manual) versions get the larger
   * budget; auto safety snapshots churn on every restore, so they get less.
   */
  private _versionKeep(envKey: string, fallback: number): number {
    const raw = process.env[envKey];
    const parsed = raw === undefined || raw === '' ? NaN : Number(raw);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.floor(parsed);
  }

  /**
   * Snapshot the design's CURRENT doc as a version. `auto` marks the safety
   * snapshot taken inside restoreVersion — autosave NEVER calls this.
   */
  async createVersion(
    orgId: string,
    userId: string,
    designId: string,
    data: { name?: string; previewDataUrl?: string; auto?: boolean }
  ) {
    const design = await this._designRepository.findById(orgId, designId);
    if (!design) throw new NotFoundException('Design not found');
    const validatedDoc = this._designerDocService.validate(design.doc);
    const firstOutput = validatedDoc.outputs[0];
    const version = await this._designRepository.createVersion({
      designId,
      organizationId: orgId,
      name: data.name?.trim() || undefined,
      doc: validatedDoc,
      auto: !!data.auto,
      createdById: userId,
      width: design.width ?? firstOutput.width,
      height: design.height ?? firstOutput.height,
      previewDataUrl: data.previewDataUrl,
    });
    // Count cap at insert: newest N per class survive.
    await this._designRepository.trimVersions(
      designId,
      !!data.auto,
      this._versionKeep(
        data.auto ? 'DESIGN_VERSIONS_KEEP_AUTO' : 'DESIGN_VERSIONS_KEEP_NAMED',
        data.auto ? 10 : 20
      )
    );
    return version;
  }

  async listVersions(orgId: string, designId: string) {
    const design = await this._designRepository.findById(orgId, designId);
    if (!design) throw new NotFoundException('Design not found');
    return this._designRepository.listVersions(orgId, designId);
  }

  async getVersion(orgId: string, designId: string, versionId: string) {
    const version = await this._designRepository.findVersion(orgId, designId, versionId);
    if (!version) throw new NotFoundException('Version not found');
    return version;
  }

  /**
   * Restore a version into the live design. NON-destructive on the server
   * side: the current doc is snapshotted as an auto version BEFORE the
   * overwrite, so a mistaken restore is itself recoverable.
   */
  async restoreVersion(orgId: string, userId: string, designId: string, versionId: string) {
    const design = await this._designRepository.findById(orgId, designId);
    if (!design) throw new NotFoundException('Design not found');
    const version = await this._designRepository.findVersion(orgId, designId, versionId);
    if (!version) throw new NotFoundException('Version not found');

    await this.createVersion(orgId, userId, designId, {
      auto: true,
      previewDataUrl: design.previewDataUrl ?? undefined,
    });

    return this.updateDesign(orgId, designId, { doc: version.doc });
  }

  async deleteVersion(orgId: string, designId: string, versionId: string) {
    const version = await this._designRepository.findVersion(orgId, designId, versionId);
    if (!version) throw new NotFoundException('Version not found');
    await this._designRepository.deleteVersion(orgId, designId, versionId);
    return { success: true };
  }

  async listTemplates(orgId: string, page?: number, limit?: number) {
    // Backward compatible: no pagination params = the historical plain array
    // (other callers depend on the shape). Both present = one page wrapped in
    // { templates, total, page, limit }.
    const paginated = page !== undefined && limit !== undefined;
    const [templates, total] = paginated
      ? await Promise.all([
          this._designRepository.findTemplatesByOrg(orgId, page, limit),
          this._designRepository.countTemplatesByOrg(orgId),
        ])
      : ([await this._designRepository.findTemplatesByOrg(orgId), undefined] as const);
    const mapped = templates.map((t) => ({
      ...t,
      // The gallery list is chrome: it reads the mode (badge, uncategorized
      // bucketing, cross-mode confirm) but never the document — shipping every
      // template's full doc made the panel download megabytes up front. The
      // apply flow fetches the doc via getTemplate on demand.
      doc: { mode: (t.doc as any)?.mode ?? 'image' },
      thumbnail: (t as any).thumbnailFile?.path ?? null,
    }));
    return paginated
      ? { templates: mapped, total: total as number, page: page as number, limit: limit as number }
      : mapped;
  }

  async getTemplate(orgId: string, id: string) {
    return this._designRepository.findTemplateForOrg(id, orgId);
  }

  async createTemplate(data: {
    organizationId?: string;
    name: string;
    category: string;
    doc: any;
    isSystem?: boolean;
    thumbnailFileId?: string;
    folderId?: string;
  }) {
    if (data.thumbnailFileId) {
      // System templates have no organizationId; running the ownership check
      // with `undefined` would let Prisma ignore it and pass any org's file.
      if (!data.organizationId) {
        throw new BadRequestException(
          'A thumbnail file requires an owning organization'
        );
      }
      await this._assertOwnedFile(data.organizationId, data.thumbnailFileId);
    }
    let folderId: string | undefined;
    if (data.folderId) {
      if (!data.organizationId) {
        throw new BadRequestException(
          'A folder requires an owning organization'
        );
      }
      folderId = await this.resolveOwnedFolderId(data.organizationId, data.folderId);
    }
    const validatedDoc = this._designerDocService.validate(data.doc);
    return this._designRepository.createTemplate({
      ...data,
      folderId,
      doc: validatedDoc,
    });
  }

  async updateTemplate(orgId: string, id: string, data: {
    name?: string;
    category?: string;
    doc?: any;
    thumbnailFileId?: string;
  }) {
    let payload: any = { ...data };
    if (data.thumbnailFileId) {
      await this._assertOwnedFile(orgId, data.thumbnailFileId);
    }
    if (data.doc !== undefined) {
      const validatedDoc = this._designerDocService.validate(data.doc);
      payload = { ...payload, doc: validatedDoc };
    }
    // Only look up the previous row when this write moves the thumbnail pointer.
    const previous = data.thumbnailFileId
      ? await this._designRepository.findTemplateForOrg(id, orgId)
      : null;
    const updated = await this._designRepository.updateTemplate(id, orgId, payload);
    await this._cleanupReplacedFile(orgId, previous?.thumbnailFileId, payload.thumbnailFileId);
    return updated;
  }

  async deleteTemplate(orgId: string, id: string) {
    return this._designRepository.deleteTemplate(id, orgId);
  }

  // ── DesignTemplateFolder operations (mirrors FileService folder methods) ──

  async createFolder(orgId: string, data: { name: string; parentId?: string }) {
    if (data.parentId) {
      const parent = await this._designRepository.getFolder(orgId, data.parentId);
      if (!parent) {
        throw new NotFoundException('Parent folder not found');
      }
    }
    return this._designRepository.createFolder(orgId, data);
  }

  async getFolder(orgId: string, id: string) {
    const folder = await this._designRepository.getFolder(orgId, id);
    if (!folder) {
      throw new NotFoundException('Folder not found');
    }
    return folder;
  }

  async updateFolder(orgId: string, id: string, data: { name?: string }) {
    const folder = await this._designRepository.getFolder(orgId, id);
    if (!folder) {
      throw new NotFoundException('Folder not found');
    }
    return this._designRepository.updateFolder(orgId, id, data);
  }

  async deleteFolder(orgId: string, id: string, force = false) {
    const folder = await this._designRepository.getFolder(orgId, id);
    if (!folder) {
      throw new NotFoundException('Folder not found');
    }
    if (!force) {
      const { templates, children } =
        await this._designRepository.countFolderActiveContents(orgId, id);
      if (templates > 0 || children > 0) {
        // BadRequest (not a bare 500) so the message actually reaches the
        // user's toast.
        throw new BadRequestException('Folder is not empty');
      }
    }
    // force: FKs are ON DELETE SET NULL — the row's templates unfile and its
    // child folders re-parent to root; templates themselves are never deleted.
    return this._designRepository.deleteFolder(orgId, id);
  }

  getFolderTree(orgId: string) {
    return this._designRepository.getFolderTree(orgId);
  }

  // folderId null = unfiled/root. System templates are shared across orgs and
  // stay folder-less; only org-owned templates move.
  async moveTemplate(orgId: string, templateId: string, folderId: string | null) {
    const template = await this._designRepository.findTemplateForOrg(templateId, orgId);
    if (!template || template.organizationId !== orgId) {
      throw new NotFoundException('Template not found');
    }
    if (folderId) {
      const folder = await this._designRepository.getFolder(orgId, folderId);
      if (!folder) {
        throw new NotFoundException('Folder not found');
      }
    }
    return this._designRepository.moveTemplate(orgId, templateId, folderId);
  }

  // Non-throwing ownership check for a client-supplied folderId (mirrors
  // FileService.resolveOwnedFolderId): a foreign/bogus id falls back to
  // unfiled rather than 500ing the save.
  async resolveOwnedFolderId(orgId: string, folderId?: string | null) {
    if (!folderId) {
      return undefined;
    }
    const folder = await this._designRepository.getFolder(orgId, folderId);
    return folder ? folderId : undefined;
  }

  async instantiateTemplate(orgId: string, templateId: string): Promise<DesignerDoc> {
    const template = await this._designRepository.findTemplateForOrg(templateId, orgId);
    if (!template) {
      throw new NotFoundException('Template not found');
    }
    const validated = this._designerDocService.validate(template.doc);
    const stripped = this._designerDocService.stripIds(validated);
    return this._designerDocService.assignIdsAndNormalize(stripped);
  }

  // ── .pdesign import ─────────────────────────────────────────────────────
  // v2 files bundle every referenced asset; the import re-uploads them into
  // the importing org and rewrites the doc's fileId/src pairs. v1 files (no
  // assets manifest) keep stage-1 behavior: references travel verbatim, so
  // same-org round-trips resolve and cross-org media shows broken.
  // See media/designer-doc/postmill-file.ts.

  /**
   * Import a `.pdesign` (zip) or raw `.json` DesignerDoc as a NEW design.
   * The doc's ids are stripped and re-minted so the copy can never alias the
   * source design's elements. The upload may be memory-buffered (tests, small
   * files) or disk-spooled (`path`) — the controller's FileInterceptor uses
   * diskStorage for the 1 GB cap.
   */
  async importDesign(
    orgId: string,
    userId: string,
    file: { buffer?: Buffer; path?: string; originalname?: string; size?: number }
  ) {
    let head: Buffer | undefined;
    // The multer spool path is confined to tmpdir before ANY read — all three
    // sinks below (head read, stream unzip, json read) use only `safePath`.
    const safePath = file.path ? resolveInsideTmp(file.path) : null;
    if (Buffer.isBuffer(file.buffer)) {
      head = file.buffer.subarray(0, 4);
    } else if (safePath) {
      head = await readFileHead(safePath).catch(() => undefined);
    }
    if (!head) {
      throw new BadRequestException('Invalid file upload.');
    }

    let docRaw: unknown;
    let importedName: string | undefined;
    let refMap = new Map<string, FileRefRemap>();
    if (hasZipMagic(head)) {
      let parsed: ParsedPostmillFile;
      try {
        parsed = Buffer.isBuffer(file.buffer)
          ? parsePostmillFile(file.buffer)
          : await parsePostmillFileStream(
              createReadStream(safePath!),
              DESIGN_IMPORT_MAX_BYTES
            );
      } catch (err) {
        throw importErrorToHttp(err);
      }
      docRaw = parsed.doc;
      importedName = parsed.manifest.name;
      if (parsed.manifest.assets && Object.keys(parsed.manifest.assets).length) {
        refMap = await this._reuploadBundledAssets(orgId, parsed.manifest, parsed.assets);
      }
      if (parsed.manifest.fonts?.length) {
        await this._restoreBundledFonts(orgId, parsed.manifest, parsed.assets);
      }
    } else {
      try {
        docRaw = parseDesignJson(
          Buffer.isBuffer(file.buffer) ? file.buffer : await fs.readFile(safePath!)
        );
      } catch (err) {
        throw importErrorToHttp(err);
      }
    }

    // A raw .json skips the manifest gate, so the doc-version check from
    // parsePostmillFile runs again here (validate() would otherwise bury the
    // version cap under a generic "Invalid DesignerDoc").
    if (typeof (docRaw as any)?.version === 'number' && (docRaw as any).version > DESIGNER_DOC_VERSION) {
      throw new BadRequestException(
        `This design was saved by a newer version of Postmill (document v${(docRaw as any).version}, supported up to v${DESIGNER_DOC_VERSION})`
      );
    }

    const validated = this._designerDocService.validate(docRaw);
    const remapped = refMap.size ? rewriteDocFileRefs(validated, refMap) : validated;
    const stripped = this._designerDocService.stripIds(remapped);
    const normalized = this._designerDocService.assignIdsAndNormalize(stripped);

    const stem = (file.originalname || '').replace(/\.(pdesign|json)$/i, '');
    const name = importedName
      || (stem.trim() ? sanitizeDownloadName(stem) : 'Imported design');

    return this.createDesign(orgId, userId, { name, doc: normalized });
  }

  /**
   * v2 import: land every bundled asset in the importing org's LOCAL storage
   * and build the oldFileId → {newId, newPath} remap. A missing zip entry for
   * a manifest-listed asset is a truncated/corrupt file — a clean 400, not a
   * partially-relinked design.
   */
  private async _reuploadBundledAssets(
    orgId: string,
    manifest: PostmillFileManifest,
    assets: Map<string, Uint8Array>
  ): Promise<Map<string, FileRefRemap>> {
    const map = new Map<string, FileRefRemap>();
    const adapter = await this._storageService.getLocalAdapterForOrg(orgId, true);
    for (const [oldId, entry] of Object.entries(manifest.assets ?? {})) {
      const bytes = assets.get(entry.path);
      if (!bytes) {
        throw new BadRequestException(
          `The .pdesign file is missing the bundled asset ${entry.path}`
        );
      }
      let path: string;
      try {
        // writeBuffer re-sniffs and enforces STORED_ARTIFACT_ALLOWED_MIME.
        path = await adapter.writeBuffer(Buffer.from(bytes), entry.mime);
      } catch (err) {
        throw new BadRequestException(
          `Bundled asset "${entry.originalName}" could not be stored: ${(err as Error)?.message}`
        );
      }
      const saved = await this._fileService.saveFile(
        orgId,
        entry.originalName || oldId,
        path,
        entry.originalName,
        undefined,
        entry.size
      );
      map.set(oldId, { id: saved.id, path });
    }
    return map;
  }

  /**
   * v2 import: recreate the bundled custom fonts on the importing org's brand
   * profile. Docs reference fonts by NAME, so no doc rewrite is needed;
   * addCustomFont dedupes on (family, weight, italic). A font that fails to
   * restore skips with a warning — the import must not fail over a font
   * (renderers fall back to another face).
   */
  private async _restoreBundledFonts(
    orgId: string,
    manifest: PostmillFileManifest,
    assets: Map<string, Uint8Array>
  ): Promise<void> {
    const adapter = await this._storageService.getLocalAdapterForOrg(orgId, true);
    for (const font of manifest.fonts ?? []) {
      const bytes = assets.get(font.path);
      if (!bytes) {
        this._logger.warn(`Import: bundled font payload ${font.path} missing — skipping ${font.family}`);
        continue;
      }
      try {
        const originalname = font.path.split('/').pop() || `${font.family}.ttf`;
        const uploaded = await adapter.uploadFile({
          buffer: Buffer.from(bytes),
          originalname,
          size: bytes.length,
        } as Express.Multer.File);
        await this._brandsService.addCustomFont(orgId, {
          family: font.family,
          fileId: uploaded.filename || uploaded.originalname,
          path: uploaded.path,
          weights: [font.weight ?? 400],
          ...(font.italic ? { italic: true } : {}),
          serverRender: !originalname.endsWith('.woff2'),
        });
      } catch (err) {
        this._logger.warn(
          `Import: could not restore font ${font.family}: ${(err as Error)?.message}`
        );
      }
    }
  }

  private async _assertOwnedFile(orgId: string, fileId: string) {
    const file = await this._fileService.getFileById(orgId, fileId);
    if (!file) {
      throw new BadRequestException('Invalid preview/thumbnail file');
    }
  }

  /**
   * Render + upload a server-side video preview. NEVER throws: a render or
   * upload failure logs and returns null, so the save keeps whatever preview
   * the client supplied.
   */
  private async _renderVideoPreview(
    orgId: string,
    doc: DesignerDoc
  ): Promise<string | null> {
    try {
      const buffer = await this._designPreviewService.renderPreviewBuffer(doc, { orgId });
      return await this._designPreviewService.uploadPreview(orgId, buffer);
    } catch (err) {
      this._logger.warn(
        `Server-side video preview regen failed; keeping the client preview: ${(err as Error)?.message}`
      );
      return null;
    }
  }

  private _previewRegenDue(designId: string): boolean {
    if (this._previewRegenAt.size >= DesignService.PREVIEW_REGEN_MAP_CAP) {
      this._previewRegenAt.clear();
    }
    const now = Date.now();
    const last = this._previewRegenAt.get(designId);
    // Mark the ATTEMPT, not the success — a failing renderer must not be
    // hammered on every autosave either.
    if (last !== undefined && now - last < DesignService.PREVIEW_REGEN_THROTTLE_MS) {
      return false;
    }
    this._previewRegenAt.set(designId, now);
    return true;
  }

  /**
   * Maintenance sweep: regenerate server-side previews for the org's designs
   * and templates whose preview is missing (designs: both previewFileId and
   * previewDataUrl null; templates: thumbnailFileId null) OR whose doc is
   * video-mode (the client snapshot is a black stage). Blank docs are skipped
   * — a blank canvas has nothing to render. Per-item failures are counted,
   * never abort the run.
   */
  async regenPreviews(orgId: string) {
    const [designs, templates] = await Promise.all([
      this._designRepository.findDesignsForPreviewRegen(orgId),
      this._designRepository.findTemplatesForPreviewRegen(orgId),
    ]);

    const run = async <T extends { id: string; doc: any }>(
      rows: T[],
      needsRegen: (row: T) => boolean,
      apply: (row: T, fileId: string) => Promise<unknown>,
      oldFileId: (row: T) => string | null | undefined
    ) => {
      const stats = { scanned: rows.length, regenerated: 0, skipped: 0, failed: 0 };
      const queue = rows.filter((row) => {
        if (isBlankDoc(row.doc)) {
          stats.skipped++;
          return false;
        }
        if (!needsRegen(row)) {
          stats.skipped++;
          return false;
        }
        return true;
      });
      // Small fixed concurrency: preview renders are CPU-heavy (node-canvas),
      // so a wide fan-out would stall the API process.
      const CONCURRENCY = 2;
      let cursor = 0;
      const worker = async () => {
        while (cursor < queue.length) {
          const row = queue[cursor++];
          try {
            const doc = this._designerDocService.validate(row.doc);
            const buffer = await this._designPreviewService.renderPreviewBuffer(doc, { orgId });
            const fileId = await this._designPreviewService.uploadPreview(orgId, buffer);
            await apply(row, fileId);
            await this._cleanupReplacedFile(orgId, oldFileId(row), fileId);
            stats.regenerated++;
          } catch (err) {
            stats.failed++;
            this._logger.warn(
              `Preview regen failed for ${row.id}: ${(err as Error)?.message}`
            );
          }
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      return stats;
    };

    const designStats = await run(
      designs,
      (row) => (!row.previewFileId && !row.previewDataUrl) || (row.doc as any)?.mode === 'video',
      (row, fileId) => this._designRepository.update(row.id, orgId, { previewFileId: fileId }),
      (row) => row.previewFileId
    );
    const templateStats = await run(
      templates,
      (row) => !row.thumbnailFileId || (row.doc as any)?.mode === 'video',
      (row, fileId) =>
        row.organizationId === orgId
          ? this._designRepository.updateTemplate(row.id, orgId, { thumbnailFileId: fileId })
          : this._designRepository.setTemplateThumbnail(row.id, fileId),
      (row) => row.thumbnailFileId
    );
    return { designs: designStats, templates: templateStats };
  }

  // Autosave mints a fresh thumbnail File on every save; the replaced one
  // would otherwise orphan and keep counting against the org storage quota.
  // Best-effort: a deletion failure must never fail the design/template write.
  private async _cleanupReplacedFile(
    orgId: string,
    previousFileId: string | null | undefined,
    nextFileId: string | null | undefined
  ) {
    if (!previousFileId || previousFileId === nextFileId) {
      return;
    }
    try {
      await this._fileService.softDelete(previousFileId, orgId);
    } catch (err) {
      this._logger.warn(
        `Could not delete replaced preview file ${previousFileId}: ${(err as Error)?.message}`
      );
    }
  }

  async placeAsset(
    orgId: string,
    doc: DesignerDoc,
    input: {
      url: string;
      outputIndex: number;
      name?: string;
      box?: Partial<{ x: number; y: number; width: number; height: number }>;
    }
  ): Promise<{ doc: DesignerDoc; fileId: string }> {
    const file = await this._fileService.importFromUrl(orgId, {
      url: input.url,
      name: input.name ?? 'placed-asset',
    });

    const op = this._designerDocService.buildPlaceImageOp({
      outputIndex: input.outputIndex,
      src: file.path,
      fileId: file.id,
      box: input.box,
    });

    const updated = this._designerDocService.applyOps(doc, [op]);
    return { doc: updated, fileId: file.id };
  }
}
