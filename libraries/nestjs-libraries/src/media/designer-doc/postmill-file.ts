import { strFromU8, strToU8, unzipSync, zipSync, Unzip, UnzipInflate } from 'fflate';
import type { Readable } from 'stream';
import type { DesignerDoc } from './designer-doc.schema';
import { DESIGNER_DOC_VERSION } from './designer-doc.limits';

/**
 * `.pdesign` — the Postmill design interchange file.
 *
 * A zip archive (fflate) with these entries:
 *
 *   manifest.json     PostmillFileManifest — type tag + format/doc versions
 *   doc.json          the DesignerDoc payload, verbatim (references are
 *                     rewritten only on IMPORT, never on export)
 *   assets/           (format v2) media bytes, one entry per referenced fileId
 *   assets/fonts/     (format v2) custom font bytes used by the doc
 *
 * Format history:
 *   v1 (stage 1): manifest + doc only; doc `fileId` media references travel
 *     verbatim — same-org round-trips resolve, cross-org imports show broken
 *     media.
 *   v2 (stage 2): self-contained bundle. The manifest carries `assets` (a map
 *     of originalFileId → { path, mime, originalName, size }) and `fonts`
 *     ([{ family, weight, italic, path }]); the importer re-uploads both into
 *     the importing org and rewrites the doc references.
 */

export const POSTMILL_FILE_TYPE = 'postmill-design';
export const POSTMILL_FORMAT_VERSION = 2;

/** Largest doc.json an import will buffer — real docs are single-digit MB. */
export const POSTMILL_MAX_DOC_BYTES = 64 * 1024 * 1024;

export interface PostmillAssetEntry {
  /** Zip path, `assets/<originalFileId>.<ext>`. */
  path: string;
  mime: string;
  originalName: string;
  size: number;
}

export interface PostmillFontEntry {
  family: string;
  weight: number;
  italic?: boolean;
  /** Zip path, `assets/fonts/<file>`. */
  path: string;
}

export interface PostmillFileManifest {
  type: typeof POSTMILL_FILE_TYPE;
  formatVersion: number;
  docVersion: number;
  mode: 'image' | 'video';
  app: string;
  exportedAt: string;
  name: string;
  /** v2: originalFileId → bundled asset. Absent on v1 files. */
  assets?: Record<string, PostmillAssetEntry>;
  /** v2: org custom fonts used by the doc. Absent on v1 files. */
  fonts?: PostmillFontEntry[];
}

/**
 * Every parse failure is one of these codes so the API layer can map each to
 * a distinct, human-readable 400 — a corrupt zip and a file written by a
 * NEWER Postmill are very different conversations with the user.
 */
export type PostmillFileErrorCode =
  | 'corrupt'
  | 'missing-entry'
  | 'wrong-type'
  | 'unsupported-format-version'
  | 'unsupported-doc-version'
  | 'invalid-json';

export class PostmillFileError extends Error {
  constructor(
    readonly code: PostmillFileErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'PostmillFileError';
  }
}

export const buildPostmillManifest = (
  doc: DesignerDoc,
  name: string,
  assets?: Record<string, PostmillAssetEntry>,
  fonts?: PostmillFontEntry[]
): PostmillFileManifest => ({
  type: POSTMILL_FILE_TYPE,
  formatVersion: POSTMILL_FORMAT_VERSION,
  docVersion: doc.version,
  mode: doc.mode,
  app: 'postmill',
  exportedAt: new Date().toISOString(),
  name,
  ...(assets && Object.keys(assets).length ? { assets } : {}),
  ...(fonts && fonts.length ? { fonts } : {}),
});

/** Small in-memory build (tests, asset-free docs). The async export path streams instead. */
export const buildPostmillFile = (doc: DesignerDoc, name: string): Uint8Array => {
  const manifest = buildPostmillManifest(doc, name);
  return zipSync({
    'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
    'doc.json': strToU8(JSON.stringify(doc)),
  });
};

const parseJson = (raw: string, what: string): any => {
  try {
    return JSON.parse(raw);
  } catch {
    throw new PostmillFileError('invalid-json', `The ${what} is not valid JSON`);
  }
};

