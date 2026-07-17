import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { AiDesignerSession as PrismaAiDesignerSession } from '@prisma/client';
import type { AiDesignerConfig, AiDesignerSessionState, DesignBrief } from '@gitroom/nestjs-libraries/ai-designer/ai-designer.types';
import {
  AiDesignerConfigSchema,
  AiDesignerStateSchema,
  ActiveDesignIdsSchema,
  DesignBriefSchema,
} from '@gitroom/nestjs-libraries/ai-designer/ai-designer.schemas';

@Injectable()
export class AiDesignerSessionRepository {
  constructor(private readonly _prisma: PrismaService) {}

  async create(data: {
    organizationId: string;
    userId: string;
    mode: string;
    format: string;
    config: AiDesignerConfig;
    brief?: DesignBrief | null;
    state?: AiDesignerSessionState;
    activeDesignIds?: string[] | null;
  }): Promise<PrismaAiDesignerSession> {
    return this._prisma.aiDesignerSession.create({
      data: {
        organizationId: data.organizationId,
        userId: data.userId,
        mode: data.mode,
        format: data.format,
        config: this._parse(
          'config',
          data.config,
          AiDesignerConfigSchema
        ) as any,
        brief:
          data.brief === undefined || data.brief === null
            ? null
            : (this._parse('brief', data.brief, DesignBriefSchema) as any),
        state: this._parse('state', data.state ?? 'intake', AiDesignerStateSchema) as any,
        activeDesignIds: this._parse(
          'activeDesignIds',
          data.activeDesignIds ?? null,
          ActiveDesignIdsSchema
        ) as any,
      },
    });
  }

  async findByIdForOrgAndUser(
    id: string,
    organizationId: string,
    userId: string
  ): Promise<PrismaAiDesignerSession | null> {
    return this._prisma.aiDesignerSession.findFirst({
      where: { id, organizationId, userId },
    });
  }

  async listByOrgAndUser(
    organizationId: string,
    userId: string,
    options?: { page?: number; limit?: number }
  ): Promise<{ sessions: PrismaAiDesignerSession[]; total: number }> {
    const page = options?.page ?? 1;
    const limit = options?.limit ?? 20;
    const skip = (page - 1) * limit;

    const [sessions, total] = await Promise.all([
      this._prisma.aiDesignerSession.findMany({
        where: { organizationId, userId },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
      this._prisma.aiDesignerSession.count({
        where: { organizationId, userId },
      }),
    ]);

    return { sessions, total };
  }

  async update(
    id: string,
    organizationId: string,
    userId: string,
    data: {
      state?: AiDesignerSessionState;
      brief?: DesignBrief | null;
      config?: AiDesignerConfig;
      activeDesignIds?: string[] | null;
    }
  ): Promise<PrismaAiDesignerSession> {
    const prismaData: Record<string, unknown> = {};
    if (data.state !== undefined) {
      prismaData.state = this._parse('state', data.state, AiDesignerStateSchema) as any;
    }
    if (data.brief !== undefined) {
      prismaData.brief =
        data.brief === null
          ? null
          : (this._parse('brief', data.brief, DesignBriefSchema) as any);
    }
    if (data.config !== undefined) {
      prismaData.config = this._parse(
        'config',
        data.config,
        AiDesignerConfigSchema
      ) as any;
    }
    if (data.activeDesignIds !== undefined) {
      prismaData.activeDesignIds = this._parse(
        'activeDesignIds',
        data.activeDesignIds,
        ActiveDesignIdsSchema
      ) as any;
    }

    // Sessions are user-private (find/delete scope by userId too) — keep the
    // write path symmetric so a caller can never rewrite another member's
    // session with only a client-influenced sessionId.
    return this._prisma.aiDesignerSession.update({
      where: { id, organizationId, userId },
      data: prismaData,
    });
  }

  async delete(
    id: string,
    organizationId: string,
    userId: string
  ): Promise<PrismaAiDesignerSession> {
    return this._prisma.aiDesignerSession.delete({
      where: { id, organizationId, userId },
    });
  }

  private _parse<T>(
    column: string,
    value: unknown,
    schema: import('zod').ZodType<T>
  ): T {
    try {
      return schema.parse(value);
    } catch (err) {
      throw new BadRequestException(
        `Invalid AI designer ${column}: ${(err as Error)?.message ?? String(err)}`
      );
    }
  }
}
