import { Controller, Post, RawBodyRequest, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { PaymentsService } from '@postmill-ai/nestjs-libraries/payments/payments.service';

/**
 * Deprecated alias for `POST /payments/webhooks/stripe`, kept so Stripe
 * dashboards configured before the payments domain existed keep delivering.
 * Re-point the dashboard webhook and this route goes away in a later release.
 */
@ApiTags('Stripe')
@Controller('/stripe')
export class StripeController {
  constructor(private readonly _payments: PaymentsService) {}

  @Post('/')
  @ApiOperation({
    deprecated: true,
    summary: 'Deprecated: use POST /payments/webhooks/stripe',
  })
  async stripe(@Req() req: RawBodyRequest<Request>) {
    return this._payments.handleWebhook(
      'stripe',
      req.rawBody ?? Buffer.from(''),
      req.headers as Record<string, string | undefined>,
      {}
    );
  }
}
