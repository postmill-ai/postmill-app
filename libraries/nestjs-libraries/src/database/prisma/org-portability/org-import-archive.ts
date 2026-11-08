import { BadRequestException } from '@nestjs/common';
import { createReadStream, createWriteStream, mkdirSync, mkdtempSync, rmSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { once } from 'events';
import path from 'path';
import { tmpdir } from 'os';
import { createInterface } from 'readline';
import { UnzipInflate, Unzip } from 'fflate';
import {
  ORG_EXPORT_SCHEMA,
  orgPortabilityMaxArchiveBytes,
  orgPortabilityMaxAssetBytes,
  type OrgPortabilityManifest,
} from './org-portability.types';
import { orgPortabilityDomainNames } from './org-portability.domains';
import { unwrapOrgArchiveKey, verifyOrgManifestMac } from './org-portability.crypto';

const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_DOMAIN_BYTES = 64 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 65_000;
const invalid = (message: string): never => {
  throw new BadRequestException(message);
};

const entryKind = (name: string): 'manifest' | 'domain' | 'asset' => {
  if (!name || name.includes('\0') || name.includes('\\') || name.startsWith('/') || /^[a-z]:/i.test(name)) {
    return invalid('Archive contains an unsafe entry path.');
  }
  const segments = name.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    return invalid('Archive contains an unsafe entry path.');
  }
  if (name === 'manifest.json') return 'manifest';
  if (/^domains\/[^/]+\.ndjson$/.test(name)) return 'domain';
  if (/^assets\/[a-f0-9]{64}$/.test(name)) return 'asset';
  return invalid('Archive contains an unsupported entry.');
};

const domainName = (entry: string): string => entry.slice('domains/'.length, -'.ndjson'.length);
const assetName = (entry: string): string => entry.slice('assets/'.length);
const checkEntrySize = (kind: string, size: bigint): void => {
  if (size > orgPortabilityMaxAssetBytes()) invalid('Archive entry exceeds the per-asset limit.');
  if (kind === 'manifest' && size > MAX_MANIFEST_BYTES) invalid('Archive manifest is too large.');
  if (kind === 'domain' && size > MAX_DOMAIN_BYTES) invalid('Archive domain payload is too large.');
};

export interface OrgArchiveValidation {
  manifest: OrgPortabilityManifest;
  domainCounts: Record<string, number>;
}

export interface OrgArchiveExtraction {
  directory: string;
  domainPaths: Record<string, string>;
  assetPaths: Record<string, string>;
  manifest: OrgPortabilityManifest;
}

export async function validateOrgArchive(
  archivePath: string,
  passphrase: string,
): Promise<OrgArchiveValidation> {
  if (BigInt(statSync(archivePath).size) > orgPortabilityMaxArchiveBytes()) {
    return invalid('Archive exceeds the import size limit.');
  }
  const names = new Set<string>();
  const domainCounts: Record<string, number> = {};
  const domainHashes: Record<string, string> = {};
  const assetInfo: Record<string, { sha256: string; size: bigint }> = {};
  let manifestText = '';
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (file) => {
    const kind = entryKind(file.name);
    if (names.has(file.name)) invalid('Archive contains a duplicate entry.');
    names.add(file.name);
    if (names.size > MAX_ARCHIVE_ENTRIES) invalid('Archive contains too many entries.');
    checkEntrySize(kind, BigInt(file.originalSize || 0));
    const hash = createHash('sha256');
    const manifestChunks: Uint8Array[] = [];
    const decoder = kind === 'domain' ? new TextDecoder() : undefined;
    const domain = kind === 'domain' ? domainName(file.name) : '';
    if (domain && !orgPortabilityDomainNames().includes(domain)) {
      invalid(`Archive domain ${domain} is not supported.`);
    }
    let pending = '';
    let count = 0;
    let size = 0n;
    const consumeLine = (line: string) => {
      if (!line) return;
      try {
        const row = JSON.parse(line);
        if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('not an object');
      } catch {
        invalid(`Archive domain ${domain} is not valid NDJSON.`);
      }
      count++;
    };
    file.ondata = (error, chunk, final) => {
      if (error) invalid('Archive is damaged or truncated.');
      size += BigInt(chunk.length);
      checkEntrySize(kind, size);
      hash.update(chunk);
      if (kind === 'manifest') manifestChunks.push(chunk);
      if (decoder) {
        pending += decoder.decode(chunk, { stream: !final });
        const lines = pending.split('\n');
        pending = lines.pop() || '';
        for (const line of lines) consumeLine(line);
        if (final) consumeLine(pending);
      }
      if (final) {
        const sha256 = hash.digest('hex');
        if (kind === 'asset') assetInfo[assetName(file.name)] = { sha256, size };
        if (kind === 'domain') {
          domainCounts[domain] = count;
          domainHashes[domain] = sha256;
        }
        if (kind === 'manifest') manifestText = Buffer.concat(manifestChunks.map((part) => Buffer.from(part))).toString('utf8');
      }
    };
    file.start();
  };

  for await (const chunk of createReadStream(archivePath)) unzip.push(chunk, false);
  unzip.push(new Uint8Array(), true);
  if (!manifestText) invalid('Archive manifest is missing.');
  let manifest: OrgPortabilityManifest;
  try {
    manifest = JSON.parse(manifestText) as OrgPortabilityManifest;
  } catch {
    return invalid('Archive manifest is not valid JSON.');
  }
  if (manifest.schema !== ORG_EXPORT_SCHEMA) invalid('Archive format is not supported.');
  if (!manifest.crypto || !manifest.integrity || !manifest.assets || !manifest.counts || !manifest.domains) {
    invalid('Archive manifest is incomplete.');
  }
  let archiveKey: Buffer;
  try {
    archiveKey = unwrapOrgArchiveKey(manifest.crypto, passphrase);
  } catch {
    return invalid('Archive passphrase is incorrect or the archive is damaged.');
  }
  try {
    if (!verifyOrgManifestMac(manifest, archiveKey)) invalid('Archive integrity verification failed.');

    const expectedDomains = Object.keys(manifest.domains).sort();
    const actualDomains = Object.keys(domainHashes).sort();
    if (JSON.stringify(expectedDomains) !== JSON.stringify(actualDomains)) {
      invalid('Archive domain inventory does not match its manifest.');
    }
    for (const domain of expectedDomains) {
      if (!orgPortabilityDomainNames().includes(domain)) invalid(`Archive domain ${domain} is not supported.`);
      if (manifest.domains[domain] !== domainHashes[domain]) {
        invalid(`Archive domain ${domain} hash does not match its manifest.`);
      }
      if (manifest.counts[domain] !== domainCounts[domain]) {
        invalid(`Archive domain ${domain} count does not match its manifest.`);
      }
    }
    for (const domain of Object.keys(manifest.counts)) {
      if (domain !== 'assets' && domain !== 'missingAssets' && !manifest.domains[domain]) {
        invalid('Archive domain counts do not match its manifest.');
      }
    }

    const expectedAssets = new Set<string>();
    let missingAssets = 0;
    for (const [fileId, asset] of Object.entries(manifest.assets)) {
      if (!asset || asset.fileId !== fileId) invalid('Archive asset metadata is inconsistent.');
      if (asset.missing) {
        if (asset.sha256 !== '') invalid('A missing archive asset cannot reference asset bytes.');
        missingAssets++;
        continue;
      }
      if (!/^[a-f0-9]{64}$/.test(asset.sha256)) invalid('Archive asset hash is invalid.');
      const actual = assetInfo[asset.sha256];
      if (!actual || actual.size !== BigInt(asset.size) || actual.sha256 !== asset.sha256) {
        return invalid('Archive asset is missing or has a different size or hash.');
      }
      expectedAssets.add(asset.sha256);
    }
    if (Object.keys(assetInfo).length !== expectedAssets.size) {
      invalid('Archive contains an unexpected asset.');
    }
    if (manifest.counts.assets !== expectedAssets.size || (manifest.counts.missingAssets || 0) !== missingAssets) {
      invalid('Archive asset counts do not match its manifest.');
    }
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    return invalid('Archive metadata is invalid.');
  } finally {
    archiveKey.fill(0);
  }
  return { manifest, domainCounts };
}

