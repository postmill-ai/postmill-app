import {
  Controller,
  HttpException,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { EmailLogService } from '@gitroom/nestjs-libraries/database/prisma/emails/email-log.service';
import { EmailAdapterRegistry } from '@gitroom/nestjs-libraries/emails/email-adapter.registry';

@ApiTags('Email')
@Controller('/webhooks/email')
export class EmailWebhooksController {
  constructor(
    private _emailLog: EmailLogService,
    private _registry: EmailAdapterRegistry,
  ) {}

  @Post('/')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async handle(@Req() req: RawBodyRequest<Request>) {
    const adapter = this._registry.getActiveAdapter();
    if (!adapter.capabilities.webhooks || !adapter.verifyWebhook || !adapter.parseWebhook) {
      return { ok: true };
    }

    const headers = req.headers as unknown as Record<string, string | undefined>;

    if (!(await adapter.verifyWebhook(req.rawBody!, headers))) {
      throw new HttpException('invalid signature', 401);
    }

    const events = adapter.parseWebhook(req.rawBody!, headers);
    for (const e of events) {
      await this._emailLog.applyWebhookEvent(adapter.name, e);
    }

    return { ok: true };
  }
}
