import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { OrgDefaultModelRepository } from '@postmill-ai/nestjs-libraries/database/prisma/ai-settings/org-default-model.repository';
import { OrganizationService } from '@postmill-ai/nestjs-libraries/database/prisma/organizations/organization.service';
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

    // A model-bearing provider whose auto-pick produced no model would be
    // stored as a NULL-model row that can never resolve — the stored-model
    // catalog check fails on every read and warns forever. Action providers
    // are model-less by design (their NULL model resolves fine), so only
    // those may seed without a model.
    if (!resolved.model) {
      const candidates = await this._resolution.candidates(domain, category, orgId);
      const kind = candidates.find((c) => c.providerId === resolved.providerId)
        ?.metadata.kind;
      if (kind !== 'action') {
        this._logger.debug(
          `Skipping seed for ${domain}/${category} (org ${orgId}): auto-pick resolved ${resolved.providerId}@${resolved.version} with no model.`,
        );
        return;
      }
    }

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
