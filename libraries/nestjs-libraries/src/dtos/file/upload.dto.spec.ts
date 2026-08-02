import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UploadSimpleBodyDto } from './upload.simple.dto';
import { UploadServerBodyDto } from './upload.server.dto';

/**
 * Multipart bodies are strings-only, so a client with no folder selected can
 * post the literal "undefined" (Uppy's XHRUpload appends meta fields verbatim).
 * That string passes @IsString() and then silently misses the folder lookup —
 * which also defeats per-folder storage-provider routing.
 */
describe.each([
  ['UploadSimpleBodyDto', UploadSimpleBodyDto],
  ['UploadServerBodyDto', UploadServerBodyDto],
])('%s folderId normalization', (_name, Dto) => {
  const transform = (folderId: unknown) =>
    plainToInstance(Dto as never, { folderId }) as { folderId?: string };

  it.each(['', 'undefined', 'null'])('maps %o to undefined', (input) => {
    expect(transform(input).folderId).toBeUndefined();
  });

  it('preserves a real folder id', () => {
    const dto = transform('4a1c9f2e-0000-4000-8000-000000000000');
    expect(dto.folderId).toBe('4a1c9f2e-0000-4000-8000-000000000000');
    expect(validateSync(dto as object)).toHaveLength(0);
  });

  it('passes validation when folderId is absent', () => {
    const dto = plainToInstance(Dto as never, {});
    expect(validateSync(dto as object)).toHaveLength(0);
  });
});

describe('UploadSimpleBodyDto preventSave', () => {
  // Guards the sibling @Transform on the same DTO against collateral damage.
  it('coerces the multipart string "true"', () => {
    const dto = plainToInstance(UploadSimpleBodyDto, { preventSave: 'true' });
    expect(dto.preventSave).toBe(true);
  });

  it('coerces any other multipart string to false', () => {
    const dto = plainToInstance(UploadSimpleBodyDto, { preventSave: 'no' });
    expect(dto.preventSave).toBe(false);
  });
});
