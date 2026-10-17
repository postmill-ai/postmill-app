import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { CHANNEL_PRESETS } from '@postmill-ai/nestjs-libraries/integrations/social/channel-presets';
import type { AiDesignerFormat } from './ai-designer.types';
import { AiDesignerSessionRepository } from '@postmill-ai/nestjs-libraries/database/prisma/ai-designer/ai-designer-session.repository';
import { AiDesignerMessageRepository } from '@postmill-ai/nestjs-libraries/database/prisma/ai-designer/ai-designer-message.repository';
import { GuardrailService } from '@postmill-ai/nestjs-libraries/ai/governance/guardrail.service';
import { FileService } from '@postmill-ai/nestjs-libraries/database/prisma/file/file.service';
import { DesignService } from '@postmill-ai/nestjs-libraries/database/prisma/design/design.service';
import { collectDocFileIds } from '@postmill-ai/nestjs-libraries/media/designer-doc/doc-file-refs';
import type { AiDesignerSession as PrismaAiDesignerSession } from '@prisma/client';
import type {
  AiDesignerConfig,
  AiDesignerMessagePayload,
  AiDesignerMessageRole,
  AiDesignerMessageKind,
  AiDesignerMsgContent,
  AiDesignerSessionState,
  DesignBrief,
} from './ai-designer.types';

const VIDEO_PRESET_IDS = new Set(
  CHANNEL_PRESETS.filter((p) => p.category === 'video').map((p) => p.id)
);

/**
 * Derive the session's delivery format from the requested outputs. Sessions
 * are single-mode: a selection is either all video presets (a 'video'
 * session — the delivered Design is a timeline doc) or image presets/custom
 * sizes ('image'). A mixed selection is rejected here (400) even though the
 * start UI already refuses it, because the payload is websocket-borne.
 */
export function deriveSessionFormat(config: AiDesignerConfig): AiDesignerFormat {
  const channels = config.channels ?? [];
  const videoCount = channels.filter((id) => VIDEO_PRESET_IDS.has(id)).length;
  // Custom sizes are image outputs — there is no custom video size on the
  // start form.
  const imageCount =
    channels.length - videoCount + (config.customSizes?.length ? 1 : 0);
  if (videoCount > 0 && imageCount > 0) {
    throw new BadRequestException(
      'AI Designer sessions are single-mode: pick either video formats or image formats, not both.'
    );
  }
  return videoCount > 0 ? 'video' : 'image';
}

@Injectable()
export class AiDesignerService {
  private readonly _logger = new Logger(AiDesignerService.name);

  constructor(
    private readonly _sessionRepo: AiDesignerSessionRepository,
    private readonly _messageRepo: AiDesignerMessageRepository,
    private readonly _guardrails: GuardrailService,
    private readonly _fileService: FileService,
    private readonly _designService: DesignService,
  ) {}

  async createSession(data: {
    organizationId: string;
    userId: string;
    mode: 'chat' | 'prompt';
    config: AiDesignerConfig;
    brief?: DesignBrief;
    state?: AiDesignerSessionState;
  }) {
    return this._sessionRepo.create({
      organizationId: data.organizationId,
      userId: data.userId,
      mode: data.mode,
      format: deriveSessionFormat(data.config),
      config: data.config,
      brief: data.brief ?? null,
      state: data.state ?? 'intake',
    });
  }

  async getSessionForUser(
    id: string,
    organizationId: string,
    userId: string
  ) {
    return this._sessionRepo.findByIdForOrgAndUser(id, organizationId, userId);
  }

  // Cap on stored sessions per (org, user): `start` creates a row each time
  // and the retention prune only fires after AI_DESIGNER_SESSION_RETENTION_DAYS.
  static readonly MAX_SESSIONS_PER_USER = 100;

  async listSessions(
    organizationId: string,
    userId: string,
    options?: { page?: number; limit?: number }
  ) {
    return this._sessionRepo.listByOrgAndUser(organizationId, userId, options);
  }

  async atSessionCap(organizationId: string, userId: string): Promise<boolean> {
    const { total } = await this._sessionRepo.listByOrgAndUser(
      organizationId,
      userId,
      { limit: 1 }
    );
    return total >= AiDesignerService.MAX_SESSIONS_PER_USER;
  }

