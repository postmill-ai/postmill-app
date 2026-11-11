import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { Readable } from 'stream';
import { createHash } from 'crypto';
import { strFromU8, unzipSync } from 'fflate';
import {
  ORG_PORTABILITY_MAX_ARCHIVE_BYTES,
  orgPortabilityMaxArchiveBytes,
} from './org-portability.types';
import {
  createOrgArchiveKey,
  decryptOrgSecretRefs,
  unwrapOrgArchiveKey,
  wrapOrgArchiveKey,
} from './org-portability.crypto';

const redis = new Map<string, string>();
vi.mock('@postmill-ai/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    set: vi.fn(async (key: string, value: string) => {
      redis.set(key, value);
      return 'OK';
    }),
    getdel: vi.fn(async (key: string) => {
      const value = redis.get(key) ?? null;
      redis.delete(key);
      return value;
    }),
  },
}));
vi.mock('@postmill-ai/nestjs-libraries/inngest/inngest.client', () => ({
  inngest: { send: vi.fn() },
  isInngestEnabled: () => false,
}));

import { OrgPortabilityService } from './org-portability.service';

const dirs: string[] = [];
const previousSpool = process.env.ORG_PORTABILITY_SPOOL_DIR;
const passphrase = 'service test passphrase';

const makeService = () => {
  const archiveKey = createOrgArchiveKey();
  const job: any = {
    id: 'job-1',
    organizationId: 'org-1',
    ownerId: 'owner-1',
    kind: 'export',
    status: 'processing',
    progress: { keyWrap: wrapOrgArchiveKey(archiveKey, passphrase) },
    archiveKeyCiphertext: archiveKey.toString('base64'),
    archiveSha256: null,
    spoolPath: null,
    expiresAt: new Date(Date.now() + 60_000),
    error: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const fileRows = [1, 2].map((number) => ({
    id: `file-${number}`,
    organizationId: 'org-1',
    type: 'image',
    path: `https://cdn.example.test/shared.png?signature=secret-${number}`,
    fileSize: 11,
    folderId: null,
    metadata: { mime: 'image/png' },
  }));
  const repository = {
    isOwner: vi.fn(async () => true),
    createExportJob: vi.fn(),
    getOwnedJob: vi.fn(async () => job),
    listOwnedJobs: vi.fn(async () => [job]),
    claimExportJob: vi.fn(async () => ({ count: 1 })),
    getJob: vi.fn(async () => job),
    completeExportJob: vi.fn(async (_id: string, update: any) => {
      Object.assign(job, update, { status: 'completed', archiveKeyCiphertext: null });
      return job;
    }),
    failExportJob: vi.fn(async (_id: string, error: string) => {
      Object.assign(job, { status: 'failed', error, archiveKeyCiphertext: null });
      return { count: 1 };
    }),
    expireJobs: vi.fn(async () => []),
    organization: vi.fn(async () => ({ id: 'org-1', name: 'Example Org', description: null })),
    members: vi.fn(async () => []),
    customRoles: vi.fn(async () => []),
    modelBatch: vi.fn(async (model: string) => {
      if (model === 'integration') return [{
        id: 'integration-1',
        organizationId: 'org-1',
        name: 'Instagram',
        token: 'v2:encrypted-provider-token',
        refreshToken: 'legacy-plaintext-refresh-token',
      }];
      if (model === 'file') return fileRows;
      return [];
    }),
    relatedBatch: vi.fn(async () => []),
    integrationWebhookPairs: vi.fn(async () => [{ integrationId: 'integration-1', webhookId: 'webhook-1' }]),
    files: vi.fn(async () => fileRows),
    brandFonts: vi.fn(async () => []),
  };
  const adapter = {
    readFileStream: vi.fn(async () => Readable.from([Buffer.from('hello '), Buffer.from('world')])),
  };
  const storageService = {
    resolveAdapterForFolder: vi.fn(async () => adapter),
    getLocalAdapterForOrg: vi.fn(async () => adapter),
  };
  const encryption = {
    encrypt: vi.fn((value: string) => value),
    decrypt: vi.fn((value: string) => value === 'v2:encrypted-provider-token' ? 'plain-provider-token' : value),
  };
  const audit = { record: vi.fn(async () => undefined) };
  const service = new OrgPortabilityService(
    repository as any,
    storageService as any,
    encryption as any,
    audit as any,
  );
  return { service, repository, adapter, job };
};

beforeEach(() => {
  redis.clear();
  const dir = mkdtempSync(path.join(tmpdir(), 'org-export-service-'));
  dirs.push(dir);
  process.env.ORG_PORTABILITY_SPOOL_DIR = dir;
});

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  if (previousSpool === undefined) delete process.env.ORG_PORTABILITY_SPOOL_DIR;
  else process.env.ORG_PORTABILITY_SPOOL_DIR = previousSpool;
  vi.clearAllMocks();
});

