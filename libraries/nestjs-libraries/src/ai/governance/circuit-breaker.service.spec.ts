import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CircuitBreakerService } from './circuit-breaker.service';

describe('CircuitBreakerService', () => {
  let breaker: CircuitBreakerService;

  beforeEach(() => {
    vi.useFakeTimers();
    breaker = new CircuitBreakerService({ failureThreshold: 3, cooldownMs: 1000 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts closed and allows attempts', () => {
    expect(breaker.getState('openai')).toBe('closed');
    expect(breaker.canAttempt('openai')).toBe(true);
  });

  it('opens after the failure threshold of consecutive failures', () => {
    breaker.recordFailure('openai');
    breaker.recordFailure('openai');
    expect(breaker.getState('openai')).toBe('closed');
    expect(breaker.canAttempt('openai')).toBe(true);

    breaker.recordFailure('openai'); // 3rd → opens
    expect(breaker.getState('openai')).toBe('open');
    expect(breaker.canAttempt('openai')).toBe(false);
  });

  it('a success resets the consecutive-failure count', () => {
    breaker.recordFailure('openai');
    breaker.recordFailure('openai');
    breaker.recordSuccess('openai');
    breaker.recordFailure('openai');
    breaker.recordFailure('openai');
    expect(breaker.getState('openai')).toBe('closed'); // never reached 3 in a row
  });

  it('transitions OPEN → HALF_OPEN after the cooldown and allows a probe', () => {
    breaker.recordFailure('openai');
    breaker.recordFailure('openai');
    breaker.recordFailure('openai');
    expect(breaker.canAttempt('openai')).toBe(false);

    vi.advanceTimersByTime(1001);
    expect(breaker.canAttempt('openai')).toBe(true);
    expect(breaker.getState('openai')).toBe('half-open');
  });

  it('a successful probe closes the breaker', () => {
    breaker.recordFailure('openai');
    breaker.recordFailure('openai');
    breaker.recordFailure('openai');
    vi.advanceTimersByTime(1001);
    breaker.canAttempt('openai'); // → half-open
    breaker.recordSuccess('openai');
    expect(breaker.getState('openai')).toBe('closed');
    expect(breaker.canAttempt('openai')).toBe(true);
  });

  it('a failed probe re-opens the breaker immediately', () => {
    breaker.recordFailure('openai');
    breaker.recordFailure('openai');
    breaker.recordFailure('openai');
    vi.advanceTimersByTime(1001);
    breaker.canAttempt('openai'); // → half-open
    breaker.recordFailure('openai');
    expect(breaker.getState('openai')).toBe('open');
    expect(breaker.canAttempt('openai')).toBe(false);
  });

  it('tracks providers independently', () => {
    breaker.recordFailure('openai');
    breaker.recordFailure('openai');
    breaker.recordFailure('openai');
    expect(breaker.canAttempt('openai')).toBe(false);
    expect(breaker.canAttempt('anthropic')).toBe(true);
  });
});
