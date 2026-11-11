import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { LocalStorage } from '../storage.adapter';

const dirs: string[] = [];
const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('LocalStorage.uploadFile', () => {
  it('stores real CSV bytes with the detected text MIME and extension', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'local-storage-text-'));
    dirs.push(root);
    const bytes = Buffer.from('name,price\nCoffee,12\n', 'utf8');
    const adapter = new LocalStorage(logger, root, 'org-1');

    const result = await adapter.uploadFile({
      buffer: bytes,
      originalname: 'products.csv',
      size: bytes.length,
    });

    expect(result.mimetype).toBe('text/csv');
    expect(result.filename).toMatch(/\.csv$/);
    expect(readFileSync(result.path.replace(/^.*\/uploads\//, root + '/'))).toEqual(bytes);
  });
});

describe('LocalStorage.writeFileStream', () => {
  it('stores ZIP and JSON artifacts without using the image/video upload path', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'local-storage-stream-'));
    dirs.push(root);
    const source = path.join(root, 'design.pdesign');
    writeFileSync(source, Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]));
    const adapter = new LocalStorage(logger, root, 'org-1');
    const stored = await adapter.writeFileStream(source, 'application/zip');
    expect(stored).toContain('/uploads/org-1/');
    expect(readFileSync(stored.replace(/^.*\/uploads\//, root + '/')).subarray(0, 4))
      .toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));

    const json = path.join(root, 'results.json');
    writeFileSync(json, '{"ok":true}');
    const jsonUrl = await adapter.writeFileStream(json, 'application/json');
    expect(jsonUrl).toMatch(/\.json$/);
  });

  it('stores font artifacts with their original extension', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'local-storage-stream-'));
    dirs.push(root);
    const source = path.join(root, 'brand-font.ttf');
    const bytes = Buffer.from('portable font bytes');
    writeFileSync(source, bytes);
    const adapter = new LocalStorage(logger, root, 'org-1');

    const stored = await adapter.writeFileStream(source, 'font/ttf');

    expect(stored).toMatch(/\.ttf$/);
    expect(readFileSync(stored.replace(/^.*\/uploads\//, root + '/'))).toEqual(bytes);
  });

  it('rejects active HTML artifacts', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'local-storage-stream-'));
    dirs.push(root);
    const source = path.join(root, 'payload.html');
    writeFileSync(source, '<script>alert(1)</script>');
    const adapter = new LocalStorage(logger, root, 'org-1');
    await expect(adapter.writeFileStream(source, 'text/html')).rejects.toThrow('Unsupported stored artifact type');
  });
});
