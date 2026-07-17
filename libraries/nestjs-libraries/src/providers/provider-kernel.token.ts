/**
 * DI token for the singleton ProviderKernel.
 *
 * Kept in its own module to break the circular import between
 * `providers.module.ts` (provides the token) and
 * `provider-resolution.service.ts` (injects it). When both imported the symbol
 * from `providers.module.ts`, load order could leave it `undefined` at the time
 * the service's `@Inject()` decorator ran → Nest "can't resolve index [0]".
 */
export const PROVIDER_KERNEL = Symbol('ProviderKernel');
