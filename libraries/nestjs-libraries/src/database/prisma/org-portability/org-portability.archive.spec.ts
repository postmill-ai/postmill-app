import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { Readable } from 'stream';
import { strFromU8, unzipSync } from 'fflate';
import { OrgArchiveWriter } from './org-portability.archive';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('OrgArchiveWriter', () => {
  it('streams metadata and assets into a readable private ZIP', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'org-archive-'));
    dirs.push(dir);
    const file = path.join(dir, 'export.zip');
    const writer = await OrgArchiveWriter.create(file);
    await writer.addNdjson('domains/files.ndjson', (async function* () {
      yield { id: 'file-1' };
      yield { id: 'file-2' };
    })());
    await writer.addAsset('assets/abc', Readable.from([Buffer.from('hello '), Buffer.from('world')]), () => undefined);
    await writer.addJson('manifest.json', { schema: 'postmill.org-export.v1' });
    await writer.finish();

    const entries = unzipSync(readFileSync(file));
    expect(strFromU8(entries['domains/files.ndjson'])).toBe('{"id":"file-1"}\n{"id":"file-2"}\n');
    expect(strFromU8(entries['assets/abc'])).toBe('hello world');
    expect(JSON.parse(strFromU8(entries['manifest.json'])).schema).toBe('postmill.org-export.v1');
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});
