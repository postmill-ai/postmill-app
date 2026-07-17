import { describe, expect, it } from 'vitest';
import { parseAgentInput } from './parse-agent-input';

describe('parseAgentInput', () => {
  it('returns the parsed object for valid JSON', () => {
    const result = parseAgentInput<{ type: 'ok'; value: number }>(
      '{"type":"ok","value":42}'
    );
    expect(result).toEqual({ type: 'ok', value: 42 });
  });

  it('returns an error envelope for malformed JSON', () => {
    const result = parseAgentInput<unknown>('not json');
    expect(result).toEqual({
      type: 'error',
      message: expect.stringContaining('Malformed agent input:'),
    });
    expect(result).toEqual({
      type: 'error',
      message: expect.stringContaining('JSON'),
    });
  });

  it('includes the original SyntaxError message in the envelope', () => {
    const result = parseAgentInput<unknown>('{"broken');
    expect(result).toEqual({
      type: 'error',
      message: expect.stringMatching(/Malformed agent input:.*JSON/),
    });
  });

  it('casts the parsed value to the generic type', () => {
    interface Payload {
      id: string;
    }
    const result = parseAgentInput<Payload>('{"id":"abc"}');
    // Type-only assertion; runtime shape is verified below.
    expect(result).toEqual({ id: 'abc' });
  });
});