export async function extractOrgArchive(
  archivePath: string,
  spoolRoot = path.join(tmpdir(), 'postmill-org-archives'),
): Promise<OrgArchiveExtraction> {
  mkdirSync(spoolRoot, { recursive: true, mode: 0o700 });
  const directory = mkdtempSync(path.join(spoolRoot, 'import-'));
  mkdirSync(path.join(directory, 'domains'), { mode: 0o700 });
  mkdirSync(path.join(directory, 'assets'), { mode: 0o700 });
  const domainPaths: Record<string, string> = {};
  const assetPaths: Record<string, string> = {};
  const pending: Promise<unknown>[] = [];
  const names = new Set<string>();
  const manifestChunks: Uint8Array[] = [];
  let manifestSize = 0n;
  let failure: unknown;
  try {
    const unzip = new Unzip();
    unzip.register(UnzipInflate);
    unzip.onfile = (file) => {
      const kind = entryKind(file.name);
      if (names.has(file.name)) invalid('Archive contains a duplicate entry.');
      names.add(file.name);
      if (kind === 'manifest') {
        file.ondata = (error, chunk) => {
          if (error) failure = error;
          manifestSize += BigInt(chunk.length);
          checkEntrySize(kind, manifestSize);
          manifestChunks.push(chunk);
        };
        file.start();
        return;
      }
      const name = kind === 'domain' ? domainName(file.name) : assetName(file.name);
      const outputPath = path.join(directory, kind === 'domain' ? 'domains' : 'assets', `${name}${kind === 'domain' ? '.ndjson' : ''}`);
      if (kind === 'domain') domainPaths[name] = outputPath;
      else assetPaths[name] = outputPath;
      const output = createWriteStream(outputPath, { flags: 'wx', mode: 0o600 });
      pending.push(once(output, 'close'));
      let size = 0n;
      file.ondata = (error, chunk, final) => {
        if (error) {
          failure = error;
          output.destroy();
          return;
        }
        size += BigInt(chunk.length);
        checkEntrySize(kind, size);
        output.write(Buffer.from(chunk));
        if (final) output.end();
      };
      file.start();
    };
    for await (const chunk of createReadStream(archivePath)) unzip.push(chunk, false);
    unzip.push(new Uint8Array(), true);
    await Promise.all(pending);
    if (failure) throw failure;
    if (!manifestChunks.length) invalid('Archive manifest is missing.');
    const manifest = JSON.parse(Buffer.concat(manifestChunks.map((part) => Buffer.from(part))).toString('utf8')) as OrgPortabilityManifest;
    return { directory, domainPaths, assetPaths, manifest };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function readOrgDomainRows(
  extraction: OrgArchiveExtraction,
  domain: string,
): Promise<any[]> {
  const file = extraction.domainPaths[domain];
  if (!file) return [];
  const rows: any[] = [];
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of lines) if (line) rows.push(JSON.parse(line));
  return rows;
}