const validateManifest = (manifest: any): PostmillFileManifest => {
  if (manifest?.type !== POSTMILL_FILE_TYPE) {
    throw new PostmillFileError('wrong-type', 'This is not a Postmill design file');
  }
  if ((manifest.formatVersion ?? 0) > POSTMILL_FORMAT_VERSION) {
    throw new PostmillFileError(
      'unsupported-format-version',
      `This file uses a newer .pdesign format (v${manifest.formatVersion}) than this Postmill supports (v${POSTMILL_FORMAT_VERSION})`
    );
  }
  return manifest as PostmillFileManifest;
};

const validateDocVersion = (doc: any): void => {
  if (typeof doc?.version === 'number' && doc.version > DESIGNER_DOC_VERSION) {
    throw new PostmillFileError(
      'unsupported-doc-version',
      `This design was saved by a newer version of Postmill (document v${doc.version}, supported up to v${DESIGNER_DOC_VERSION})`
    );
  }
};

export interface ParsedPostmillFile {
  manifest: PostmillFileManifest;
  doc: unknown;
  /** v2 bundled bytes keyed by zip path (assets/<id>.<ext>, assets/fonts/<f>). */
  assets: Map<string, Uint8Array>;
}

const parsedFromEntries = (entries: Record<string, Uint8Array>): ParsedPostmillFile => {
  const manifestEntry = entries['manifest.json'];
  const docEntry = entries['doc.json'];
  if (!manifestEntry || !docEntry) {
    throw new PostmillFileError(
      'missing-entry',
      'The .pdesign file is missing its manifest or document'
    );
  }
  const manifest = validateManifest(parseJson(strFromU8(manifestEntry), 'manifest'));
  const doc = parseJson(strFromU8(docEntry), 'document');
  validateDocVersion(doc);
  const assets = new Map<string, Uint8Array>();
  for (const [path, bytes] of Object.entries(entries)) {
    if (path.startsWith('assets/')) assets.set(path, bytes);
  }
  return { manifest, doc, assets };
};

/**
 * Parse a `.pdesign` archive held in memory. The doc is returned UNVALIDATED —
 * schema validation happens downstream via `DesignerDocService.validate`, so a
 * doc that is merely schema-invalid (vs structurally unreadable) keeps the
 * shared "Invalid DesignerDoc" error shape.
 */
export const parsePostmillFile = (
  bytes: Uint8Array | Buffer
): ParsedPostmillFile => {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(bytes));
  } catch {
    throw new PostmillFileError('corrupt', 'The file is not a readable .pdesign archive');
  }
  return parsedFromEntries(entries);
};

export interface DesignFileMetadata {
  mode: 'image' | 'video';
  durationMs?: number;
}

export const designFileMetadata = (doc: unknown): DesignFileMetadata | null => {
  const mode = (doc as any)?.mode;
  if (mode !== 'image' && mode !== 'video') return null;
  const durationMs = (doc as any)?.outputs?.[0]?.durationMs;
  return {
    mode,
    ...(mode === 'video' &&
    typeof durationMs === 'number' &&
    Number.isFinite(durationMs) &&
    durationMs > 0
      ? { durationMs }
      : {}),
  };
};

