/**
 * Pre-parse half of the agent-mesh env shim — see `agent-mesh-env.shim.ts`
 * for the full story. This module must evaluate BEFORE `@reaatech/agent-mesh`
 * (the shim imports them in that order): it seeds the placeholders the
 * package's strict schema requires and stashes any conflicting values so the
 * import-time `loadEnv()` sees a passing environment.
 *
 * `@reaatech/agent-mesh` validates its environment schema at import time and
 * `process.exit(1)`s when `GOOGLE_CLOUD_PROJECT` / `API_KEY` are unset. Those
 * vars only feed the package's own Vertex/Gemini classifier and standalone
 * HTTP gateway — neither of which Postmill uses (the in-process transport
 * replaces them) — so seed harmless placeholders before the first agent-mesh
 * import. Real values, when present, are never overwritten.
 *
 * Deferred remediation items (not addressed here):
 * - Abortable agent dispatch needs upstream `dispatchToAgent` signal support.
 * - Redis-backed conductor mutex: the current single-instance design is
 *   intentionally documented.
 * - `getNextSeq` INCR/EXPIRE two-step is self-limiting; no action taken.
 */

// Version-pinned against the installed package. Bump this comment and the
// `watchedEnvKeys` list when `@reaatech/agent-mesh` is upgraded.
// v1.2.0

// P4.1: Honor the Postmill env name by mapping it to the package's
// `AGENT_REGISTRY_DIR` before the package import. The override intentionally
// persists in `process.env` so later mesh reads (e.g. `loadRegistry()`) see it.
if (process.env.AI_DESIGNER_AGENT_REGISTRY && !process.env.AGENT_REGISTRY_DIR) {
  process.env.AGENT_REGISTRY_DIR = process.env.AI_DESIGNER_AGENT_REGISTRY;
}

// Track keys for which we seeded a placeholder, so the shim can delete them
// after import if the operator never supplied a real value (P4.3).
export const seededKeys: string[] = [];

const seedPlaceholder = (key: string, placeholder: string) => {
  process.env[key] = placeholder;
  if (!seededKeys.includes(key)) {
    seededKeys.push(key);
  }
};

// P4.3: remember the original ENABLE_CIRCUIT_BREAKER value before forcing it
// off for import. The shim restores it afterwards (or deletes it if unset).
let enableCircuitBreakerStashInternal: [string, string] | undefined;
if (process.env.ENABLE_CIRCUIT_BREAKER !== undefined) {
  enableCircuitBreakerStashInternal = [
    'ENABLE_CIRCUIT_BREAKER',
    process.env.ENABLE_CIRCUIT_BREAKER,
  ];
}
export const enableCircuitBreakerStash = enableCircuitBreakerStashInternal;

/**
 * Force the package's built-in circuit breaker OFF for the import-time parse.
 * `dispatchToAgent` gates every call on a module-level breaker keyed by agent
 * id only — five failures from ONE org (e.g. a revoked AI key) would open the
 * breaker for EVERY org, defeating the conductor's per-org breaker. The flag
 * is `z.coerce.boolean()`, so any non-empty string (including "false") coerces
 * to true — the empty string is the only value that disables it. The original
 * env value is restored by the shim immediately after the package loads.
 */
process.env.ENABLE_CIRCUIT_BREAKER = '';

/**
 * Stash unrelated env values the package's strict schema would reject.
 * `loadEnv()` parses ALL of `process.env` at import time and `process.exit(1)`s
 * on any failure, so a generic var set for other tooling (`LOG_LEVEL=verbose`,
 * `NODE_ENV=staging`, a malformed `PORT`) would crash-loop the backend at boot.
 * The shim restores these synchronously right after the `@reaatech/agent-mesh`
 * import — no other module ever evaluates inside the gap.
 */
export const stashedEnv: Array<[string, string]> = [];

const numericInRange = (min: number, max?: number) => (value: string) => {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return false;
  }
  if (n < min) {
    return false;
  }
  if (max !== undefined && n > max) {
    return false;
  }
  return true;
};

const neutralize = (key: string, ok: (value: string) => boolean) => {
  const value = process.env[key];
  if (value !== undefined && !ok(value)) {
    stashedEnv.push([key, value]);
    delete process.env[key];
  }
};

