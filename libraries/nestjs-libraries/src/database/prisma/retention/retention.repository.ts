import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@postmill-ai/nestjs-libraries/database/prisma/prisma.service';
import { collectDocFileIds } from '@postmill-ai/nestjs-libraries/media/designer-doc/doc-file-refs';

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

  /**
   * Design versions whose parent design has been soft-deleted past the
   * retention window (the row survives the design's deletedAt because the FK
   * cascade only fires on a HARD delete, which the app never does).
   */
  async purgeSoftDeletedDesignVersions(cutoff: Date): Promise<number> {
    let total = 0;
    for (let i = 0; i < RetentionRepository.MAX_BATCHES; i++) {
      const rows = await this._prisma.designVersion.findMany({
        where: { design: { deletedAt: { not: null, lt: cutoff } } },
        select: { id: true },
        take: RetentionRepository.BATCH,
      });
      if (!rows.length) break;
      const r = await this._prisma.designVersion.deleteMany({
        where: { id: { in: rows.map((v) => v.id) } },
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
        select: { id: true, activeDesignIds: true, config: true },
        take: RetentionRepository.BATCH,
      });
      if (!rows.length) break;
      // Soft-delete the sessions' AI Designer intermediate files BEFORE the
      // session rows go: the rows carry the config (reference imports) and
      // activeDesignIds (delivered docs whose assets must be kept) that the
      // purge needs. Files a delivered design still references survive.
      await this._softDeleteAiDesignerIntermediates(rows);
      const r = await this._prisma.aiDesignerSession.deleteMany({
        where: { id: { in: rows.map((s) => s.id) } },
      });
      total += r.count;
      if (rows.length < RetentionRepository.BATCH) break;
    }
    return total;
  }

  /**
   * Soft-delete File rows stamped as AI Designer intermediates for the given
   * sessions: asset imports carry `metadata.sessionId`; reference imports
   * carry no sessionId (minted before the session exists) and are found via
   * each session config's `referenceFileIds`. Files still referenced by a
   * delivered design doc (`activeDesignIds` → doc fileIds) are kept.
   * Best-effort per sweep: a failure logs and leaves the rows for the next
   * cron tick, never aborts the session purge.
   */
  private async _softDeleteAiDesignerIntermediates(
    sessions: { id: string; activeDesignIds: unknown; config: unknown }[]
  ): Promise<void> {
    try {
      const sessionIds = sessions.map((s) => s.id);
      const keep = new Set<string>();
      const designIds = sessions.flatMap((s) =>
        Array.isArray(s.activeDesignIds) ? (s.activeDesignIds as string[]) : []
      );
      if (designIds.length) {
        const designs = await this._prisma.design.findMany({
          where: { id: { in: designIds }, deletedAt: null },
          select: { doc: true },
        });
        for (const design of designs) {
          for (const fileId of collectDocFileIds(design.doc)) keep.add(fileId);
        }
      }

      const candidateIds = new Set<string>();
      // JSON path filters have no `in`, so chunk the session ids into ORs.
      for (let c = 0; c < sessionIds.length; c += 50) {
        const chunk = sessionIds.slice(c, c + 50);
        const assets = await this._prisma.file.findMany({
          where: {
            deletedAt: null,
            AND: [
              { metadata: { path: ['aiDesigner'], equals: 'asset' } },
              {
                OR: chunk.map((id) => ({
                  metadata: { path: ['sessionId'], equals: id },
                })),
              },
            ],
          },
          select: { id: true },
        });
        for (const f of assets) candidateIds.add(f.id);
      }
      const referenceFileIds = sessions.flatMap((s) => {
        const config = s.config as { referenceFileIds?: unknown } | null;
        return Array.isArray(config?.referenceFileIds)
          ? (config.referenceFileIds as string[])
          : [];
      });
      if (referenceFileIds.length) {
        const references = await this._prisma.file.findMany({
          where: {
            deletedAt: null,
            id: { in: referenceFileIds },
            metadata: { path: ['aiDesigner'], equals: 'reference' },
          },
          select: { id: true },
        });
        for (const f of references) candidateIds.add(f.id);
      }

      const toDelete = [...candidateIds].filter((id) => !keep.has(id));
      if (!toDelete.length) return;
      const r = await this._prisma.file.updateMany({
        where: { id: { in: toDelete }, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (r.count > 0) {
        this._logger.log(
          `Soft-deleted ${r.count} AI Designer intermediate file(s) across ${sessionIds.length} purged session(s).`
        );
      }
    } catch (err) {
      this._logger.warn(
        `AI Designer intermediate purge failed (non-fatal): ${(err as Error)?.message}`
      );
    }
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
