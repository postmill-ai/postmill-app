import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Organization, User } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { RagService, RagSettings } from '@gitroom/nestjs-libraries/ai/governance/rag.service';
import { AiSettingsManager } from '@gitroom/nestjs-libraries/ai/ai-settings.manager';
import { AiSettingsService } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/ai-settings.service';
import { RagSearchDto } from '@gitroom/backend/dtos/rag/rag-search.dto';

// 'pgvector' = built-in Postmill default; the rest are remote stores.
const VECTOR_STORES = ['pgvector', 'pgvector-remote', 'qdrant', 'pinecone'];

@ApiTags('RAG')
@Controller('/rag')
export class RagController {
  private readonly _logger = new Logger(RagController.name);

  constructor(
    private _ragService: RagService,
    private _aiSettingsManager: AiSettingsManager,
    private _aiSettingsService: AiSettingsService,
  ) {}

  @Get('/status')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async getStatus(@GetOrgFromRequest() org: Organization) {
    return this._ragService.getStatus(org.id);
  }

  @Post('/index')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async indexContent(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body()
    body: {
      sourceType: string;
      content: string;
      sourceId?: string;
    },
  ) {
    if (!body.sourceType || !body.content) {
      throw new BadRequestException('sourceType and content are required');
    }
    if (!['text', 'url', 'file'].includes(body.sourceType)) {
      throw new BadRequestException('sourceType must be "text", "url", or "file"');
    }

    const sourceId = body.sourceId || `${body.sourceType}_${Date.now()}`;

    try {
      await this._ragService.indexContent({
        organizationId: org.id,
        sourceType: body.sourceType,
        sourceId,
        content: body.content,
      });

      return { success: true, sourceType: body.sourceType, sourceId };
    } catch (err) {
      this._logger.error(
        `RAG index failed for org ${org.id}: ${(err as Error).message}`,
      );
      throw new HttpException(
        (err as Error).message || 'Indexing failed',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('/items')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async listItems(
    @GetOrgFromRequest() org: Organization,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
    @Query('sourceType') sourceType?: string,
  ) {
    const parsedOffset = offset ? Math.max(0, parseInt(offset, 10)) : 0;
    const parsedLimit = limit
      ? Math.min(100, Math.max(1, parseInt(limit, 10)))
      : 20;

    return this._ragService.getItems(org.id, {
      sourceType,
      offset: parsedOffset,
      limit: parsedLimit,
    });
  }

  @Delete('/items/:sourceType/:sourceId')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async deleteItem(
    @GetOrgFromRequest() org: Organization,
    @Param('sourceType') sourceType: string,
    @Param('sourceId') sourceId: string,
  ) {
    try {
      await this._ragService.deleteItem(org.id, sourceType, sourceId);
      return { success: true };
    } catch (err) {
      this._logger.error(
        `RAG delete failed for org ${org.id}: ${(err as Error).message}`,
      );
      throw new HttpException(
        (err as Error).message || 'Delete failed',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('/search')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async search(
    @GetOrgFromRequest() org: Organization,
    @Body() body: RagSearchDto,
  ) {
    try {
      const results = await this._ragService.search({
        organizationId: org.id,
        query: body.query,
        limit: body.limit || 10,
      });
      return { results };
    } catch (err) {
      this._logger.error(
        `RAG search failed for org ${org.id}: ${(err as Error).message}`,
      );
      throw new HttpException(
        (err as Error).message || 'Search failed',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  @Post('/backfill')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  async triggerBackfill(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
  ) {
    try {
      const result = await this._ragService.backfill(org.id, user?.id);
      return { status: 'completed', ...result };
    } catch (err) {
      this._logger.error(
        `RAG backfill failed for org ${org.id}: ${(err as Error).message}`,
      );
      throw new HttpException(
        (err as Error).message || 'Backfill failed',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('/settings')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async getSettings() {
    const settings = await this._aiSettingsManager.getSettings();
    const rag = (settings?.ragSettings || {}) as Record<string, any>;
    const secret = (settings as any)?.secretSettings || {};
    return {
      enabled: !!rag.enabled,
      vectorStore: rag.vectorStore || 'pgvector',
      // Qdrant (remote)
      qdrantUrl: rag.qdrantUrl || '',
      qdrantCollection: rag.qdrantCollection || 'postiz_rag',
      distance: rag.distance || 'Cosine',
      qdrantConfigured: !!(rag.qdrantUrl || secret.qdrantApiKey),
      // Remote pgvector — never return the connection string (it carries the password).
      pgTable: rag.pgTable || 'postmill_rag',
      pgConfigured: !!(secret.pgUrl || rag.pgUrl),
      // Pinecone (remote) — never return the API key.
      pineconeIndex: rag.pineconeIndex || '',
      pineconeHost: rag.pineconeHost || '',
      pineconeConfigured: !!(secret.pineconeApiKey || rag.pineconeApiKey),
      embeddingDimension: rag.embeddingDimension || 1536,
      chunkSize: rag.chunkSize || 500,
      chunkOverlap: rag.chunkOverlap || 100,
      autoIndex: !!rag.autoIndex,
      autoIndexSources: Array.isArray(rag.autoIndexSources) ? rag.autoIndexSources : [],
    };
  }

  @Put('/settings')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async saveSettings(
    @Body()
    body: {
      enabled?: boolean;
      vectorStore?: string;
      qdrantUrl?: string;
      qdrantApiKey?: string;
      qdrantCollection?: string;
      distance?: string;
      pgUrl?: string;
      pgTable?: string;
      pineconeApiKey?: string;
      pineconeIndex?: string;
      pineconeHost?: string;
      embeddingDimension?: number;
      chunkSize?: number;
      chunkOverlap?: number;
      autoIndex?: boolean;
      autoIndexSources?: string[];
    },
  ) {
    if (body.vectorStore && !VECTOR_STORES.includes(body.vectorStore)) {
      throw new BadRequestException(
        `vectorStore must be one of ${VECTOR_STORES.join(', ')}`,
      );
    }

    const settings = await this._aiSettingsManager.getSettings();
    const existing = (settings?.ragSettings || {}) as Record<string, any>;

    const rag: Record<string, any> = { ...existing };
    // Never persist secrets in the plaintext ragSettings blob.
    delete rag.qdrantApiKey;
    delete rag.pgUrl;
    delete rag.pineconeApiKey;

    if (body.enabled !== undefined) rag.enabled = body.enabled;
    if (body.vectorStore !== undefined) rag.vectorStore = body.vectorStore;
    if (body.qdrantUrl !== undefined) rag.qdrantUrl = body.qdrantUrl;
    if (body.qdrantCollection !== undefined) rag.qdrantCollection = body.qdrantCollection;
    if (body.distance !== undefined) rag.distance = body.distance;
    if (body.pgTable !== undefined) rag.pgTable = body.pgTable;
    if (body.pineconeIndex !== undefined) rag.pineconeIndex = body.pineconeIndex;
    if (body.pineconeHost !== undefined) rag.pineconeHost = body.pineconeHost;
    if (body.embeddingDimension !== undefined) rag.embeddingDimension = body.embeddingDimension;
    if (body.chunkSize !== undefined) rag.chunkSize = body.chunkSize;
    if (body.chunkOverlap !== undefined) rag.chunkOverlap = body.chunkOverlap;
    if (body.autoIndex !== undefined) rag.autoIndex = body.autoIndex;
    if (body.autoIndexSources !== undefined) rag.autoIndexSources = body.autoIndexSources;

    // Secrets are merged into the encrypted secretSettings blob — only overwrite a
    // secret when a new value is supplied (the form omits unchanged secrets).
    const secret: Record<string, any> = { ...((settings as any)?.secretSettings || {}) };
    if (body.qdrantApiKey) secret.qdrantApiKey = body.qdrantApiKey;
    if (body.pgUrl) secret.pgUrl = body.pgUrl;
    if (body.pineconeApiKey) secret.pineconeApiKey = body.pineconeApiKey;

    await this._aiSettingsService.upsertSystemSettings({
      ragSettings: rag,
      secretSettings: secret,
    });
    await this._aiSettingsManager.refreshCache();

    return { success: true };
  }

  @Post('/settings/test-connection')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async testConnection(
    @Body()
    body: {
      vectorStore: string;
      qdrantUrl?: string;
      qdrantApiKey?: string;
      qdrantCollection?: string;
      distance?: string;
      pgUrl?: string;
      pgTable?: string;
      pineconeApiKey?: string;
      pineconeIndex?: string;
      pineconeHost?: string;
      embeddingDimension?: number;
    },
  ) {
    if (!VECTOR_STORES.includes(body.vectorStore)) {
      throw new BadRequestException(
        `vectorStore must be one of ${VECTOR_STORES.join(', ')}`,
      );
    }

    // Fall back to stored (encrypted) secrets when the form omits an unchanged one.
    const settings = await this._aiSettingsManager.getSettings();
    const secret = (settings as any)?.secretSettings || {};

    const result = await this._ragService.testConnection({
      enabled: true,
      vectorStore: body.vectorStore as RagSettings['vectorStore'],
      qdrantUrl: body.qdrantUrl,
      qdrantApiKey: body.qdrantApiKey || secret.qdrantApiKey,
      qdrantCollection: body.qdrantCollection,
      distance: body.distance as RagSettings['distance'],
      pgUrl: body.pgUrl || secret.pgUrl,
      pgTable: body.pgTable,
      pineconeApiKey: body.pineconeApiKey || secret.pineconeApiKey,
      pineconeIndex: body.pineconeIndex,
      pineconeHost: body.pineconeHost,
      embeddingDimension: body.embeddingDimension,
    } as RagSettings);

    return result;
  }
}
