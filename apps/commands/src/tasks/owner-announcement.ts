import { Command, Positional } from 'nestjs-command';
import { Injectable } from '@nestjs/common';
import { OwnerEmailCampaignService } from '@postmill-ai/nestjs-libraries/services/owner-email-campaign.service';

@Injectable()
export class OwnerAnnouncement {
  constructor(private _campaign: OwnerEmailCampaignService) {}

  @Command({
    command: 'announcement:open-beta-end <mode> [target]',
    describe: 'Preview, test, send, or inspect the one-time English owner announcement',
  })
  async run(
    @Positional({ name: 'mode', type: 'string' })
    mode: 'preview' | 'test' | 'send' | 'status',
    @Positional({ name: 'target', type: 'string' })
    target?: string
  ) {
    let result: unknown;
    switch (mode) {
      case 'preview':
        result = await this._campaign.preview();
        break;
      case 'test':
        if (!target) throw new Error('Test mode requires an eligible owner email');
        result = await this._campaign.sendTest(target);
        break;
      case 'send':
        if (!target) throw new Error('Send mode requires the campaign confirmation');
        result = await this._campaign.sendAll(target);
        break;
      case 'status':
        result = await this._campaign.status();
        break;
      default:
        throw new Error('Mode must be preview, test, send, or status');
    }
    console.log(JSON.stringify(result, null, 2));
    return result;
  }
}
