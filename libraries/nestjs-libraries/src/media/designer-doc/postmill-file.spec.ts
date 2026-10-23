import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import type { DesignerDoc } from './designer-doc.schema';
import { DESIGNER_DOC_VERSION } from './designer-doc.limits';
import {
  POSTMILL_FILE_TYPE,
  POSTMILL_FORMAT_VERSION,
  PostmillFileError,
  buildPostmillFile,
  hasZipMagic,
  parseDesignJson,
  parsePostmillFile,
  sanitizeDownloadName,
} from './postmill-file';

const sampleDoc = (): DesignerDoc =>
  ({
    version: DESIGNER_DOC_VERSION,
    mode: 'image',
    outputs: [
      {
        id: 'out-1',
        formatId: 'square',
        name: 'Square',
        width: 1080,
        height: 1080,
        background: '#fff',
        children: [{ id: 'el-1', type: 'text', text: 'hi' }],
      },
    ],
  }) as unknown as DesignerDoc;

describe('buildPostmillFile / parsePostmillFile round-trip', () => {
  it('round-trips the doc verbatim and writes a full manifest', () => {
    const doc = sampleDoc();
    const bytes = buildPostmillFile(doc, 'My Design');

    expect(hasZipMagic(bytes)).toBe(true);

    const { manifest, doc: parsed } = parsePostmillFile(bytes);
    expect(parsed).toEqual(doc);
    expect(manifest).toMatchObject({
      type: POSTMILL_FILE_TYPE,
      formatVersion: POSTMILL_FORMAT_VERSION,
      docVersion: DESIGNER_DOC_VERSION,
      mode: 'image',
      app: 'postmill',
      name: 'My Design',
    });
    expect(typeof manifest.exportedAt).toBe('string');
  });
});

describe('parsePostmillFile rejections', () => {
  const zip = (entries: Record<string, string>) =>
    zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)])));

  it('rejects a corrupt zip with a dedicated error', () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(() => parsePostmillFile(garbage)).toThrowError(PostmillFileError);
    try {
      parsePostmillFile(garbage);
    } catch (err) {
      expect((err as PostmillFileError).code).toBe('corrupt');
    }
  });

  it('rejects a zip without the expected entries', () => {
    const bytes = zip({ 'something-else.txt': 'hello' });
    try {
      parsePostmillFile(bytes);
      expect.unreachable();
    } catch (err) {
      expect((err as PostmillFileError).code).toBe('missing-entry');
    }
  });

  it('rejects a foreign manifest type', () => {
    const bytes = zip({
      'manifest.json': JSON.stringify({ type: 'other-tool', formatVersion: 1 }),
      'doc.json': JSON.stringify(sampleDoc()),
    });
    try {
      parsePostmillFile(bytes);
      expect.unreachable();
    } catch (err) {
      expect((err as PostmillFileError).code).toBe('wrong-type');
      expect((err as PostmillFileError).message).toMatch(/not a Postmill design file/);
    }
  });

  it('rejects a newer formatVersion with a dedicated "newer file format" error', () => {
    const bytes = zip({
      'manifest.json': JSON.stringify({
        type: POSTMILL_FILE_TYPE,
        formatVersion: POSTMILL_FORMAT_VERSION + 1,
      }),
      'doc.json': JSON.stringify(sampleDoc()),
    });
    try {
      parsePostmillFile(bytes);
      expect.unreachable();
    } catch (err) {
      expect((err as PostmillFileError).code).toBe('unsupported-format-version');
      expect((err as PostmillFileError).message).toMatch(/newer \.pdesign format/);
    }
  });

  it('rejects a doc newer than this Postmill understands with a dedicated error', () => {
    const bytes = zip({
      'manifest.json': JSON.stringify({ type: POSTMILL_FILE_TYPE, formatVersion: 1 }),
      'doc.json': JSON.stringify({ ...sampleDoc(), version: DESIGNER_DOC_VERSION + 1 }),
    });
    try {
      parsePostmillFile(bytes);
      expect.unreachable();
    } catch (err) {
      expect((err as PostmillFileError).code).toBe('unsupported-doc-version');
      expect((err as PostmillFileError).message).toMatch(/newer version of Postmill/);
    }
  });

  it('rejects a malformed manifest or document body as invalid-json', () => {
    const badManifest = zip({ 'manifest.json': '{nope', 'doc.json': '{}' });
    try {
      parsePostmillFile(badManifest);
      expect.unreachable();
    } catch (err) {
      expect((err as PostmillFileError).code).toBe('invalid-json');
    }

    const badDoc = zip({
      'manifest.json': JSON.stringify({ type: POSTMILL_FILE_TYPE, formatVersion: 1 }),
      'doc.json': '[1,2',
    });
    try {
      parsePostmillFile(badDoc);
      expect.unreachable();
    } catch (err) {
      expect((err as PostmillFileError).code).toBe('invalid-json');
    }
  });
});

describe('parseDesignJson (raw .json import path)', () => {
  it('parses a JSON string and passes objects through', () => {
    const doc = sampleDoc();
    expect(parseDesignJson(JSON.stringify(doc))).toEqual(doc);
    expect(parseDesignJson(Buffer.from(JSON.stringify(doc)))).toEqual(doc);
    const asObject = { version: 8, mode: 'image', outputs: [] };
    expect(parseDesignJson(asObject)).toBe(asObject);
  });

  it('rejects malformed JSON with a PostmillFileError', () => {
    try {
      parseDesignJson('{broken');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(PostmillFileError);
      expect((err as PostmillFileError).code).toBe('invalid-json');
    }
  });
});

describe('sanitizeDownloadName', () => {
  it('strips path separators, quotes and non-word chars; falls back to "design"', () => {
    expect(sanitizeDownloadName('My "Hero" / Final?.png')).toBe('My Hero Finalpng');
    expect(sanitizeDownloadName('???')).toBe('design');
    expect(sanitizeDownloadName(undefined)).toBe('design');
    expect(sanitizeDownloadName('ok-name_1')).toBe('ok-name_1');
  });
});
