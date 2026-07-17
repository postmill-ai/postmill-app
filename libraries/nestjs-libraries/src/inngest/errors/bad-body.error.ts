import { NonRetriableError } from 'inngest';

/**
 * Non-retryable error thrown when a provider rejects the request body.
 * Inngest will stop retrying a step that throws this.
 */
export class BadBodyError extends NonRetriableError {
  constructor(
    public identifier: string,
    public json: string,
    public body: BodyInit,
    message = ''
  ) {
    super(message);
    this.name = 'BadBodyError';
  }
}
