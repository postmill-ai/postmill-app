/**
 * Retryable error thrown when a provider access token needs to be refreshed.
 * Inngest will retry the step that throws this by default.
 */
export class RefreshTokenError extends Error {
  constructor(
    public identifier: string,
    public json: string,
    public body: BodyInit,
    message = ''
  ) {
    super(message);
    this.name = 'RefreshTokenError';
  }
}
