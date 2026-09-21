import { Controller, Param, Post, Query, RawBodyRequest, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { PaymentsService } from '@postmill-ai/nestjs-libraries/payments/payments.service';

/**
 * One webhook route per payment provider. The provider adapter verifies the
 * vendor signature and translates the payload; `PaymentsService.handleWebhook`
 * owns idempotency and every database transition. Unknown or unconfigured
 * providers are a 404, a failed signature a 401, an apply error a retryable 500.
 * Public (no cookie/RBAC): the vendor signature is the authentication.
 */
@ApiTags('Payments')
@Controller('/payments/webhooks')
export class PaymentsWebhooksController {
  constructor(private readonly _payments: PaymentsService) {}

  @Post('/:provider')
  @ApiOperation({ summary: 'Vendor webhook receiver (stripe, paypal, apple, google)' })
  async receive(
    @Param('provider') provider: string,
    @Req() req: RawBodyRequest<Request>,
    @Query() query: Record<string, string>
  ) {
    return this._payments.handleWebhook(
      provider.toLowerCase(),
      req.rawBody ?? Buffer.from(''),
      req.headers as Record<string, string | undefined>,
      query ?? {}
    );
  }
}
