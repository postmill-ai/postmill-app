import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

export interface DefaultModelData {
  providerId: string;
  version?: string;
  model?: string | null;
  settings?: Record<string, unknown> | null;
}

@Injectable()
export class OrgDefaultModelRepository {
  constructor(
    private _orgDefaultModel: PrismaRepository<'orgDefaultModel'>,
  ) {}

  getAll(orgId: string, domain: string) {
    return this._orgDefaultModel.model.orgDefaultModel.findMany({
      where: { organizationId: orgId, domain },
      orderBy: { category: 'asc' },
    });
  }

  get(orgId: string, domain: string, category: string) {
    return this._orgDefaultModel.model.orgDefaultModel.findUnique({
      where: {
        organizationId_domain_category: {
          organizationId: orgId,
          domain,
          category,
        },
      },
    });
  }

  upsert(
    orgId: string,
    domain: string,
    category: string,
    data: DefaultModelData,
  ) {
    return this._orgDefaultModel.model.orgDefaultModel.upsert({
      where: {
        organizationId_domain_category: {
          organizationId: orgId,
          domain,
          category,
        },
      },
      create: {
        organizationId: orgId,
        domain,
        category,
        providerId: data.providerId,
        version: data.version ?? 'v1',
        model: data.model ?? null,
        settings: data.settings ? JSON.stringify(data.settings) : null,
      },
      update: {
        providerId: data.providerId,
        version: data.version ?? 'v1',
        model: data.model ?? null,
        settings: data.settings ? JSON.stringify(data.settings) : null,
      },
    });
  }

  remove(orgId: string, domain: string, category: string) {
    return this._orgDefaultModel.model.orgDefaultModel.delete({
      where: {
        organizationId_domain_category: {
          organizationId: orgId,
          domain,
          category,
        },
      },
    });
  }
}
