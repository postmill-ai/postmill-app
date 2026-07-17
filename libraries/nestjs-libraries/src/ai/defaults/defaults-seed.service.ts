import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { OrgDefaultModelRepository } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/org-default-model.repository';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { DefaultsResolutionService } from './defaults-resolution.service';
import { AI_MODEL_CATEGORIES, AI_MEDIA_CATEGORIES } from './default-categories';

@Injectable()
export class DefaultsSeedService {
  private readonly _logger = new Logger(DefaultsSeedService.name);

  constructor(
    private _repository: OrgDefaultModelRepository,
    private _resolution: DefaultsResolutionService,
    @Inject(forwardRef(() => OrganizationService))
    private _organizationService: OrganizationService,
  ) {}

  async seedUnset(orgId: string): Promise<void> {
    for (const category of AI_MODEL_CATEGORIES) {
      await this._seedCategory('ai', category, orgId);
    }
    for (const category of AI_MEDIA_CATEGORIES) {
      await this._seedCategory('media', category, orgId);
    }
  }

  async seedAllOrgs(): Promise<void> {
    const orgIds = await this._organizationService.getAllIds();
    for (const org of orgIds) {
      await this.seedUnset(org.id).catch((err) => {
        this._logger.warn(`Failed to seed defaults for org ${org.id}: ${err.message}`);
      });
    }
  }

  private async _seedCategory(
    domain: 'ai' | 'media',
    category: string,
    orgId: string,
  ): Promise<void> {
    const existing = await this._repository.get(orgId, domain, category);
    if (existing) return;

    const resolved = await this._resolution.resolve(domain, category, orgId);
    if (!resolved || resolved.source !== 'auto') return;

    try {
      await this._repository.upsert(orgId, domain, category, {
        providerId: resolved.providerId,
        version: resolved.version,
        model: resolved.model,
        settings: resolved.settings,
      });
    } catch (err) {
      this._logger.warn(
        `Failed to seed default ${domain}/${category} for org ${orgId}: ${(err as Error).message}`,
      );
    }
  }
}
