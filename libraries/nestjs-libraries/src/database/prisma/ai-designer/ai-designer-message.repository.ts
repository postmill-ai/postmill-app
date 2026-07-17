import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import type { AiDesignerMessage as PrismaAiDesignerMessage } from '@prisma/client';
import type { AiDesignerMessagePayload } from '@gitroom/nestjs-libraries/ai-designer/ai-designer.types';
import { AiDesignerMessageContentSchema } from '@gitroom/nestjs-libraries/ai-designer/ai-designer.schemas';

// Hard ceiling on messages returned per read; long sessions accumulate
// `progress` rows and an unbounded read would ship them all on every resume.
const MAX_MESSAGES_PER_READ = 500;

// Counter keys idle longer than this are re-seeded from the DB on next use,
// so they can expire instead of accumulating one key per session forever.
const SEQ_KEY_TTL_SECONDS = 7 * 24 * 60 * 60;

@Injectable()
export class AiDesignerMessageRepository {
  constructor(private readonly _prisma: PrismaService) {}

  async create(data: {
    sessionId: string;
    seq: number;
    role: string;
    agent?: string;
    kind: string;
    replyTo?: string;
    content: AiDesignerMessagePayload['content'];
  }): Promise<PrismaAiDesignerMessage> {
    return this._prisma.aiDesignerMessage.create({
      data: {
        sessionId: data.sessionId,
        seq: data.seq,
        role: data.role,
        agent: data.agent ?? null,
        kind: data.kind,
        replyTo: data.replyTo ?? null,
        content: this._parseContent(data.content),
      },
    });
  }

  private _parseContent(value: unknown): any {
    try {
      return AiDesignerMessageContentSchema.parse(value);
    } catch (err) {
      throw new BadRequestException(
        `Invalid AI designer message content: ${(err as Error)?.message ?? String(err)}`
      );
    }
  }

  /**
   * Insert a message with a self-healing sequence number.
   *
   * The seq comes from a Redis INCR; when Redis has lost the counter (flush,
   * eviction, restart) the insert can collide with `@@unique([sessionId, seq])`
   * — on P2002 the counter is re-seeded from the DB max and the insert retried,
   * so one lost counter costs one retry instead of failing every append until
   * the counter grinds past the old max.
   */
  async createNext(data: {
    sessionId: string;
    role: string;
    agent?: string;
    kind: string;
    replyTo?: string;
    content: AiDesignerMessagePayload['content'];
  }): Promise<PrismaAiDesignerMessage> {
    for (let attempt = 0; ; attempt++) {
      const seq = await this.getNextSeq(data.sessionId);
      try {
        return await this.create({ ...data, seq });
      } catch (err) {
        const isUniqueViolation =
          (err as { code?: string })?.code === 'P2002';
        if (!isUniqueViolation || attempt >= 2) {
          throw err;
        }
        await this._reseedSeqFromDb(data.sessionId);
      }
    }
  }

  async findBySession(sessionId: string): Promise<PrismaAiDesignerMessage[]> {
    // Newest window, returned oldest-first.
    const rows = await this._prisma.aiDesignerMessage.findMany({
      where: { sessionId },
      orderBy: { seq: 'desc' },
      take: MAX_MESSAGES_PER_READ,
    });
    return rows.reverse();
  }

  async findAfterSeq(
    sessionId: string,
    seq: number
  ): Promise<PrismaAiDesignerMessage[]> {
    return this._prisma.aiDesignerMessage.findMany({
      where: { sessionId, seq: { gt: seq } },
      orderBy: { seq: 'asc' },
      take: MAX_MESSAGES_PER_READ,
    });
  }

  /**
   * Return the next per-session message sequence number.
   *
   * Uses a Redis atomic INCR counter so concurrent appends for the same session
   * cannot collide on `@@unique([sessionId, seq])`. A fresh counter (INCR → 1)
   * on a session that already has rows means Redis lost the key — re-seed from
   * the DB max first. Falls back to a DB max+1 read when Redis is unavailable.
   */
  async getNextSeq(sessionId: string): Promise<number> {
    const key = this._seqKey(sessionId);
    try {
      const next = await ioRedis.incr(key);
      await ioRedis.expire(key, SEQ_KEY_TTL_SECONDS);
      if (next === 1) {
        // New/lost counter: jump past whatever is already persisted.
        const dbMax = await this._dbMaxSeq(sessionId);
        if (dbMax > 0) {
          const reseeded = await ioRedis.incrby(key, dbMax);
          return reseeded;
        }
      }
      return next;
    } catch {
      // Redis unavailable — best-effort fallback (still vulnerable to races,
      // but the unique constraint will fail fast if a collision occurs).
      return (await this._dbMaxSeq(sessionId)) + 1;
    }
  }

  async clearSeq(sessionId: string): Promise<void> {
    try {
      await ioRedis.del(this._seqKey(sessionId));
    } catch {
      // Best-effort: the key expires via TTL anyway.
    }
  }

  async findByIdForSession(
    id: string,
    sessionId: string
  ): Promise<PrismaAiDesignerMessage | null> {
    return this._prisma.aiDesignerMessage.findFirst({
      where: { id, sessionId },
    });
  }

  private async _reseedSeqFromDb(sessionId: string): Promise<void> {
    const dbMax = await this._dbMaxSeq(sessionId);
    try {
      await ioRedis.set(
        this._seqKey(sessionId),
        String(dbMax),
        'EX',
        SEQ_KEY_TTL_SECONDS
      );
    } catch {
      // Redis unavailable — getNextSeq's DB fallback covers the retry.
    }
  }

  private async _dbMaxSeq(sessionId: string): Promise<number> {
    const last = await this._prisma.aiDesignerMessage.findFirst({
      where: { sessionId },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });
    return last?.seq ?? 0;
  }

  private _seqKey(sessionId: string): string {
    return `ai-designer:seq:${sessionId}`;
  }
}
