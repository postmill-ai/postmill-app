import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { AuditService } from '@gitroom/nestjs-libraries/database/prisma/audit/audit.service';

/**
 * DataExportService (ENHANCEMENTS_2 I2) — GDPR data-access export.
 *
 * Assembles a machine-readable JSON of the requesting user's own identity/profile
 * plus their current organization's posts/comments/files **metadata**. It never
 * includes other users' data, and never returns secrets (passwords, OAuth tokens,
 * encrypted credentials, API keys, raw file bytes).
 *
 * Read-only — reads through `PrismaService` directly (the same sanctioned exception
 * the deletion/seed services use) because it spans many tables for a one-off dump.
 */
@Injectable()
export class DataExportService {
  private readonly _logger = new Logger(DataExportService.name);

  constructor(
    private readonly _prisma: PrismaService,
    private readonly _audit: AuditService
  ) {}

  /**
   * Build the export payload for `userId` scoped to organization `orgId`
   * (the user's currently-selected org). Audits the export.
   */
  async exportUserData(
    userId: string,
    orgId: string
  ): Promise<Record<string, unknown>> {
    const user = await this._prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        providerName: true,
        createdAt: true,
        lastOnline: true,
        tosAcceptedAt: true,
        tosVersion: true,
        profile: {
          select: {
            name: true,
            lastName: true,
            bio: true,
            avatarUrl: true,
            timezone: true,
          },
        },
        organizations: {
          select: {
            organization: { select: { id: true, name: true, createdAt: true } },
            roleRef: { select: { key: true, name: true } },
            disabled: true,
          },
        },
      },
    });

    // Posts the org owns (metadata only — no provider tokens live on Post).
    const posts = await this._prisma.post.findMany({
      where: { organizationId: orgId, deletedAt: null },
      select: {
        id: true,
        content: true,
        state: true,
        publishDate: true,
        createdAt: true,
        releaseURL: true,
        integration: { select: { name: true, providerIdentifier: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Only comments this user authored (exclude other users').
    const comments = await this._prisma.comments.findMany({
      where: { userId, organizationId: orgId },
      select: { id: true, content: true, createdAt: true, postId: true },
      orderBy: { createdAt: 'desc' },
    });

    // File library metadata (never the bytes; `path` is included so the user can
    // correlate, but credentials/tokens are not stored on File).
    const files = await this._prisma.file.findMany({
      where: { organizationId: orgId, deletedAt: null },
      select: {
        id: true,
        name: true,
        originalName: true,
        type: true,
        fileSize: true,
        alt: true,
        description: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const payload = {
      exportedAt: new Date().toISOString(),
      schema: 'postmill.user-export.v1',
      scope: { userId, organizationId: orgId },
      user,
      organizationData: { posts, comments, files },
    };

    try {
      await this._audit.create({
        organizationId: orgId,
        userId,
        action: 'user.data-export',
        entity: 'user',
        entityId: userId,
        details: JSON.stringify({
          posts: posts.length,
          comments: comments.length,
          files: files.length,
        }),
      });
    } catch (err) {
      this._logger.warn(
        `Failed to audit data export for user ${userId}: ${(err as Error)?.message}`
      );
    }

    return payload;
  }
}
