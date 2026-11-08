import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { createHash } from 'crypto';
import { Readable } from 'stream';
import { OrgArchiveWriter } from './org-portability.archive';
import {
  createOrgArchiveKey,
  encryptOrgSecretRefs,
  orgManifestMac,
  wrapOrgArchiveKey,
} from './org-portability.crypto';
import {
  ORG_EXPORT_SCHEMA,
  type OrgPortabilityManifest,
} from './org-portability.types';
import { extractOrgArchive, readOrgDomainRows, validateOrgArchive } from './org-import-archive';

const passphrase = 'import validation passphrase';
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const makeArchive = async (options: {
  schema?: string;
  domainCount?: number;
  tamperAsset?: boolean;
  tamperDomainHash?: boolean;
  unsafeEntry?: boolean;
  duplicateEntry?: boolean;
  missingAsset?: boolean;
  unexpectedAsset?: boolean;
} = {}) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'org-import-validation-'));
  dirs.push(dir);
  const file = path.join(dir, 'export.zip');
  const key = createOrgArchiveKey();
  const keyWrap = wrapOrgArchiveKey(key, passphrase);
  const body = Buffer.from('asset bytes');
  const sha256 = createHash('sha256').update(body).digest('hex');
  const domainBody = Buffer.from('{"id":"org-1"}\n');
  const domainHash = createHash('sha256').update(domainBody).digest('hex');
  const core: Omit<OrgPortabilityManifest, 'integrity'> = {
    schema: (options.schema || ORG_EXPORT_SCHEMA) as typeof ORG_EXPORT_SCHEMA,
    appVersion: 'v1.4.0',
    createdAt: new Date().toISOString(),
    source: { organizationId: 'org-1', name: 'Example' },
    counts: {
      organization: options.domainCount ?? 1,
      assets: options.missingAsset ? 0 : 1,
      ...(options.missingAsset ? { missingAssets: 1 } : {}),
    },
    domains: { organization: options.tamperDomainHash ? domainHash.replace(/^./, '0') : domainHash },
    assets: {
      'file-1': options.missingAsset ? {
        fileId: 'file-1', sha256: '', size: String(body.length), mime: 'application/octet-stream', missing: true,
      } : {
        fileId: 'file-1', sha256, size: String(body.length), mime: 'application/octet-stream',
      },
    },
    crypto: { ...keyWrap, secrets: encryptOrgSecretRefs([], key) },
  };
  const writer = await OrgArchiveWriter.create(file);
  await writer.addNdjson('domains/organization.ndjson', (async function* () {
    yield { id: 'org-1' };
  })());
  if (!options.missingAsset) {
    await writer.addAsset(`assets/${sha256}`, Readable.from([options.tamperAsset ? Buffer.from('xxxxxxxxxxx') : body]), () => undefined);
  }
  if (options.unexpectedAsset) {
    const extra = createHash('sha256').update('extra').digest('hex');
    await writer.addAsset(`assets/${extra}`, Readable.from(['extra']), () => undefined);
  }
  await writer.addJson('manifest.json', {
    ...core,
    integrity: { algorithm: 'hmac-sha256', mac: orgManifestMac(core, key) },
  });
  if (options.unsafeEntry) await writer.addJson('../escape.json', {});
  if (options.duplicateEntry) await writer.addJson('domains/organization.ndjson', { duplicate: true });
  await writer.finish();
  key.fill(0);
  return file;
};

describe('validateOrgArchive', () => {
  it('validates streaming domains and asset hashes with the passphrase', async () => {
    const file = await makeArchive();
    const result = await validateOrgArchive(file, passphrase);
    expect(result.manifest.schema).toBe(ORG_EXPORT_SCHEMA);
    expect(result.domainCounts).toEqual({ organization: 1 });
    expect(readFileSync(file).length).toBeGreaterThan(0);
  });

  it('rejects a wrong passphrase, asset tampering and domain tampering', async () => {
    expect(await validateOrgArchive(await makeArchive(), 'wrong passphrase').catch((error) => error.message))
      .toContain('passphrase is incorrect');
    expect(await validateOrgArchive(await makeArchive({ tamperAsset: true }), passphrase).catch((error) => error.message))
      .toContain('hash');
    expect(await validateOrgArchive(await makeArchive({ tamperDomainHash: true }), passphrase).catch((error) => error.message))
      .toContain('domain organization hash');
  });

  it('rejects unsafe paths and duplicate entries', async () => {
    expect(await validateOrgArchive(await makeArchive({ unsafeEntry: true }), passphrase).catch((error) => error.message))
      .toContain('unsafe entry path');
    expect(await validateOrgArchive(await makeArchive({ duplicateEntry: true }), passphrase).catch((error) => error.message))
      .toContain('duplicate entry');
  });

  it('rejects unsupported versions, domain count mismatches and unexpected assets', async () => {
    expect(await validateOrgArchive(await makeArchive({ schema: 'postmill.org-export.v2' }), passphrase).catch((error) => error.message))
      .toContain('not supported');
    expect(await validateOrgArchive(await makeArchive({ domainCount: 2 }), passphrase).catch((error) => error.message))
      .toContain('count does not match');
    expect(await validateOrgArchive(await makeArchive({ unexpectedAsset: true }), passphrase).catch((error) => error.message))
      .toContain('unexpected asset');
  });

  it('accepts explicitly missing source objects and extracts an archive only once', async () => {
    const file = await makeArchive({ missingAsset: true });
    const result = await validateOrgArchive(file, passphrase);
    expect(result.manifest.assets['file-1'].missing).toBe(true);
    const extraction = await extractOrgArchive(file, path.dirname(file));
    try {
      expect(extraction.manifest.source.organizationId).toBe('org-1');
      expect(await readOrgDomainRows(extraction, 'organization')).toEqual([{ id: 'org-1' }]);
      expect(Object.keys(extraction.assetPaths)).toHaveLength(0);
    } finally {
      rmSync(extraction.directory, { recursive: true, force: true });
    }
  });
});
