import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

/**
 * RetentionRepository — encapsulated data access for the retention sweep.
 *
 * RetentionActivity no longer imports PrismaService directly; all reads/writes
 * flow through this repository. The repository itself uses PrismaService because
 * the sweep is cross-table maintenance (sanctioned exception, same as seeders /
 * DeletionService).
 */
@Injectable()
export class RetentionRepository {
  private readonly _logger = new Logger(RetentionRepository.name);

  // Per-batch cap and max batches for the hard-purge sweeps (Post/File).
  static readonly BATCH = 500;
  static readonly MAX_BATCHES = 50; // ≤ 25k rows/table/run

  constructor(private readonly _prisma: PrismaService) {}

  async deleteErrorsOlderThan(cutoff: Date): Promise<number> {
    const r = await this._prisma.errors.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return r.count;
  }

  async deleteNotificationsOlderThan(cutoff: Date): Promise<number> {
    // NotificationRead cascades from Notifications (onDelete: Cascade).
    const r = await this._prisma.notifications.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return r.count;
  }

  async deleteIncompleteMultipartUploadsOlderThan(cutoff: Date): Promise<number> {
    const r = await this._prisma.multipartUpload.deleteMany({
      where: {
        state: { not: 'completed' },
        updatedAt: { lt: cutoff },
      },
    });
    return r.count;
  }

  async deleteMastraTracesOlderThan(cutoff: Date): Promise<number> {
    const traces = await this._prisma.mastra_traces.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    const scorers = await this._prisma.mastra_scorers.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return traces.count + scorers.count;
  }

  async purgeSoftDeletedPosts(cutoff: Date): Promise<number> {
    let total = 0;
    for (let i = 0; i < RetentionRepository.MAX_BATCHES; i++) {
      const rows = await this._prisma.post.findMany({
        where: { deletedAt: { not: null, lt: cutoff } },
        select: { id: true },
        take: RetentionRepository.BATCH,
      });
      if (!rows.length) break;
      const ids = rows.map((p) => p.id);

      await this._prisma.$transaction([
        this._prisma.tagsPosts.deleteMany({ where: { postId: { in: ids } } }),
        this._prisma.comments.deleteMany({ where: { postId: { in: ids } } }),
        this._prisma.errors.deleteMany({ where: { postId: { in: ids } } }),
        this._prisma.post.updateMany({
          where: { parentPostId: { in: ids } },
          data: { parentPostId: null },
        }),
        this._prisma.post.deleteMany({ where: { id: { in: ids } } }),
      ]);

      total += ids.length;
      if (rows.length < RetentionRepository.BATCH) break;
    }
    return total;
  }

  async purgeSoftDeletedFiles(cutoff: Date): Promise<number> {
    let total = 0;
    for (let i = 0; i < RetentionRepository.MAX_BATCHES; i++) {
      const rows = await this._prisma.file.findMany({
        where: { deletedAt: { not: null, lt: cutoff } },
        select: { id: true },
        take: RetentionRepository.BATCH,
      });
      if (!rows.length) break;
      const r = await this._prisma.file.deleteMany({
        where: { id: { in: rows.map((f) => f.id) } },
      });
      total += r.count;
      if (rows.length < RetentionRepository.BATCH) break;
    }
    return total;
  }

  async purgeAiDesignerSessionsOlderThan(cutoff: Date): Promise<number> {
    let total = 0;
    for (let i = 0; i < RetentionRepository.MAX_BATCHES; i++) {
      const rows = await this._prisma.aiDesignerSession.findMany({
        where: { updatedAt: { lt: cutoff } },
        select: { id: true },
        take: RetentionRepository.BATCH,
      });
      if (!rows.length) break;
      const r = await this._prisma.aiDesignerSession.deleteMany({
        where: { id: { in: rows.map((s) => s.id) } },
      });
      total += r.count;
      if (rows.length < RetentionRepository.BATCH) break;
    }
    return total;
  }

  async nullUserIpAgentOlderThan(cutoff: Date): Promise<number> {
    const r = await this._prisma.user.updateMany({
      where: {
        lastOnline: { lt: cutoff },
        OR: [{ ip: { not: null } }, { agent: { not: null } }],
      },
      data: { ip: null, agent: null },
    });
    return r.count;
  }

  async nullSessionIpAgentOlderThan(cutoff: Date): Promise<number> {
    const r = await this._prisma.session.updateMany({
      where: {
        lastUsedAt: { lt: cutoff },
        OR: [{ ip: { not: null } }, { userAgent: { not: null } }],
      },
      data: { ip: null, userAgent: null },
    });
    return r.count;
  }
}