// Every constrained key from `@reaatech/agent-mesh` `EnvironmentSchema`.
// Optional/default string keys (e.g. `GOOGLE_CLOUD_REGION`) accept any string,
// so they do not need a neutralizer, but they MUST be listed here so the
// tripwire spec fails on package upgrades that add new constrained keys.
export const watchedEnvKeys: string[] = [
  'PORT',
  'NODE_ENV',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_CLOUD_REGION',
  'FIRESTORE_DATABASE',
  'VERTEX_AI_LOCATION',
  'VERTEX_AI_MODEL',
  'API_KEY',
  'API_KEY_SECRET_NAME',
  'SLACK_BOT_TOKEN',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'LOG_LEVEL',
  'CIRCUIT_BREAKER_FAILURE_THRESHOLD',
  'CIRCUIT_BREAKER_RESET_TIMEOUT_MS',
  'CIRCUIT_BREAKER_HALF_OPEN_MAX_CALLS',
  'CIRCUIT_BREAKER_HALF_OPEN_TIMEOUT_MS',
  'CB_SYNC_INTERVAL_MS',
  'CB_LEADER_LEASE_MS',
  'CB_LEADER_RENEWAL_MS',
  'SESSION_TTL_MINUTES',
  'SESSION_MAX_TURNS',
  'RATE_LIMIT_WINDOW_MS',
  'RATE_LIMIT_MAX_REQUESTS',
  'AGENT_REGISTRY_DIR',
  'MCP_REQUEST_TIMEOUT_MS',
  'MCP_MAX_RETRIES',
  'ENABLE_SESSION_BYPASS',
  'ENABLE_CLARIFICATION',
  'ENABLE_CIRCUIT_BREAKER',
  'ENABLE_RATE_LIMITING',
];

neutralize('NODE_ENV', (v) =>
  ['development', 'production', 'test'].includes(v)
);
neutralize('LOG_LEVEL', (v) =>
  ['debug', 'info', 'warn', 'error'].includes(v)
);
neutralize('PORT', numericInRange(1, 65535));
neutralize('OTEL_EXPORTER_OTLP_ENDPOINT', (v) => {
  try {
    new URL(v);
    return true;
  } catch {
    return false;
  }
});

neutralize('CIRCUIT_BREAKER_FAILURE_THRESHOLD', numericInRange(1));
neutralize('CIRCUIT_BREAKER_RESET_TIMEOUT_MS', numericInRange(1000));
neutralize('CIRCUIT_BREAKER_HALF_OPEN_MAX_CALLS', numericInRange(1));
neutralize('CIRCUIT_BREAKER_HALF_OPEN_TIMEOUT_MS', numericInRange(1000));
neutralize('CB_SYNC_INTERVAL_MS', numericInRange(1000));
neutralize('CB_LEADER_LEASE_MS', numericInRange(1000));
neutralize('CB_LEADER_RENEWAL_MS', numericInRange(1000));
neutralize('SESSION_TTL_MINUTES', numericInRange(1, 1440));
neutralize('SESSION_MAX_TURNS', numericInRange(1, 1000));
neutralize('RATE_LIMIT_WINDOW_MS', numericInRange(1000));
neutralize('RATE_LIMIT_MAX_REQUESTS', numericInRange(1));
neutralize('MCP_REQUEST_TIMEOUT_MS', numericInRange(1000));

// P4.2: `MCP_MAX_RETRIES` is capped at 5 by the schema. Stash the real value
// and use an in-range placeholder so it still parses, then restore it.
{
  const key = 'MCP_MAX_RETRIES';
  const value = process.env[key];
  if (value !== undefined) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
      stashedEnv.push([key, value]);
      delete process.env[key];
    } else if (n > 5) {
      stashedEnv.push([key, value]);
      process.env[key] = '5';
    }
  }
}

// Booleans (`ENABLE_SESSION_BYPASS`, `ENABLE_CLARIFICATION`,
// `ENABLE_RATE_LIMITING`) are schema-valid under `z.coerce.boolean()` for any
// string, so we do not stash in-range values. `ENABLE_CIRCUIT_BREAKER` is
// forced off above and restored separately.

// Required strings: replace empty values with the placeholder so the parse
// succeeds, stashing the empty value for restoration.
const ensureRequiredString = (key: string) => {
  const value = process.env[key];
  if (value === undefined || value.length === 0) {
    if (value !== undefined) {
      stashedEnv.push([key, value]);
    }
    seedPlaceholder(key, 'agent-mesh-unused');
  }
};
ensureRequiredString('GOOGLE_CLOUD_PROJECT');
ensureRequiredString('API_KEY');
