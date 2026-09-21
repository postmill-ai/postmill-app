import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Response } from 'express';
import { PaymentsUnsupportedOperationError } from '@postmill-ai/provider-kernel';

/** True for the kernel error class from any module realm (provider packages may load their own kernel copy). */
export function isUnsupportedOperationError(err: unknown): err is PaymentsUnsupportedOperationError {
  return (
    err instanceof PaymentsUnsupportedOperationError ||
    (err as Error)?.name === 'PaymentsUnsupportedOperationError'
  );
}

export function isWebhookVerificationError(err: unknown): boolean {
  return (err as Error)?.name === 'PaymentsWebhookVerificationError';
}

/**
 * The org's payment provider cannot do what the route asked (PayPal has no
 * billing portal, the stores have no add-ons, …). 400 with a stable code so the
 * billing UI can hide the affordance instead of showing a raw error.
 */
@Catch(PaymentsUnsupportedOperationError)
export class PaymentsUnsupportedOperationFilter implements ExceptionFilter {
  catch(exception: PaymentsUnsupportedOperationError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    response.status(HttpStatus.BAD_REQUEST).json({
      statusCode: HttpStatus.BAD_REQUEST,
      code: 'PAYMENTS_UNSUPPORTED',
      provider: exception.provider,
      operation: exception.operation,
      message: exception.message,
    });
  }
}

export const PAYMENTS_UNSUPPORTED_FILTER = {
  provide: APP_FILTER,
  useClass: PaymentsUnsupportedOperationFilter,
};
