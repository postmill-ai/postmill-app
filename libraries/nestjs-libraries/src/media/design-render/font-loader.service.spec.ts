import { describe, it, expect } from 'vitest';
import { safeFileId } from './font-loader.service';

describe('safeFileId (6.4 font-loader temp filename sanitize)', () => {
  it('strips path separators and traversal sequences from a fileId', () => {
    expect(safeFileId('../../etc/passwd')).toBe('______etc_passwd');
    expect(safeFileId('a/b/c')).toBe('a_b_c');
    expect(safeFileId('x\\y')).toBe('x_y');
    expect(safeFileId('a b.ttf')).toBe('a_b_ttf');
  });

  it('leaves already-safe ids intact', () => {
    expect(safeFileId('file_123-ABC')).toBe('file_123-ABC');
  });
});
