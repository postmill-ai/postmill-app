import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { DesignerDoc } from './designer-doc.schema';
import { DESIGNER_DOC_VERSION } from './designer-doc.limits';

/**
 * `.pdesign` — the Postmill design interchange file (stage 1).
 *
 * A zip archive (fflate `zipSync`) with two entries:
 *
 *   manifest.json   PostmillFileManifest — type tag + format/doc versions
 *   doc.json        the DesignerDoc payload, verbatim
 *
 * Stage 2 will add an `assets/` entry bundling the referenced media, so the
 * doc's org-scoped `fileId`s can be remapped across orgs. Stage 1 writes no
 * `assets/` entry at all (an empty placeholder directory cannot be
 * represented by every unzipper) and leaves the references as-is: same-org
 * round-trips resolve, cross-org imports show broken media until stage 2.
 */

export const POSTMILL_FILE_TYPE = 'postmill-design';
export const POSTMILL_FORMAT_VERSION = 1;

export interface PostmillFileManifest {
  type: typeof POSTMILL_FILE_TYPE;
  formatVersion: number;
  docVersion: number;
  mode: 'image' | 'video';
  app: string;
  exportedAt: string;
  name: string;
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

export const buildPostmillFile = (doc: DesignerDoc, name: string): Uint8Array => {
  const manifest: PostmillFileManifest = {
    type: POSTMILL_FILE_TYPE,
    formatVersion: POSTMILL_FORMAT_VERSION,
    docVersion: doc.version,
    mode: doc.mode,
    app: 'postmill',
    exportedAt: new Date().toISOString(),
    name,
  };
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

/**
 * Parse a `.pdesign` archive. The doc is returned UNVALIDATED — schema
 * validation happens downstream via `DesignerDocService.validate`, so a doc
 * that is merely schema-invalid (vs structurally unreadable) keeps the shared
 * "Invalid DesignerDoc" error shape.
 */
export const parsePostmillFile = (
  bytes: Uint8Array | Buffer
): { manifest: PostmillFileManifest; doc: unknown } => {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(bytes));
  } catch {
    throw new PostmillFileError('corrupt', 'The file is not a readable .pdesign archive');
  }

  const manifestEntry = entries['manifest.json'];
  const docEntry = entries['doc.json'];
  if (!manifestEntry || !docEntry) {
    throw new PostmillFileError(
      'missing-entry',
      'The .pdesign file is missing its manifest or document'
    );
  }

  const manifest = parseJson(strFromU8(manifestEntry), 'manifest');
  if (manifest?.type !== POSTMILL_FILE_TYPE) {
    throw new PostmillFileError('wrong-type', 'This is not a Postmill design file');
  }
  if ((manifest.formatVersion ?? 0) > POSTMILL_FORMAT_VERSION) {
    throw new PostmillFileError(
      'unsupported-format-version',
      `This file uses a newer .pdesign format (v${manifest.formatVersion}) than this Postmill supports (v${POSTMILL_FORMAT_VERSION})`
    );
  }

  const doc = parseJson(strFromU8(docEntry), 'document');
  if (typeof doc?.version === 'number' && doc.version > DESIGNER_DOC_VERSION) {
    throw new PostmillFileError(
      'unsupported-doc-version',
      `This design was saved by a newer version of Postmill (document v${doc.version}, supported up to v${DESIGNER_DOC_VERSION})`
    );
  }

  return { manifest: manifest as PostmillFileManifest, doc };
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