  async updateSession(
    id: string,
    organizationId: string,
    userId: string,
    data: {
      state?: AiDesignerSessionState;
      brief?: DesignBrief | null;
      config?: AiDesignerConfig;
      activeDesignIds?: string[] | null;
    }
  ) {
    return this._sessionRepo.update(id, organizationId, userId, data);
  }

  async appendMessage(data: {
    sessionId: string;
    role: AiDesignerMessageRole;
    agent?: string;
    kind: AiDesignerMessageKind;
    replyTo?: string;
    content: AiDesignerMsgContent;
  }): Promise<AiDesignerMessagePayload> {
    const row = await this._messageRepo.createNext({
      sessionId: data.sessionId,
      role: data.role,
      agent: data.agent,
      kind: data.kind,
      replyTo: data.replyTo,
      content: data.content,
    });

    return this._toPayload(row);
  }

  async deleteSession(id: string, organizationId: string, userId: string) {
    // Loaded before the delete: the session row carries everything the
    // intermediate purge needs (config.referenceFileIds, activeDesignIds).
    const session = await this._sessionRepo.findByIdForOrgAndUser(
      id,
      organizationId,
      userId
    );
    const deleted = await this._sessionRepo.delete(id, organizationId, userId);
    await this._messageRepo.clearSeq(id);
    if (session) {
      // Best-effort: a purge failure must never block session deletion — the
      // retention sweep reaps the stamped rows later anyway.
      await this._purgeSessionIntermediates(organizationId, session).catch(
        (err) =>
          this._logger.warn(
            `Could not purge AI Designer intermediates for session ${id}: ${(err as Error)?.message}`
          )
      );
    }
    return deleted;
  }

  /**
   * Soft-delete the session's intermediate files (stamped assets +
   * config-tracked reference imports) EXCEPT the ones a delivered design
   * still references: delivered design docs embed their asset fileIds, so
   * the keep-set is scanned from the session's `activeDesignIds` docs rather
   * than tracked as new state.
   */
  private async _purgeSessionIntermediates(
    organizationId: string,
    session: PrismaAiDesignerSession
  ): Promise<void> {
    const keep = new Set<string>();
    const designIds = Array.isArray(session.activeDesignIds)
      ? (session.activeDesignIds as string[])
      : [];
    for (const designId of designIds) {
      const design = await this._designService.getDesign(
        organizationId,
        designId
      );
      if (design?.doc) {
        for (const fileId of collectDocFileIds(design.doc)) keep.add(fileId);
      }
    }
    const config = session.config as { referenceFileIds?: string[] } | null;
    const purged = await this._fileService.purgeAiDesignerSessionFiles(
      organizationId,
      session.id,
      {
        referenceFileIds: Array.isArray(config?.referenceFileIds)
          ? config.referenceFileIds
          : [],
        keepFileIds: keep,
      }
    );
    if (purged > 0) {
      this._logger.log(
        `Purged ${purged} AI Designer intermediate file(s) for session ${session.id}.`
      );
    }
  }

  async getMessages(sessionId: string): Promise<AiDesignerMessagePayload[]> {
    const rows = await this._messageRepo.findBySession(sessionId);
    return rows.map((r) => this._toPayload(r));
  }

  async getMessagesAfterSeq(
    sessionId: string,
    seq: number
  ): Promise<AiDesignerMessagePayload[]> {
    const rows = await this._messageRepo.findAfterSeq(sessionId, seq);
    return rows.map((r) => this._toPayload(r));
  }

  /**
   * Run user-provided free text through the org's input guardrail chain
   * (`@reaatech/guardrail-chain` via the governance GuardrailService — the
   * same chain AIModelProvider applies to prompts). Returns the checked
   * (possibly redacted) text; throws GuardrailViolation on a block, which
   * the conductor surfaces as a chat message.
   */
  async applyGuardrails(text: string, orgId?: string): Promise<string> {
    return this._guardrails.checkInput(text, { orgId });
  }

  private _toPayload(row: any): AiDesignerMessagePayload {
    return {
      id: row.id,
      seq: row.seq,
      sessionId: row.sessionId,
      role: row.role as AiDesignerMessageRole,
      agent: row.agent ?? undefined,
      kind: row.kind as AiDesignerMessageKind,
      replyTo: row.replyTo ?? undefined,
      content: row.content as AiDesignerMsgContent,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