const parsePostmillFileEntries = (
  stream: Readable,
  maxAssetBytes: number,
  metadataOnly = false
): Promise<ParsedPostmillFile> =>
  new Promise((resolve, reject) => {
    const entries: Record<string, Uint8Array> = {};
    let totalAssetBytes = 0;
    let settled = false;
    const fail = (err: PostmillFileError) => {
      if (settled) return;
      settled = true;
      stream.removeAllListeners();
      stream.destroy();
      reject(err);
    };

    const unzip = new Unzip();
    unzip.register(UnzipInflate);
    let sawFile = false;
    unzip.onfile = (file) => {
      sawFile = true;
      const wanted =
        file.name === 'manifest.json' ||
        file.name === 'doc.json' ||
        (!metadataOnly && file.name.startsWith('assets/'));
      if (metadataOnly && !wanted) return;
      const cap =
        file.name === 'doc.json'
          ? POSTMILL_MAX_DOC_BYTES
          : file.name === 'manifest.json'
            ? 1024 * 1024
            : maxAssetBytes;
      const chunks: Uint8Array[] = [];
      let size = 0;
      file.ondata = (err, data, final) => {
        if (settled) return;
        if (err) {
          fail(new PostmillFileError('corrupt', 'The file is not a readable .pdesign archive'));
          return;
        }
        size += data.length;
        if (file.name.startsWith('assets/')) {
          totalAssetBytes += data.length;
        }
        if (size > cap || totalAssetBytes > maxAssetBytes) {
          fail(
            new PostmillFileError(
              'corrupt',
              `The .pdesign entry "${file.name}" exceeds the size limit`
            )
          );
          return;
        }
        if (wanted) chunks.push(data);
        if (final && wanted) {
          entries[file.name] = chunks.length === 1 ? chunks[0] : concatU8(chunks);
        }
      };
      try {
        file.start();
      } catch {
        fail(new PostmillFileError('corrupt', 'The file is not a readable .pdesign archive'));
      }
    };

    stream.on('data', (chunk: Buffer) => {
      if (settled) return;
      try {
        unzip.push(new Uint8Array(chunk));
      } catch {
        fail(new PostmillFileError('corrupt', 'The file is not a readable .pdesign archive'));
      }
    });
    stream.on('end', () => {
      if (settled) return;
      try {
        unzip.push(new Uint8Array(0), true);
        settled = true;
        if (!sawFile) {
          reject(new PostmillFileError('corrupt', 'The file is not a readable .pdesign archive'));
          return;
        }
        resolve(parsedFromEntries(entries));
      } catch (err) {
        if (err instanceof PostmillFileError) {
          reject(err);
        } else {
          reject(new PostmillFileError('corrupt', 'The file is not a readable .pdesign archive'));
        }
      }
    });
    stream.on('error', () =>
      fail(new PostmillFileError('corrupt', 'The uploaded file could not be read'))
    );
  });

/**
 * Streaming parse for the import endpoint's disk-spooled uploads (up to
 * 1 GB). Only manifest/doc/asset entries are collected — everything else is
 * inflated and discarded — and decompressed bytes are capped so a zip bomb
 * cannot exhaust memory through a small compressed upload.
 */
export const parsePostmillFileStream = (stream: Readable, maxAssetBytes: number) =>
  parsePostmillFileEntries(stream, maxAssetBytes);

export const parsePostmillFileMetadataStream = async (
  stream: Readable
): Promise<DesignFileMetadata | null> => {
  const parsed = await parsePostmillFileEntries(stream, 0, true);
  return designFileMetadata(parsed.doc);
};

const concatU8 = (chunks: Uint8Array[]): Uint8Array => {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
};

/** Zip local-file magic — how the import endpoint tells `.pdesign` from a raw `.json`. */
export const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04] as const;

export const hasZipMagic = (bytes: Uint8Array | Buffer): boolean =>
  bytes.length >= 4 && ZIP_MAGIC.every((b, i) => bytes[i] === b);

/**
 * Raw-.json import path: accept a string/Buffer (file bytes) or an
 * already-parsed object and hand back the object. Validation is downstream.
 */
export const parseDesignJson = (raw: unknown): unknown => {
  if (typeof raw === 'object' && raw !== null && !Buffer.isBuffer(raw) && !(raw instanceof Uint8Array)) {
    return raw;
  }
  const text = Buffer.isBuffer(raw) || raw instanceof Uint8Array ? strFromU8(raw) : String(raw);
  return parseJson(text, 'file');
};

/** Filename-safe stem for the Content-Disposition header — strips path separators and non-word chars. */
export const sanitizeDownloadName = (name: unknown): string => {
  const cleaned = String(name ?? '')
    .replace(/[\\/"]/g, ' ')
    .replace(/[^\w\- ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  return cleaned || 'design';
};
