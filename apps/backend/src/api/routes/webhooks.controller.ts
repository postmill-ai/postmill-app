import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { WebhooksService } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  OnlyURL, SendWebhookDto, UpdateDto, WebhooksDto
} from '@gitroom/nestjs-libraries/dtos/webhooks/webhooks.dto';
import { AuthorizationActions, Sections } from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { safeFetch, webhookSignature, webhookTimeoutMs } from '@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch';
import { RequirePermission } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';

@ApiTags('Webhooks')
@Controller('/webhooks')
export class WebhookController {
  constructor(private _webhooksService: WebhooksService) {}

  @Get('/')
  async getStatistics(@GetOrgFromRequest() org: Organization) {
    return this._webhooksService.getWebhooks(org.id);
  }

  @Post('/')
  @CheckPolicies([AuthorizationActions.Create, Sections.WEBHOOKS])
  async createAWebhook(
    @GetOrgFromRequest() org: Organization,
    @Body() body: WebhooksDto
  ) {
    return this._webhooksService.createWebhook(org.id, body);
  }

  @Put('/')
  @RequirePermission('webhooks', 'update')
  async updateWebhook(
    @GetOrgFromRequest() org: Organization,
    @Body() body: UpdateDto
  ) {
    return this._webhooksService.createWebhook(org.id, body);
  }

  @Post('/test-ping/:id')
  @CheckPolicies([AuthorizationActions.Create, Sections.WEBHOOKS])
  async testPing(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
  ) {
    const webhooks = await this._webhooksService.getWebhooks(org.id);
    const webhook = webhooks.find(w => w.id === id);
    if (!webhook) {
      throw new HttpException('Webhook not found', 404);
    }

    try {
      const body = JSON.stringify({
        event: 'ping',
        timestamp: new Date().toISOString(),
        data: { message: 'This is a test ping from Postmill' },
      });
      const response = await safeFetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Postmill-Signature': webhookSignature(body),
        },
        body,
        signal: AbortSignal.timeout(webhookTimeoutMs()),
      });
      return { success: true, status: response.status };
    } catch (err: any) {
      return { success: false, status: 0, error: err?.message || 'Connection failed' };
    }
  }

  @Delete('/:id')
  @RequirePermission('webhooks', 'delete')
  async deleteWebhook(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._webhooksService.deleteWebhook(org.id, id);
  }

  @Post('/send')
  @RequirePermission('webhooks', 'create')
  async sendWebhook(
    @GetOrgFromRequest() org: Organization,
    @Body() body: SendWebhookDto,
    @Query() query: OnlyURL
  ) {
    try {
      const serialized = JSON.stringify({
        event: 'webhook.send',
        timestamp: new Date().toISOString(),
        data: body,
      });
      await safeFetch(query.url, {
        method: 'POST',
        body: serialized,
        headers: {
          'Content-Type': 'application/json',
          'X-Postmill-Signature': webhookSignature(serialized),
        },
        signal: AbortSignal.timeout(webhookTimeoutMs()),
      });
    } catch (err) {
      /** sent **/
    }

    return { send: true };
  }
}
