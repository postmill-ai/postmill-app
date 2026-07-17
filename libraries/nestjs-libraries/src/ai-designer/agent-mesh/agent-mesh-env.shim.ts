/**
 * `@reaatech/agent-mesh` runs a strict `loadEnv()` (zod parse of ALL of
 * `process.env`, `process.exit(1)` on failure) at module top level. This shim
 * bounds that parse in a zero-exposure window:
 *
 *   1. `agent-mesh-env.stash.ts` seeds the placeholders the schema requires
 *      (`GOOGLE_CLOUD_PROJECT` / `API_KEY`), forces the package's global
 *      circuit breaker off (`ENABLE_CIRCUIT_BREAKER=''`) for the import-time
 *      parse, and stashes any conflicting generic values (`LOG_LEVEL=verbose`,
 *      `NODE_ENV=staging`, a malformed `PORT`).
 *   2. `import '@reaatech/agent-mesh'` triggers the strict parse — verified
 *      against the package dist: both `dist/index.cjs` and `dist/index.js`
 *      evaluate `var env = loadEnv()` at import time, so by the next
 *      statement the parse has run and its result is cached.
 *   3. The loop below restores the stashed values synchronously, before this
 *      module finishes evaluating — so no OTHER module (in this tick or any
 *      later one) can ever observe the deleted vars. (The previous
 *      `setImmediate` restore left every module imported later in the same
 *      tick reading `NODE_ENV`/`LOG_LEVEL` as undefined at module scope.)
 *
 * This module MUST be the first import in every file that imports an
 * `@reaatech/agent-mesh*` package; both TypeScript's CommonJS output and ESM
 * preserve the import order, so the stash lands before the package's env
 * parse and the restore lands right after it.
 *
 * Deferred remediation items (not addressed here):
 * - Abortable agent dispatch needs upstream `dispatchToAgent` signal support.
 * - Redis-backed conductor mutex: the current single-instance design is
 *   intentionally documented.
 * - `getNextSeq` INCR/EXPIRE two-step is self-limiting; no action taken.
 */
import {
  enableCircuitBreakerStash,
  seededKeys,
  stashedEnv,
} from './agent-mesh-env.stash';
import '@reaatech/agent-mesh';

const restoredKeys = new Set<string>();

for (const [key, value] of stashedEnv) {
  process.env[key] = value;
  restoredKeys.add(key);
}
stashedEnv.length = 0;

// P4.3: delete placeholder values we seeded if the operator never had a real
// value stashed. This keeps `process.env` clean for introspection and avoids
// leaking the placeholder to any code that reads these keys after import.
for (const key of seededKeys) {
  if (!restoredKeys.has(key)) {
    delete process.env[key];
  }
}

// P4.3: restore the original ENABLE_CIRCUIT_BREAKER value (or delete it if it
// was unset). It was forced to '' only to make the import-time parse disable
// the package's global breaker.
if (enableCircuitBreakerStash) {
  process.env.ENABLE_CIRCUIT_BREAKER = enableCircuitBreakerStash[1];
} else {
  delete process.env.ENABLE_CIRCUIT_BREAKER;
}

export {};
