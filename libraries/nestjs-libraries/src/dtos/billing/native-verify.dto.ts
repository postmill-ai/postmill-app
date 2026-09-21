import { IsIn, IsObject } from 'class-validator';
import { PAYMENT_PROVIDER_IDS, paymentProviderEnv } from '@postmill-ai/helpers/billing/payments.env';

const NATIVE_PROVIDERS = PAYMENT_PROVIDER_IDS.filter(
  (id) => paymentProviderEnv(id).checkoutMode === 'native'
);

/**
 * A store purchase handed over by the mobile app for server-side verification.
 * `payload` is provider-shaped: `{ jws }` for Apple (the signed transaction),
 * `{ purchaseToken, productId }` for Google.
 */
export class NativeVerifyDto {
  @IsIn(NATIVE_PROVIDERS)
  provider: string;

  @IsObject()
  payload: Record<string, unknown>;
}
