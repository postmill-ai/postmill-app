import { Injectable } from '@nestjs/common';
import { AuditRepository } from '@gitroom/nestjs-libraries/database/prisma/audit/audit.repository';

/**
 * Service wrapper over {@link AuditRepository} (ENHANCEMENTS_3 F1). Feature code should
 * depend on this, not the repository, so the audit table stays encapsulated. `record()`
 * is the clean call used by the security-event emitters (F2); `create()` mirrors the
 * repository shape so existing callers migrate by swapping the injected type only.
 */
@Injectable()
export class AuditService {
  constructor(private readonly _audit: AuditRepository) {}

  /**
   * Security/activity audit write. `metadata` is JSON-serialised into the `details`
   * column — callers MUST NOT pass secrets here.
   */
  record(data: {
    orgId: string;
    userId?: string;
    action: string;
    resource: string;
    resourceId?: string;
    resourceName?: string;
    metadata?: Record<string, unknown>;
  }) {
    return this._audit.create({
      organizationId: data.orgId,
      userId: data.userId,
      action: data.action,
      entity: data.resource,
      entityId: data.resourceId,
      entityName: data.resourceName,
      details: data.metadata ? JSON.stringify(data.metadata) : undefined,
    });
  }

  /** Repository-shaped passthrough (back-compat for migrated callers). */
  create(data: {
    organizationId: string;
    userId?: string;
    action: string;
    entity: string;
    entityId?: string;
    entityName?: string;
    details?: string;
  }) {
    return this._audit.create(data);
  }

  findByOrg(
    orgId: string,
    options?: { entity?: string; limit?: number; offset?: number }
  ) {
    return this._audit.findByOrg(orgId, options);
  }

  countByOrg(orgId: string, entity?: string) {
    return this._audit.countByOrg(orgId, entity);
  }

  findByEntity(
    orgId: string,
    entity: string,
    entityId: string,
    options?: { limit?: number; offset?: number }
  ) {
    return this._audit.findByEntity(orgId, entity, entityId, options);
  }
}
