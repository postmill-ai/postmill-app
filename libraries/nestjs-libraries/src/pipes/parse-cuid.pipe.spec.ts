import { describe, it, expect, afterEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { isCuid, ParseCuidPipe } from './parse-cuid.pipe';

describe('ParseCuidPipe / isCuid', () => {
  const ORIGINAL_ENV = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_ENV;
  });

  it('accepts real cuid2 ids in any environment', () => {
    process.env.NODE_ENV = 'production';
    expect(isCuid('cmpz4vjqd0000ol7p9t6ofk10')).toBe(true);
  });

  it('rejects non-cuid values', () => {
    expect(isCuid('not-an-id!')).toBe(false);
    expect(isCuid('')).toBe(false);
    expect(isCuid(undefined)).toBe(false);
    expect(isCuid(123)).toBe(false);
  });

  // R2 — demo-* ids are a dev-seeder convenience; production must 400 them.
  it('accepts demo-* ids only in development', () => {
    process.env.NODE_ENV = 'development';
    expect(isCuid('demo-ab12cd34-file-1')).toBe(true);

    process.env.NODE_ENV = 'production';
    expect(isCuid('demo-ab12cd34-file-1')).toBe(false);

    process.env.NODE_ENV = 'test';
    expect(isCuid('demo-ab12cd34-file-1')).toBe(false);
  });

  it('transform passes the value through for valid ids and 400s otherwise', () => {
    process.env.NODE_ENV = 'development';
    const pipe = new ParseCuidPipe();
    expect(pipe.transform('demo-ab12cd34-p1')).toBe('demo-ab12cd34-p1');

    process.env.NODE_ENV = 'production';
    expect(() => pipe.transform('demo-ab12cd34-p1')).toThrow(BadRequestException);
    expect(pipe.transform('cmpz4vjqd0000ol7p9t6ofk10')).toBe(
      'cmpz4vjqd0000ol7p9t6ofk10'
    );
  });
});
