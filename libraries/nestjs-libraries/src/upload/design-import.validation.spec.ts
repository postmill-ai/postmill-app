import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { zipSync, strToU8 } from 'fflate';
import {
  DESIGN_IMPORT_MAX_BYTES,
  DesignImportValidationPipe,
} from './design-import.validation';

const pipe = new DesignImportValidationPipe();

const zipBuffer = () =>
  Buffer.from(zipSync({ 'manifest.json': strToU8('{}') }));

const multerFile = (over: Record<string, unknown> = {}) => ({
  fieldname: 'file',
  originalname: 'design.pdesign',
  buffer: zipBuffer(),
  size: 100,
  ...over,
});

describe('DesignImportValidationPipe', () => {
  it('accepts a zip (sniffed from magic bytes) and tags it pdesign', async () => {
    const file = multerFile({ originalname: 'no-extension-at-all' });
    const out = await pipe.transform(file);
    expect(out).toBe(file);
    expect(out.designImportKind).toBe('pdesign');
    // Unlike CustomFileValidationPipe, the original name is never rewritten.
    expect(out.originalname).toBe('no-extension-at-all');
  });

  it('accepts a .json filename without zip magic and tags it json', async () => {
    const out = await pipe.transform(
      multerFile({ originalname: 'doc.JSON', buffer: Buffer.from('{"version":8}') })
    );
    expect(out.designImportKind).toBe('json');
  });

  it('rejects non-zip bytes without a .json name', async () => {
    await expect(
      pipe.transform(multerFile({ originalname: 'x.png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }))
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects garbage even with a .pdesign name (no magic bytes)', async () => {
    await expect(
      pipe.transform(multerFile({ buffer: Buffer.from('not a zip at all') }))
    ).rejects.toThrow(/Unsupported file type/);
  });

  it('rejects files over the 1 GB cap', async () => {
    await expect(
      pipe.transform(multerFile({ size: DESIGN_IMPORT_MAX_BYTES + 1 }))
    ).rejects.toThrow(/too large/);
  });

  it('sniffs from the disk path when there is no memory buffer', async () => {
    const { promises: fsp } = await import('fs');
    const { join } = await import('path');
    const { tmpdir } = await import('os');
    const tmp = join(tmpdir(), `pdesign-pipe-${Date.now()}.bin`);
    await fsp.writeFile(tmp, zipBuffer());
    try {
      const out = await pipe.transform(
        multerFile({ buffer: undefined, path: tmp, originalname: 'x.pdesign' })
      );
      expect(out.designImportKind).toBe('pdesign');
    } finally {
      await fsp.unlink(tmp).catch(() => {});
    }
  });

  it('rejects a missing file', async () => {
    await expect(pipe.transform(undefined)).rejects.toThrow(BadRequestException);
    await expect(pipe.transform({ some: 'param' })).rejects.toThrow(BadRequestException);
  });
});
