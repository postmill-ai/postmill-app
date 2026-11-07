import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';

const send = vi.fn();
const remote = new Map<string, Buffer>();
let putCount = 0;

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = send;
  },
  GetObjectCommand: class {
    constructor(public config: any) {}
  },
  HeadObjectCommand: class {
    constructor(public config: any) {}
  },
  ListObjectsV2Command: class {
    constructor(public config: any) {}
  },
  PutObjectCommand: class {
    constructor(public config: any) {}
  },
}));

import { StorageMigration } from './storage-migration';

const ENV_KEYS = [
  'UPLOAD_DIRECTORY',
  'STORAGE_MIGRATION_DIRECTORY',
  'STORAGE_PROVIDER',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_BUCKET',
  'S3_REGION',
  'S3_ENDPOINT',
  'S3_PUBLIC_URL',
];
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

describe('StorageMigration', () => {
  let root: string;
  let manifestDirectory: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'storage-source-'));
    manifestDirectory = mkdtempSync(join(tmpdir(), 'storage-manifest-'));
    remote.clear();
    putCount = 0;
    Object.assign(process.env, {
      UPLOAD_DIRECTORY: root,
      STORAGE_MIGRATION_DIRECTORY: manifestDirectory,
      STORAGE_PROVIDER: 'local',
      S3_ACCESS_KEY_ID: 'access',
      S3_SECRET_ACCESS_KEY: 'secret',
      S3_BUCKET: 'postmill-test',
      S3_REGION: 'fsn1',
      S3_ENDPOINT: 'https://fsn1.your-objectstorage.com',
      S3_PUBLIC_URL: 'https://postmill-test.fsn1.your-objectstorage.com',
    });

    send.mockImplementation(async (command: any) => {
      const { Bucket: _bucket, Key: key } = command.config;
      switch (command.constructor.name) {
        case 'HeadObjectCommand': {
          const body = remote.get(key);
          if (!body) throw Object.assign(new Error('Not found'), { name: 'NotFound' });
          return { ContentLength: body.length };
        }
        case 'GetObjectCommand': {
          const body = remote.get(key);
          if (!body) throw Object.assign(new Error('Not found'), { name: 'NoSuchKey' });
          return { Body: Readable.from([body]) };
        }
        case 'PutObjectCommand': {
          const chunks: Buffer[] = [];
          for await (const chunk of command.config.Body) chunks.push(Buffer.from(chunk));
          remote.set(key, Buffer.concat(chunks));
          putCount++;
          return {};
        }
        case 'ListObjectsV2Command': {
          const all = [...remote.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([Key, body]) => ({ Key, Size: body.length }));
          const offset = command.config.ContinuationToken
            ? Number(command.config.ContinuationToken)
            : 0;
          const page = all.slice(offset, offset + 2);
          const next = offset + page.length;
          return {
            Contents: page,
            NextContinuationToken: next < all.length ? String(next) : undefined,
          };
        }
        default:
          throw new Error(`Unexpected command: ${command.constructor.name}`);
      }
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    for (const key of ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
    rmSync(manifestDirectory, { recursive: true, force: true });
  });

  const sourceFile = (key: string, contents: string) => {
    const path = join(root, key);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, contents);
    return path;
  };

  it('inventories regular files and skips symlinks without writing objects', async () => {
    const file = sourceFile('org-1/2026/11/07/image.png', 'image');
    symlinkSync(file, join(root, 'org-1/2026/11/07/link.png'));

    const result = await new StorageMigration().run('inventory');

    expect(result).toEqual({
      files: 1,
      bytes: 5,
      skipped: ['org-1/2026/11/07/link.png'],
    });
    expect(remote.size).toBe(0);
  });

  it('copies identical keys, resumes without duplicate puts, and never deletes sources', async () => {
    const first = sourceFile('org-1/a/image.png', 'first');
    const second = sourceFile('org-2/b/video.mp4', 'second');
    const task = new StorageMigration();

    await expect(task.run('copy')).resolves.toEqual({
      copied: 2,
      adopted: 0,
      skipped: 0,
      bytes: 11,
    });
    expect(remote.get('org-1/a/image.png')?.toString()).toBe('first');
    expect(remote.get('org-2/b/video.mp4')?.toString()).toBe('second');
    expect(putCount).toBe(2);
    expect(existsSync(join(manifestDirectory, 'manifest.json'))).toBe(true);

    await expect(task.run('copy')).resolves.toMatchObject({ copied: 0, skipped: 2 });
    expect(putCount).toBe(2);
    expect(readFileSync(first, 'utf8')).toBe('first');
    expect(readFileSync(second, 'utf8')).toBe('second');
  });

  it('adopts an identical existing object but refuses to overwrite a different one', async () => {
    sourceFile('org-1/image.png', 'local');
    remote.set('org-1/image.png', Buffer.from('local'));

    await expect(new StorageMigration().run('copy')).resolves.toMatchObject({
      adopted: 1,
      copied: 0,
    });
    expect(putCount).toBe(0);

    rmSync(join(manifestDirectory, 'manifest.json'));
    remote.set('org-1/image.png', Buffer.from('remote'));
    await expect(new StorageMigration().run('copy')).rejects.toThrow(
      'Destination contains a different object: org-1/image.png',
    );
    expect(remote.get('org-1/image.png')?.toString()).toBe('remote');
  });

  it('verifies hashes across paginated listings and reports unexpected objects', async () => {
    sourceFile('org-1/a.png', 'a');
    sourceFile('org-1/b.png', 'b');
    sourceFile('org-2/c.png', 'c');
    await new StorageMigration().run('copy');
    remote.set('qa/unexpected.png', Buffer.from('qa'));

    const result = await new StorageMigration().run('verify');

    expect(result).toEqual({
      verified: 3,
      bytes: 3,
      unexpected: ['qa/unexpected.png'],
    });
  });

  it('fails verification for a corrupt destination object', async () => {
    sourceFile('org-1/image.png', 'expected');
    await new StorageMigration().run('copy');
    remote.set('org-1/image.png', Buffer.from('corrupt'));

    await expect(new StorageMigration().run('verify')).rejects.toThrow(
      'Storage verification failed: missing=0 mismatched=1',
    );
  });

  it('copies missing objects back for rollback without deleting bucket objects', async () => {
    const path = sourceFile('org-1/image.png', 'rollback');
    await new StorageMigration().run('copy');
    unlinkSync(path);

    await expect(new StorageMigration().run('copy-back')).resolves.toEqual({
      copied: 1,
      skipped: 0,
      bytes: 8,
    });

    expect(readFileSync(path, 'utf8')).toBe('rollback');
    expect(remote.get('org-1/image.png')?.toString()).toBe('rollback');
  });

  it('rejects an unsupported mode', async () => {
    await expect(new StorageMigration().run('delete' as any)).rejects.toThrow(
      'Mode must be inventory, copy, verify, or copy-back.',
    );
  });
});
