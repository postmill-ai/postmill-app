import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { parseFontMetadata } from './font-metadata';

/**
 * Real font files, because the failure being fixed was a parse that never
 * happened — the uploader took the family from the filename and wrote 400 for
 * every weight, so Regular and Bold of one typeface became two 400-weight
 * families and one of them was always dropped.
 */

const TTF_BOLD = 'node_modules/pdfjs-dist/standard_fonts/LiberationSans-Bold.ttf';
const TTF_ITALIC = 'node_modules/pdfjs-dist/standard_fonts/LiberationSans-Italic.ttf';
const WOFF2 = 'node_modules/material-icons/iconfont/material-icons-outlined.woff2';

// Vitest is rooted at the package for some runs and the repo for others, so
// resolve against whichever one actually holds node_modules.
const ROOTS = [process.cwd(), `${process.cwd()}/../..`];
const at = (path: string) =>
  ROOTS.map((r) => `${r}/${path}`).find((p) => existsSync(p));
const read = (path: string) => readFileSync(at(path)!);
const has = (path: string) => !!at(path);

describe('parseFontMetadata', () => {
  it.runIf(has(TTF_BOLD))('reads family and weight out of a TTF', () => {
    const meta = parseFontMetadata(read(TTF_BOLD));
    // Name ID 16 groups the weights; ID 1 would say "Liberation Sans Bold",
    // which is exactly the split this fixes.
    expect(meta.family).toBe('Liberation Sans');
    expect(meta.weight).toBe(700);
    expect(meta.italic).toBe(false);
  });

  it.runIf(has(TTF_ITALIC))('reads the italic bit', () => {
    const meta = parseFontMetadata(read(TTF_ITALIC));
    expect(meta.family).toBe('Liberation Sans');
    expect(meta.weight).toBe(400);
    expect(meta.italic).toBe(true);
  });

  it.runIf(has(TTF_BOLD) && has(TTF_ITALIC))(
    'gives two faces of one typeface the SAME family and different weights',
    () => {
      const bold = parseFontMetadata(read(TTF_BOLD));
      const italic = parseFontMetadata(read(TTF_ITALIC));
      expect(bold.family).toBe(italic.family);
      expect(bold.weight).not.toBe(italic.weight);
    }
  );

  it.runIf(has(WOFF2))('decompresses a woff2 and reads it too', () => {
    const meta = parseFontMetadata(read(WOFF2));
    expect(meta.family).toBeTruthy();
    expect(meta.weight).toBeGreaterThan(0);
  });

  it('returns nothing rather than throwing on rubbish', () => {
    expect(parseFontMetadata(Buffer.alloc(0))).toEqual({});
    expect(parseFontMetadata(Buffer.from('not a font at all'))).toEqual({});
    // A plausible sfnt header with a table directory pointing off the end.
    const fake = Buffer.alloc(28);
    fake.writeUInt32BE(0x00010000, 0);
    fake.writeUInt16BE(1, 4);
    fake.write('name', 12, 'latin1');
    fake.writeUInt32BE(9999, 20);
    fake.writeUInt32BE(9999, 24);
    expect(parseFontMetadata(fake)).toEqual({});
  });

  it('does not choke on a truncated woff2 body', () => {
    const fake = Buffer.alloc(64);
    fake.write('wOF2', 0, 'latin1');
    fake.writeUInt16BE(1, 12);
    fake.writeUInt32BE(9999, 20);
    expect(() => parseFontMetadata(fake)).not.toThrow();
  });
});
