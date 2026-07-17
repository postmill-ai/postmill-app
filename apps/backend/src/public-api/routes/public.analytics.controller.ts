import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AnalyticsShareService } from '@gitroom/nestjs-libraries/analytics/analytics-share.service';

// 7.6 — public, unauthenticated org-level analytics share report. Mirrors
// PublicCampaignController: resolve the token → enabled share, compute the
// explicit-whitelist report, 404 on unknown/disabled/rotated tokens.
@Controller('/public/analytics-report')
export class PublicAnalyticsController {
  constructor(private _shareService: AnalyticsShareService) {}

  @Get('/:token')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async getSharedReport(@Param('token') token: string) {
    const report = await this._shareService.buildPublicReport(token);
    if (!report) {
      throw new NotFoundException();
    }
    return report;
  }
}
