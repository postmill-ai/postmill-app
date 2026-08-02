import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseOrRepair } from './parse-or-repair';

describe('parseOrRepair', () => {
  const OpsSchema = z.array(
    z.object({ op: z.string(), src: z.string().optional() })
  );

  it('returns a valid payload untouched, https:// URLs included', async () => {
    // The whole point: repair() strips `//…` comments string-unaware BEFORE
    // any parse, so `https://` inside op JSON gets mangled and can void the
    // entire array. A valid reply must never reach repair().
    const raw = JSON.stringify([
      { op: 'updateElement', src: 'https://cdn.example.com/a.png?w=1&h=2' },
      { op: 'setOutputBackground' },
    ]);

    await expect(parseOrRepair(OpsSchema, raw)).resolves.toEqual([
      { op: 'updateElement', src: 'https://cdn.example.com/a.png?w=1&h=2' },
      { op: 'setOutputBackground' },
    ]);
  });

  it('keeps a protocol-relative //host URL intact too', async () => {
    const raw = JSON.stringify({ src: '//cdn.example.com/a.png' });

    await expect(
      parseOrRepair(z.object({ src: z.string() }), raw)
    ).resolves.toEqual({ src: '//cdn.example.com/a.png' });
  });

  it('strips a markdown fence before parsing', async () => {
    const raw = '```json\n{"src":"https://example.com/x.png"}\n```';

    await expect(
      parseOrRepair(z.object({ src: z.string() }), raw)
    ).resolves.toEqual({ src: 'https://example.com/x.png' });
  });

  it('still repairs malformed input', async () => {
    // Trailing comma + unquoted key: not parseable, so repair() earns its keep.
    const raw = '{ headline: "Hello", subhead: "World", }';

    await expect(parseOrRepair(z.record(z.string()), raw)).resolves.toEqual({
      headline: 'Hello',
      subhead: 'World',
    });
  });

  it('falls through to repair when the JSON parses but fails the schema', async () => {
    const raw = '{"op": 42}';

    // Valid JSON, wrong shape — repair() gets its chance (and here coerces).
    await expect(
      parseOrRepair(z.object({ op: z.coerce.string() }), raw)
    ).resolves.toEqual({ op: '42' });
  });

  it('propagates the repair throw for unsalvageable input (callers catch it)', async () => {
    await expect(
      parseOrRepair(OpsSchema, 'I cannot help with that request.')
    ).rejects.toThrow();
  });
});
