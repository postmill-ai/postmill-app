import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReadStream, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { strFromU8, strToU8, unzipSync } from 'fflate';
import { zipBulkEntriesToFile } from './design-bulk-zip';

const directories: string[] = [];
const temporaryDirectory = () => {
  const directory = mkdtempSync(join(tmpdir(), 'bulk-zip-'));
  directories.push(directory);
  return directory;
};

afterEach(() => {
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true });
});

describe('zipBulkEntriesToFile', () => {
  it('streams stored entries and inline metadata into a valid ZIP', async () => {
    const directory = temporaryDirectory();
    const sourcePath = join(directory, 'row.pdesign');
    const destination = join(directory, 'batch.zip');
    const source = Buffer.from(Array.from({ length: 65_536 }, (_, index) => index % 251));
    writeFileSync(sourcePath, source);
    const resultData = strToU8(JSON.stringify([{ row: 1, designId: 'design-1' }]));
    const readStoredFile = vi.fn(async (path: string) => createReadStream(path));

    const size = await zipBulkEntriesToFile([
      { name: 'results.json', size: resultData.byteLength, source: 'inline', data: resultData, compress: true },
      { name: 'editable/row-001.pdesign', size: source.length, source: 'stored', path: sourcePath, compress: false },
    ], destination, readStoredFile);

    expect(readStoredFile).toHaveBeenCalledWith(sourcePath);
    expect(size).toBe(statSync(destination).size);
    const entries = unzipSync(readFileSync(destination));
    expect(JSON.parse(strFromU8(entries['results.json']))).toEqual([{ row: 1, designId: 'design-1' }]);
    expect(Buffer.from(entries['editable/row-001.pdesign'])).toEqual(source);
  });

  it('propagates a stored-entry read failure', async () => {
    const directory = temporaryDirectory();
    const destination = join(directory, 'batch.zip');

    await expect(zipBulkEntriesToFile([
      { name: 'editable/missing.pdesign', size: 100, source: 'stored', path: 'missing', compress: false },
    ], destination, async () => {
      throw new Error('Storage read failed');
    })).rejects.toThrow('Storage read failed');
  });
});
