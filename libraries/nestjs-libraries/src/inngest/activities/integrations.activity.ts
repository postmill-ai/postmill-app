import { Injectable } from '@nestjs/common';
import { IntegrationService } from '@postmill-ai/nestjs-libraries/database/prisma/integrations/integration.service';
import { Integration } from '@prisma/client';
import { RefreshIntegrationService } from '@postmill-ai/nestjs-libraries/integrations/refresh.integration.service';

@Injectable()
export class IntegrationsActivity {
  constructor(
    private _integrationService: IntegrationService,
    private _refreshIntegrationService: RefreshIntegrationService
  ) {}

  async getIntegrationsById(id: string, orgId: string) {
    return this._integrationService.getIntegrationById(orgId, id);
  }

  async refreshToken(integration: Integration) {
    return this._refreshIntegrationService.refresh(integration);
  }
}
