import { describe, expect, it } from 'vitest';
import { throwIfAborted } from './throw-if-aborted';

describe('throwIfAborted', () => {
  it('does nothing without a signal or with a live signal', () => {
    expect(() => throwIfAborted()).not.toThrow();
    expect(() => throwIfAborted(new AbortController().signal)).not.toThrow();
  });

  it("throws 'Cancelled' — the message _dispatchAgent maps to PipelineCancelledError — once aborted", () => {
    expect(() => throwIfAborted(AbortSignal.abort())).toThrow('Cancelled');
  });
});
