/**
 * Shared abort gate for the AI Designer agents. The conductor threads an
 * AbortSignal into the dispatch metadata (in-process agents receive the
 * metadata object by reference), and each handler checks it before starting
 * billable work — a cancelled/timed-out session must not begin an LLM or
 * image call that nobody will read.
 *
 * The thrown message MUST stay 'Cancelled': it matches raceWithTimeout's
 * rejection, which the conductor's `_dispatchAgent` promotes to
 * PipelineCancelledError — a user cancel, not a provider failure, so the
 * circuit breaker must not count it.
 */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('Cancelled');
  }
}
