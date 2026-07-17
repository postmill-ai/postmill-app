import { Injectable } from '@nestjs/common';
import { AiDesignerSessionRepository } from '@gitroom/nestjs-libraries/database/prisma/ai-designer/ai-designer-session.repository';
import { AiDesignerMessageRepository } from '@gitroom/nestjs-libraries/database/prisma/ai-designer/ai-designer-message.repository';
import { GuardrailService } from '@gitroom/nestjs-libraries/ai/governance/guardrail.service';
import type {
  AiDesignerConfig,
  AiDesignerMessagePayload,
  AiDesignerMessageRole,
  AiDesignerMessageKind,
  AiDesignerMsgContent,
  AiDesignerSessionState,
  DesignBrief,
} from './ai-designer.types';

@Injectable()
export class AiDesignerService {
  constructor(
    private readonly _sessionRepo: AiDesignerSessionRepository,
    private readonly _messageRepo: AiDesignerMessageRepository,
    private readonly _guardrails: GuardrailService,
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
      format: 'image',
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
    const deleted = await this._sessionRepo.delete(id, organizationId, userId);
    await this._messageRepo.clearSeq(id);
    return deleted;
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
