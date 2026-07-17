/**
 * Re-export shim. `SocialAbstract` was relocated into `@gitroom/provider-kernel`
 * (step 7.5.2) so provider packages no longer depend on this package. The
 * security primitives it uses (VPN als, ssrf dispatcher, inngest error classes)
 * stay here and are injected once at bootstrap via `setSocialFetchPorts`
 * (see DatabaseModule.onModuleInit). Existing consumers import unchanged.
 */
export {
  SocialAbstract,
  NotEnoughScopes,
  type ValidityMedia,
} from '@gitroom/provider-kernel';

import {
  RefreshTokenError,
  BadBodyError,
} from '@gitroom/nestjs-libraries/inngest/errors';

/**
 * Retryable error thrown when a provider access token needs to be refreshed.
 * @deprecated Use `RefreshTokenError` from `@gitroom/nestjs-libraries/inngest/errors`.
 */
export const RefreshToken = RefreshTokenError;

/**
 * Non-retryable error thrown when a provider rejects the request body.
 * @deprecated Use `BadBodyError` from `@gitroom/nestjs-libraries/inngest/errors`.
 */
export const BadBody = BadBodyError;
