import { describe, it, expect } from 'vitest';
import { readErrorMessage } from './read-error-message';

const res = (body: unknown) =>
  ({ json: () => Promise.resolve(body) }) as unknown as Response;

const badJsonRes = () =>
  ({ json: () => Promise.reject(new Error('not json')) }) as unknown as Response;

describe('readErrorMessage', () => {
  it('prefers the 409 { error } envelope', async () => {
    await expect(
      readErrorMessage(
        res({ error: 'No default configured for image-slide', category: 'image-slide' }),
        'fallback'
      )
    ).resolves.toBe('No default configured for image-slide');
  });

  it('reads a string message (400/402 Nest shape)', async () => {
    await expect(
      readErrorMessage(res({ message: 'Budget exceeded', statusCode: 402 }), 'fallback')
    ).resolves.toBe('Budget exceeded');
  });

  it('joins a validation-pipe message array', async () => {
    await expect(
      readErrorMessage(
        res({ message: ['prompt must be a string', 'prompt should not be empty'], statusCode: 400 }),
        'fallback'
      )
    ).resolves.toBe('prompt must be a string prompt should not be empty');
  });

  it('prefers error over message when both are present', async () => {
    await expect(
      readErrorMessage(res({ error: 'real reason', message: 'Conflict' }), 'fallback')
    ).resolves.toBe('real reason');
  });

  it('prefers a specific message over a generic HTTP reason phrase', async () => {
    // Nest's standard error body: { message: <specific>, error: <reason phrase> }.
    await expect(
      readErrorMessage(
        res({
          message: 'Model "acme/slow-video" is not allowed',
          error: 'Bad Request',
          statusCode: 400,
        }),
        'fallback'
      )
    ).resolves.toBe('Model "acme/slow-video" is not allowed');
  });

  it('falls back when the body has nothing usable', async () => {
    await expect(readErrorMessage(res({}), 'fallback')).resolves.toBe('fallback');
    await expect(readErrorMessage(res('nope'), 'fallback')).resolves.toBe('fallback');
    await expect(readErrorMessage(res({ message: [] }), 'fallback')).resolves.toBe('fallback');
  });

  it('falls back when the body is not JSON', async () => {
    await expect(readErrorMessage(badJsonRes(), 'fallback')).resolves.toBe('fallback');
  });
});
