import { describe, it, expect } from 'vitest';
import { isAbortedRequestEvent } from './aborted-request';

describe('isAbortedRequestEvent', () => {
  it('matches body-parser style BadRequestError', () => {
    expect(
      isAbortedRequestEvent(undefined, [
        { type: 'BadRequestError', value: 'request aborted' },
      ])
    ).toBe(true);
  });

  it('matches plain Error: Request aborted (node http layer)', () => {
    expect(
      isAbortedRequestEvent(undefined, [
        { type: 'Error', value: 'Request aborted' },
      ])
    ).toBe(true);
  });

  it('matches original exception markers', () => {
    expect(isAbortedRequestEvent({ type: 'request.aborted' }, undefined)).toBe(true);
    expect(isAbortedRequestEvent({ code: 'ECONNABORTED' }, undefined)).toBe(true);
    expect(isAbortedRequestEvent({ code: 'ECONNRESET' }, undefined)).toBe(true);
  });

  it('does not match unrelated errors', () => {
    expect(
      isAbortedRequestEvent(undefined, [
        { type: 'Error', value: 'Unsupported file type.' },
      ])
    ).toBe(false);
    expect(isAbortedRequestEvent(undefined, undefined)).toBe(false);
    expect(isAbortedRequestEvent({ code: 'ENOENT' }, undefined)).toBe(false);
  });
});
