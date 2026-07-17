import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  CampaignReportService,
  CampaignReportAnalytics,
} from '@gitroom/nestjs-libraries/database/prisma/campaigns/campaign-report.service';

@Controller('/public/campaign-report')
export class PublicCampaignController {
  constructor(private _reportService: CampaignReportService) {}

  @Get('/:token')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async getSharedReport(@Param('token') token: string) {
    // Resolve the share token first so we can compute campaign analytics.
    // Unknown/disabled token → 404 before any analytics work.
    const resolved = await this._reportService.resolveShareToken(token);
    if (!resolved) {
      throw new NotFoundException();
    }

    const analytics: CampaignReportAnalytics | undefined =
      await this._reportService.computeAnalytics(
        resolved.organizationId,
        resolved.id
      );

    try {
      return await this._reportService.toPublicJson(token, analytics);
    } catch {
      throw new NotFoundException();
    }
  }
}
