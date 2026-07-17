import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

@Injectable()
export class AuditRepository {
  constructor(
    private _auditLog: PrismaRepository<'auditLog'>
  ) {}

  create(data: {
    organizationId: string;
    userId?: string;
    action: string;
    entity: string;
    entityId?: string;
    entityName?: string;
    details?: string;
  }) {
    return this._auditLog.model.auditLog.create({ data });
  }

  findByOrg(
    orgId: string,
    options?: {
      entity?: string;
      limit?: number;
      offset?: number;
    }
  ) {
    return this._auditLog.model.auditLog.findMany({
      where: {
        organizationId: orgId,
        ...(options?.entity && { entity: options.entity }),
      },
      orderBy: { createdAt: 'desc' },
      take: options?.limit || 50,
      skip: options?.offset || 0,
    });
  }

  countByOrg(orgId: string, entity?: string) {
    return this._auditLog.model.auditLog.count({
      where: {
        organizationId: orgId,
        ...(entity && { entity }),
      },
    });
  }

  // Changelog for a single resource (e.g. one campaign): entity + entityId scoped.
  findByEntity(
    orgId: string,
    entity: string,
    entityId: string,
    options?: { limit?: number; offset?: number }
  ) {
    return this._auditLog.model.auditLog.findMany({
      where: { organizationId: orgId, entity, entityId },
      orderBy: { createdAt: 'desc' },
      take: options?.limit || 50,
      skip: options?.offset || 0,
    });
  }
}
