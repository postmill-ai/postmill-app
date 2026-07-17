export interface AgentInputError {
  type: 'error';
  message: string;
}

export function isAgentInputError<T>(
  value: T | AgentInputError
): value is AgentInputError {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as AgentInputError).type === 'error'
  );
}

/**
 * Safely parse the raw JSON input supplied to an in-process agent handler.
 *
 * Returns the parsed payload on success, or a serializable error envelope on
 * `SyntaxError`. Callers should return the envelope as the `AgentResponse`
 * content instead of letting a raw `SyntaxError` propagate into the circuit
 * breaker.
 */
export function parseAgentInput<T>(raw: string): T | AgentInputError {
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    const cause =
      err instanceof Error ? err.message : String(err ?? 'unknown error');
    return {
      type: 'error',
      message: `Malformed agent input: ${cause}`,
    };
  }
}
