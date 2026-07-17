import { Injectable, Optional } from '@nestjs/common';

/**
 * Production circuit-breaker for AI provider calls (§7 / §12 #8).
 *
 * The plan deferred this to a not-yet-published `@reaatech` circuit-breaker package
 * and used a bare retry/timeout wrapper as the interim. This is the real in-repo
 * implementation so nothing is deferred: a per-provider state machine
 *
 *   CLOSED ──(failureThreshold consecutive failures)──▶ OPEN
 *   OPEN ──(cooldownMs elapsed)──▶ HALF_OPEN
 *   HALF_OPEN ──(success)──▶ CLOSED   |   HALF_OPEN ──(failure)──▶ OPEN
 *
 * While a provider's breaker is OPEN the facade skips the primary call and goes
 * straight to the configured fallback provider (or fails fast), so a dead provider
 * stops eating latency/quota on every request. Purely in-memory and process-local —
 * consistent with the ~60s settings TTL model (§3.2.1); no new infra required.
 */
export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  failureThreshold: number; // consecutive failures before opening
  cooldownMs: number; // time OPEN before allowing a HALF_OPEN probe
}

interface CircuitRecord {
  state: CircuitState;
  consecutiveFailures: number;
  openedAt: number | null;
}

const DEFAULT_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 5,
  cooldownMs: 30_000,
};

@Injectable()
export class CircuitBreakerService {
  private _records = new Map<string, CircuitRecord>();

  // @Optional so Nest can instantiate this as a provider — `CircuitBreakerOptions` is an
  // interface (no DI token), so without @Optional the container would fail to resolve it.
  constructor(@Optional() private _options: CircuitBreakerOptions = DEFAULT_OPTIONS) {}

  /**
   * May a call to this provider be attempted right now? Transitions OPEN→HALF_OPEN
   * once the cooldown has elapsed (allowing a single probe).
   */
  canAttempt(providerId: string): boolean {
    const r = this._records.get(providerId);
    if (!r || r.state === 'closed') return true;
    if (r.state === 'half-open') return true;
    // OPEN: allow a probe once the cooldown has elapsed
    if (r.openedAt !== null && Date.now() - r.openedAt >= this._options.cooldownMs) {
      r.state = 'half-open';
      return true;
    }
    return false;
  }

  recordSuccess(providerId: string): void {
    const r = this._getOrCreate(providerId);
    r.state = 'closed';
    r.consecutiveFailures = 0;
    r.openedAt = null;
  }

  recordFailure(providerId: string): void {
    const r = this._getOrCreate(providerId);
    if (r.state === 'half-open') {
      // probe failed — re-open immediately
      r.state = 'open';
      r.openedAt = Date.now();
      return;
    }
    r.consecutiveFailures++;
    if (r.consecutiveFailures >= this._options.failureThreshold) {
      r.state = 'open';
      r.openedAt = Date.now();
    }
  }

  getState(providerId: string): CircuitState {
    return this._records.get(providerId)?.state ?? 'closed';
  }

  private _getOrCreate(providerId: string): CircuitRecord {
    let r = this._records.get(providerId);
    if (!r) {
      r = { state: 'closed', consecutiveFailures: 0, openedAt: null };
      this._records.set(providerId, r);
    }
    return r;
  }
}
