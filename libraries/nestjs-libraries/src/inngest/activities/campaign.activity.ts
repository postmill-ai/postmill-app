import { Injectable } from '@nestjs/common';
import { CampaignTagService } from '@gitroom/nestjs-libraries/database/prisma/campaigns/campaign-item.service';

@Injectable()
export class CampaignActivity {
  constructor(private _campaignTagService: CampaignTagService) {}

  async purgeExpiredItems(days: number): Promise<{ deleted: number }> {
    return this._campaignTagService.purgeExpiredItems(days);
  }
}