describe('OrgPortabilityService export', () => {
  it('writes a sanitized encrypted archive with deduplicated assets and one-time downloads', async () => {
    const { service, repository, adapter, job } = makeService();
    await service.processExport(job.id);

    expect(repository.completeExportJob).toHaveBeenCalled();
    const entries = unzipSync(readFileSync(job.spoolPath));
    const manifest = JSON.parse(strFromU8(entries['manifest.json']));
    expect(manifest.schema).toBe('postmill.org-export.v1.1');
    expect(manifest.counts.Integration).toBe(1);
    expect(manifest.counts.integrationWebhooks).toBe(1);
    expect(manifest.counts.File).toBe(2);
    expect(manifest.counts.assets).toBe(1);
    expect(Object.keys(entries).filter((name) => name.startsWith('assets/'))).toHaveLength(1);
    expect(statSync(job.spoolPath).mode & 0o777).toBe(0o600);

    const integration = strFromU8(entries['domains/Integration.ndjson']);
    expect(manifest.domains.Integration).toBe(createHash('sha256').update(integration).digest('hex'));
    expect(integration).toContain('"token":null');
    expect(integration).not.toContain('plain-provider-token');
    expect(strFromU8(entries['domains/File.ndjson'])).not.toContain('signature=secret');
    const archiveKey = unwrapOrgArchiveKey(manifest.crypto, passphrase);
    expect(decryptOrgSecretRefs(manifest.crypto.secrets, archiveKey)).toEqual([{
      model: 'Integration',
      id: 'integration-1',
      field: 'token',
      value: 'plain-provider-token',
    }, {
      model: 'Integration',
      id: 'integration-1',
      field: 'refreshToken',
      value: 'legacy-plaintext-refresh-token',
    }]);
    expect(strFromU8(entries['domains/Integration.ndjson'])).not.toContain('legacy-plaintext-refresh-token');

    const download = await service.issueDownload('org-1', 'owner-1', job.id);
    const token = download.url.split('/').pop()!;
    expect((await service.consumeDownload(token)).id).toBe(job.id);
    await expect(service.consumeDownload(token)).rejects.toThrow('expired or already used');
    expect(adapter.readFileStream).toHaveBeenCalledTimes(2);
  });

  it('inventories custom brand fonts through base storage with path sanitization and deduplication', async () => {
    const { service, repository, adapter, job } = makeService();
    repository.brandFonts.mockResolvedValue([{
      id: 'brand-1',
      customFonts: [{
        fileId: 'font-upload-1',
        family: 'Custom Font',
        path: 'https://cdn.example.test/custom.ttf?signature=secret',
      }, {
        fileId: 'metadata-only-font',
        family: 'Metadata Only',
      }, {
        fileId: 'unsupported-font',
        family: 'Unsupported',
        path: '/fonts/legacy.svg',
      }],
    }]);

    await service.processExport(job.id);

    const entries = unzipSync(readFileSync(job.spoolPath));
    const manifest = JSON.parse(strFromU8(entries['manifest.json']));
    expect(manifest.assets['font:brand-1:0']).toMatchObject({
      fileId: 'font:brand-1:0',
      kind: 'font',
      sourcePath: 'https://cdn.example.test/custom.ttf',
      sha256: manifest.assets['file-1'].sha256,
      mime: 'font/ttf',
    });
    expect(manifest.counts.assets).toBe(1);
    expect(adapter.readFileStream).toHaveBeenCalledTimes(3);
    expect(adapter.readFileStream).toHaveBeenLastCalledWith('https://cdn.example.test/custom.ttf?signature=secret');
  });

  it('creates a job with wrapped-key metadata and no plaintext passphrase', async () => {
    const { service, repository, job } = makeService();
    repository.createExportJob.mockImplementation(async (_org, _owner, ciphertext, keyWrap) => {
      Object.assign(job, { archiveKeyCiphertext: ciphertext, progress: { keyWrap } });
      return job;
    });

    const created = await service.createExport('org-1', 'owner-1', passphrase);

    expect(created.status).toBe('completed');
    expect(repository.createExportJob).toHaveBeenCalledWith(
      'org-1', 'owner-1', expect.any(String), expect.any(Object),
    );
    expect(JSON.stringify(job.progress)).not.toContain(passphrase);
  });

  it('rejects non-owners before creating a job', async () => {
    const { service, repository } = makeService();
    repository.isOwner.mockResolvedValue(false);
    await expect(service.createExport('org-1', 'owner-1', passphrase)).rejects.toThrow('Only an organization owner');
    expect(repository.createExportJob).not.toHaveBeenCalled();
  });

  it('tightens a pre-existing permissive spool directory before writing', async () => {
    const { service, job } = makeService();
    chmodSync(process.env.ORG_PORTABILITY_SPOOL_DIR!, 0o755);

    await service.processExport(job.id);

    expect(statSync(process.env.ORG_PORTABILITY_SPOOL_DIR!).mode & 0o777).toBe(0o700);
    expect(statSync(job.spoolPath).mode & 0o777).toBe(0o600);
  });

  it('purges expired private archives', async () => {
    const { service, repository, job } = makeService();
    await service.processExport(job.id);
    repository.expireJobs.mockResolvedValue([job]);

    await expect(service.purgeExpired()).resolves.toBe(1);

    expect(existsSync(job.spoolPath)).toBe(false);
  });

  it('removes partial output and records a sanitized failure', async () => {
    const { service, repository, adapter, job } = makeService();
    adapter.readFileStream.mockRejectedValue(new Error('Cannot read https://cdn.example.test/asset?signature=secret'));
    await service.processExport(job.id);

    expect(repository.failExportJob).toHaveBeenCalledWith(job.id, expect.not.stringContaining('signature=secret'));
    expect(repository.completeExportJob).not.toHaveBeenCalled();
    expect(existsSync(path.join(process.env.ORG_PORTABILITY_SPOOL_DIR!, `${job.id}.zip`))).toBe(false);
  });

  it('marks missing source objects and completes the remaining archive', async () => {
    const { service, repository, adapter, job } = makeService();
    adapter.readFileStream
      .mockResolvedValueOnce(Readable.from([Buffer.from('hello world')]))
      .mockRejectedValueOnce(Object.assign(new Error('No such file'), { code: 'ENOENT' }));

    await service.processExport(job.id);

    expect(repository.failExportJob).not.toHaveBeenCalled();
    expect(repository.completeExportJob).toHaveBeenCalled();
    const entries = unzipSync(readFileSync(job.spoolPath));
    const manifest = JSON.parse(strFromU8(entries['manifest.json']));
    expect(manifest.counts).toMatchObject({ assets: 1, missingAssets: 1 });
    expect(manifest.assets['file-2']).toMatchObject({
      fileId: 'file-2',
      sha256: '',
      size: '11',
      missing: true,
    });
    expect(Object.keys(entries).filter((name) => name.startsWith('assets/'))).toHaveLength(1);
  });

  it('caps archive overrides below the non-ZIP64 boundary', () => {
    const previous = process.env.ORG_PORTABILITY_MAX_ARCHIVE_BYTES;
    try {
      process.env.ORG_PORTABILITY_MAX_ARCHIVE_BYTES = String(ORG_PORTABILITY_MAX_ARCHIVE_BYTES + 1n);
      expect(orgPortabilityMaxArchiveBytes()).toBe(ORG_PORTABILITY_MAX_ARCHIVE_BYTES);
      process.env.ORG_PORTABILITY_MAX_ARCHIVE_BYTES = '1024';
      expect(orgPortabilityMaxArchiveBytes()).toBe(1024n);
    } finally {
      if (previous === undefined) delete process.env.ORG_PORTABILITY_MAX_ARCHIVE_BYTES;
      else process.env.ORG_PORTABILITY_MAX_ARCHIVE_BYTES = previous;
    }
  });
});
