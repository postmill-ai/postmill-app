import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DesignService } from '@postmill-ai/nestjs-libraries/database/prisma/design/design.service';
import { FileService } from '@postmill-ai/nestjs-libraries/database/prisma/file/file.service';
import { StorageService } from '@postmill-ai/nestjs-libraries/database/prisma/storage/storage.service';
import { DesignerDocService } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.service';
import { DesignRenderService } from '@postmill-ai/nestjs-libraries/media/design-render/design-render.service';
import { ioRedis } from '@postmill-ai/nestjs-libraries/redis/redis.service';
import {
  imageDocToVideoDoc,
  preservedVideoElementUnsupportedReason,
} from '@postmill-ai/nestjs-libraries/ai-designer/util/image-doc-to-video';
import type {
  DesignerDoc,
  DesignerElement,
  DesignerOutput,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import {
  descendantIds,
  isEffectivelyHidden,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/layer-tree';
import { expandSymbols } from '@postmill-ai/nestjs-libraries/media/designer-doc/symbols';
import {
  MAX_SYMBOL_EXPANSION_TOTAL,
  MAX_VIDEO_DURATION_MS,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.limits';

export interface VideoConversionFallback {
  outputId: string;
  pageNumber: number;
  sourceIds: string[];
  sourceTypes: string[];
  reason: string;
}

export interface VideoConversionOutputSummary {
  outputId: string;
  formatId: string;
  name: string;
  pageCount: number;
  pageDurationMs: number;
  durationMs: number;
  hiddenLayerCount: number;
  fallbacks: VideoConversionFallback[];
}

export interface VideoConversionSummary {
  outputs: VideoConversionOutputSummary[];
  totalPages: number;
  totalFallbacks: number;
}

type CreatedAsset = { id: string; path: string };
type BakedAsset = { fileId: string; src: string };

const IDEMPOTENCY_TTL_SECONDS = 86400;
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

const visuallySignificantGroup = (el: DesignerElement) =>
  el.type === 'group' &&
  (el.opacity !== 1 ||
    (!!el.blendMode && el.blendMode !== 'normal') ||
    !!el.clipped ||
    !!el.backdropFilter ||
    !!el.styles?.length);

const requiresBackdropBake = (el: DesignerElement, reason: string) =>
  el.type === 'adjustment' ||
  reason === 'clipped compositing' ||
  reason === 'backdrop filtering' ||
  reason.startsWith('blend mode ');

@Injectable()
export class DesignVideoConversionService {
  private readonly _logger = new Logger(DesignVideoConversionService.name);
  private _fallbackSequence = 0;

  constructor(
    private readonly _designService: DesignService,
    private readonly _designerDocService: DesignerDocService,
    private readonly _designRenderService: DesignRenderService,
    private readonly _fileService: FileService,
    private readonly _storageService: StorageService,
  ) {}

  async convertDesignToVideo(
    orgId: string,
    userId: string,
    sourceId: string,
    pageDurationMs: number,
    idempotencyKey?: string,
  ) {
    if (!idempotencyKey) {
      return this._convert(orgId, userId, sourceId, pageDurationMs);
    }
    if (idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      throw new BadRequestException('Idempotency key is too long');
    }
    const key = `design-video-convert:${orgId}:${sourceId}:${idempotencyKey}`;
    let claimed = false;
    try {
      claimed = (await ioRedis.set(
        key,
        JSON.stringify({ status: 'pending', pageDurationMs }),
        'EX',
        IDEMPOTENCY_TTL_SECONDS,
        'NX',
      )) === 'OK';
    } catch {
      claimed = true;
    }
    if (!claimed) {
      let existing: any = null;
      try {
        existing = JSON.parse((await ioRedis.get(key)) || 'null');
      } catch {}
      if (existing?.pageDurationMs !== pageDurationMs) {
        throw new ConflictException(
          'This idempotency key was already used with a different page duration',
        );
      }
      if (existing?.status === 'completed' && existing.result) {
        return existing.result;
      }
      throw new ConflictException('This design conversion is already in progress');
    }

    let completed = false;
    try {
      const result = await this._convert(orgId, userId, sourceId, pageDurationMs);
      completed = true;
      try {
        await ioRedis.set(
          key,
          JSON.stringify({ status: 'completed', pageDurationMs, result }),
          'EX',
          IDEMPOTENCY_TTL_SECONDS,
        );
      } catch {}
      return result;
    } finally {
      if (!completed) {
        try {
          await ioRedis.del(key);
        } catch {}
      }
    }
  }

  private async _convert(
    orgId: string,
    userId: string,
    sourceId: string,
    pageDurationMs: number,
  ) {
    if (
      !Number.isInteger(pageDurationMs) ||
      pageDurationMs < 100 ||
      pageDurationMs > MAX_VIDEO_DURATION_MS
    ) {
      throw new BadRequestException(
        'Page duration must be a whole number between 100 and 180000 milliseconds',
      );
    }
    const source = await this._designService.getDesign(orgId, sourceId);
    if (!source) throw new NotFoundException('Source design not found');
    const sourceDoc = this._designerDocService.validate(source.doc);
    if (sourceDoc.mode !== 'image') {
      throw new BadRequestException('Only a static image design can be edited as video');
    }

    const prepared = structuredClone(sourceDoc);
    const createdAssets: CreatedAsset[] = [];
    const summaries: VideoConversionOutputSummary[] = [];
    let committed = false;
    try {
      for (const output of prepared.outputs as DesignerOutput[]) {
        const pageCount = 1 + (output.pages?.length ?? 0);
        const durationMs = pageCount * pageDurationMs;
        if (durationMs > MAX_VIDEO_DURATION_MS) {
          throw new BadRequestException(
            `${output.name || output.formatId}: ${pageCount} pages at ${pageDurationMs}ms exceed the 180000ms video limit`,
          );
        }
        const fallbacks: VideoConversionFallback[] = [];
        let hiddenLayerCount = 0;
        for (let pageNumber = 0; pageNumber < pageCount; pageNumber++) {
          const children = pageNumber === 0
            ? output.children
            : output.pages![pageNumber - 1].children;
          this._assertSymbolsResolvable(children, prepared.symbols);
          const expanded = expandSymbols(children, prepared.symbols);
          if (expanded.length >= MAX_SYMBOL_EXPANSION_TOTAL) {
            throw new BadRequestException('Symbol expansion is too large to convert safely');
          }
          hiddenLayerCount += expanded.filter(
            (el) => el.type !== 'group' && isEffectivelyHidden(expanded, el),
          ).length;
          const convertedChildren = await this._preparePage(
            orgId,
            prepared,
            output,
            pageNumber,
            expanded,
            fallbacks,
            createdAssets,
          );
          if (pageNumber === 0) output.children = convertedChildren;
          else output.pages![pageNumber - 1].children = convertedChildren;
        }
        summaries.push({
          outputId: output.id,
          formatId: output.formatId,
          name: output.name,
          pageCount,
          pageDurationMs,
          durationMs,
          hiddenLayerCount,
          fallbacks,
        });
      }

      let videoDoc: DesignerDoc;
      try {
        videoDoc = imageDocToVideoDoc(prepared, {
          preserveContent: true,
          pageDurationMs,
        });
        this._designerDocService.validateStrict(videoDoc);
      } catch (error) {
        if (error instanceof BadRequestException) throw error;
        throw new BadRequestException(
          error instanceof Error ? error.message : 'The design cannot be converted safely',
        );
      }
      const design = await this._designService.createDesign(orgId, userId, {
        name: `${source.name || 'Design'} — Video`,
        doc: videoDoc,
      });
      committed = true;
      return {
        design,
        summary: {
          outputs: summaries,
          totalPages: summaries.reduce((total, output) => total + output.pageCount, 0),
          totalFallbacks: summaries.reduce(
            (total, output) => total + output.fallbacks.length,
            0,
          ),
        } satisfies VideoConversionSummary,
      };
    } finally {
      if (!committed) await this._cleanupAssets(orgId, createdAssets);
    }
  }

  private _assertSymbolsResolvable(
    children: DesignerElement[],
    definitions: DesignerDoc['symbols'],
  ) {
    const byId = new Map((definitions ?? []).map((definition) => [definition.id, definition]));
    const visit = (elements: DesignerElement[], visiting: ReadonlySet<string>) => {
      for (const element of elements) {
        if (element.type !== 'symbol') continue;
        const definition = element.symbolId ? byId.get(element.symbolId) : undefined;
        if (!definition || visiting.has(definition.id)) {
          throw new BadRequestException(
            `Symbol ${element.symbolId || element.id} cannot be expanded without losing content`,
          );
        }
        visit(definition.children, new Set([...visiting, definition.id]));
      }
    };
    visit(children, new Set());
  }

  private async _preparePage(
    orgId: string,
    doc: DesignerDoc,
    output: DesignerOutput,
    pageNumber: number,
    sourceChildren: DesignerElement[],
    fallbacks: VideoConversionFallback[],
    createdAssets: CreatedAsset[],
  ): Promise<DesignerElement[]> {
    let children = structuredClone(sourceChildren);
    const page = pageNumber > 0 ? output.pages![pageNumber - 1] : undefined;
    if (page?.background?.texture) {
      const baked = await this._bake(
        orgId,
        doc,
        output,
        pageNumber,
        [],
        true,
        createdAssets,
      );
      page.background = {
        type: 'image',
        src: baked.src,
        fileId: baked.fileId,
        naturalWidth: output.width,
        naturalHeight: output.height,
      };
      fallbacks.push({
        outputId: output.id,
        pageNumber,
        sourceIds: [page.id],
        sourceTypes: ['background'],
        reason: 'textured page background',
      });
    }

    while (children.some(visuallySignificantGroup)) {
      const group = children.find(visuallySignificantGroup)!;
      const ids = new Set(descendantIds(children, group.id));
      const descendants = children.filter((el) => ids.has(el.id));
      const visibleIds = descendants
        .filter((el) => el.type !== 'group' && !isEffectivelyHidden(children, el))
        .map((el) => el.id);
      const hiddenIds = new Set(descendants
        .filter((el) => el.type !== 'group' && isEffectivelyHidden(children, el))
        .map((el) => el.id));
      const renderChildren = children
        .filter((el) => el.id === group.id || ids.has(el.id))
        .map((el) => el.id === group.id
          ? { ...el, hidden: false, parentId: undefined }
          : el);
      const baked = await this._bake(
        orgId,
        doc,
        output,
        pageNumber,
        renderChildren,
        false,
        createdAssets,
      );
      const replacement = this._rasterElement(group, baked, output, group.hidden);
      const firstMember = children.findIndex((el) => ids.has(el.id));
      children = children.flatMap((el, index) => {
        if (el.id === group.id) return [];
        if (ids.has(el.id)) {
          const result: DesignerElement[] = [];
          if (index === firstMember) result.push(replacement);
          if (hiddenIds.has(el.id)) {
            result.push({ ...el, hidden: true, parentId: group.parentId });
          }
          return result;
        }
        return [el];
      });
      fallbacks.push({
        outputId: output.id,
        pageNumber,
        sourceIds: [group.id, ...visibleIds],
        sourceTypes: [...new Set([group.type, ...descendants
          .filter((el) => visibleIds.includes(el.id))
          .map((el) => el.type)])],
        reason: 'group-level visual effects',
      });
    }

    let backdropIndex = children.findIndex((el) => {
      if (el.type === 'group' || isEffectivelyHidden(children, el)) return false;
      const reason = preservedVideoElementUnsupportedReason(el);
      return !!reason && requiresBackdropBake(el, reason);
    });
    while (backdropIndex >= 0) {
      const target = children[backdropIndex];
      const reason = preservedVideoElementUnsupportedReason(target)!;
      const prefix = children.slice(0, backdropIndex + 1);
      const prefixIds = new Set(prefix.map((el) => el.id));
      const visibleIds = prefix
        .filter((el) => el.type !== 'group' && !isEffectivelyHidden(children, el))
        .map((el) => el.id);
      const visibleIdSet = new Set(visibleIds);
      const hiddenIds = new Set(prefix
        .filter((el) => el.type !== 'group' && isEffectivelyHidden(children, el))
        .map((el) => el.id));
      const baked = await this._bake(
        orgId,
        doc,
        output,
        pageNumber,
        prefix,
        true,
        createdAssets,
      );
      const replacement = this._rasterElement(target, baked, output, false);
      replacement.parentId = undefined;
      let inserted = false;
      children = children.flatMap((el) => {
        if (!prefixIds.has(el.id)) {
          return el.parentId && prefixIds.has(el.parentId)
            ? [{ ...el, parentId: undefined }]
            : [el];
        }
        const result: DesignerElement[] = [];
        if (!inserted && visibleIdSet.has(el.id)) {
          result.push(replacement);
          inserted = true;
        }
        if (hiddenIds.has(el.id)) {
          result.push({ ...el, hidden: true, parentId: undefined });
        }
        return result;
      });
      if (page?.background) page.background = undefined;
      fallbacks.push({
        outputId: output.id,
        pageNumber,
        sourceIds: visibleIds,
        sourceTypes: [...new Set(prefix
          .filter((el) => visibleIdSet.has(el.id))
          .map((el) => el.type))],
        reason,
      });
      backdropIndex = children.findIndex((el) => {
        if (el.type === 'group' || isEffectivelyHidden(children, el)) return false;
        const nextReason = preservedVideoElementUnsupportedReason(el);
        return !!nextReason && requiresBackdropBake(el, nextReason);
      });
    }

    for (let index = 0; index < children.length; index++) {
      const element = children[index];
      if (element.type === 'group') continue;
      const reason = preservedVideoElementUnsupportedReason(element);
      if (!reason) continue;
      const baked = await this._bake(
        orgId,
        doc,
        output,
        pageNumber,
        [{ ...element, hidden: false, parentId: undefined }],
        false,
        createdAssets,
      );
      children[index] = this._rasterElement(element, baked, output, element.hidden);
      fallbacks.push({
        outputId: output.id,
        pageNumber,
        sourceIds: [element.id],
        sourceTypes: [element.type],
        reason,
      });
    }
    return children;
  }

  private _rasterElement(
    source: DesignerElement,
    baked: BakedAsset,
    output: DesignerOutput,
    hidden: boolean,
  ): DesignerElement {
    return {
      id: source.id,
      type: 'raster',
      name: source.name,
      x: 0,
      y: 0,
      width: output.width,
      height: output.height,
      rotation: 0,
      opacity: 1,
      locked: source.locked,
      hidden,
      ...(source.groupId ? { groupId: source.groupId } : {}),
      ...(source.parentId ? { parentId: source.parentId } : {}),
      ...(source.originId ? { originId: source.originId } : {}),
      src: baked.src,
      fileId: baked.fileId,
      naturalWidth: output.width,
      naturalHeight: output.height,
      fitMode: 'fill',
    };
  }

  private async _bake(
    orgId: string,
    doc: DesignerDoc,
    output: DesignerOutput,
    pageNumber: number,
    children: DesignerElement[],
    includeBackground: boolean,
    createdAssets: CreatedAsset[],
  ): Promise<BakedAsset> {
    const background = pageNumber === 0
      ? output.bg
      : output.pages?.[pageNumber - 1]?.background ?? output.bg;
    const renderDoc: DesignerDoc = {
      ...doc,
      mode: 'image',
      outputs: [{
        ...output,
        bg: includeBackground ? background : undefined,
        background: includeBackground ? output.background : '#00000000',
        children: structuredClone(children),
        pages: undefined,
      }],
    };
    const buffer = await this._designRenderService.renderPage(
      renderDoc,
      0,
      { orgId, transparent: !includeBackground },
      0,
    );
    const adapter = await this._storageService.getLocalAdapterForOrg(orgId, true);
    const path = await adapter.writeBuffer(buffer, 'image/png');
    const fileName = `design-video-fallback-${Date.now()}-${++this._fallbackSequence}.png`;
    try {
      const file = await this._fileService.saveFile(
        orgId,
        fileName,
        path,
        fileName,
        undefined,
        buffer.length,
        { internal: 'design-asset', source: 'design-video-conversion' },
      );
      createdAssets.push({ id: file.id, path });
      return { fileId: file.id, src: file.path };
    } catch (error) {
      await adapter.removeFile(path).catch(() => undefined);
      throw error;
    }
  }

  private async _cleanupAssets(orgId: string, assets: CreatedAsset[]) {
    const adapter = await this._storageService.getLocalAdapterForOrg(orgId, true).catch(() => null);
    for (const asset of assets.reverse()) {
      try {
        await this._fileService.deleteFile(orgId, asset.id);
      } catch {
        await adapter?.removeFile(asset.path).catch(() => undefined);
      }
    }
    if (assets.length) {
      this._logger.warn(`Cleaned up ${assets.length} fallback assets after failed video conversion`);
    }
  }
}
