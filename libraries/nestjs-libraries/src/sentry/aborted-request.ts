/**
 * Client-gone noise: the socket closed mid-request, so nothing we return can
 * reach anyone. Matches every shape this takes — body-parser's BadRequestError,
 * raw http 'request.aborted'/ECONNABORTED/ECONNRESET, and node's plain
 * `Error: Request aborted` (any exception type, any casing).
 *
 * Lives in its own module (no @sentry imports) so specs can exercise it
 * without loading the native @sentry/profiling-node binding into the test
 * worker.
 */
export const isAbortedRequestEvent = (
  original: { type?: string; code?: string } | undefined,
  values: { type?: string; value?: string }[] | undefined
): boolean =>
  original?.type === 'request.aborted' ||
  original?.code === 'ECONNABORTED' ||
  original?.code === 'ECONNRESET' ||
  !!values?.some((v) => /request aborted/i.test(v.value ?? ''));
