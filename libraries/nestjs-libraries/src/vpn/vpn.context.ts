import { AsyncLocalStorage } from 'node:async_hooks';
import type { Dispatcher } from 'undici';

// Carries the per-channel VPN proxy dispatcher across the async call tree of a
// single publish, so `SocialAbstract.fetch()` can pick it up without every
// provider's `post()` signature having to thread it through. Providers are
// singletons — a per-instance field would be clobbered by concurrent posts, so
// AsyncLocalStorage is the only safe channel (mirrors chat/async.storage.ts).
type VpnCtx = { dispatcher?: Dispatcher };

const als = new AsyncLocalStorage<VpnCtx>();

export function runWithVpnDispatcher<T>(
  dispatcher: Dispatcher | undefined,
  fn: () => Promise<T> | T,
): Promise<T> | T {
  return als.run({ dispatcher }, fn);
}

export function getVpnDispatcher(): Dispatcher | undefined {
  return als.getStore()?.dispatcher;
}
