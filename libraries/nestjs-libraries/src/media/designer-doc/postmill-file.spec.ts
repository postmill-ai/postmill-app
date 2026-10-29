import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { Readable } from 'stream';
import type { DesignerDoc } from './designer-doc.schema';
import { DESIGNER_DOC_VERSION } from './designer-doc.limits';
import {
  POSTMILL_FILE_TYPE,
  POSTMILL_FORMAT_VERSION,
  PostmillFileError,
  buildPostmillFile,
  buildPostmillManifest,
  hasZipMagic,
  parseDesignJson,
  parsePostmillFile,
  parsePostmillFileStream,
  parsePostmillFileMetadataStream,
  designFileMetadata,
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

  it('round-trips v9 video clip fillGradient and align verbatim', () => {
    const doc = {
      version: 9,
      mode: 'video',
      outputs: [{
        id: 'video-out',
        formatId: 'square',
        name: 'Square',
        width: 1080,
        height: 1080,
        fps: 30,
        durationMs: 1000,
        tracks: [{
          id: 'shape-track',
          type: 'shape',
          clips: [{
            id: 'shape-clip',
            startMs: 0,
            endMs: 1000,
            shape: 'rect',
            align: 'justify',
            fillGradient: {
              type: 'radial',
              stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#FFFFFF80' }],
            },
          }],
        }],
      }],
    } as unknown as DesignerDoc;

    const parsed = parsePostmillFile(buildPostmillFile(doc, 'Motion'));
    expect(parsed.manifest.docVersion).toBe(9);
    expect(parsed.doc).toEqual(doc);
  });
});

describe('format v2 (bundled assets + fonts)', () => {
  const v2Zip = (over: { manifest?: any; assets?: Record<string, Uint8Array> } = {}) => {
    const manifest = buildPostmillManifest(
      sampleDoc(),
      'Bundled',
      {
        'file-1': { path: 'assets/file-1.png', mime: 'image/png', originalName: 'hero.png', size: 4 },
      },
      [{ family: 'Acme', weight: 700, italic: true, path: 'assets/fonts/acme-700i.ttf' }]
    );
    return zipSync({
      'manifest.json': strToU8(JSON.stringify(over.manifest ?? manifest)),
      'doc.json': strToU8(JSON.stringify(sampleDoc())),
      'assets/file-1.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      'assets/fonts/acme-700i.ttf': strToU8('font-bytes'),
      ...(over.assets ?? {}),
    });
  };

  it('round-trips manifest assets/fonts and bundled bytes', () => {
    const parsed = parsePostmillFile(v2Zip());

    expect(parsed.manifest.formatVersion).toBe(POSTMILL_FORMAT_VERSION);
    expect(parsed.manifest.assets).toEqual({
      'file-1': { path: 'assets/file-1.png', mime: 'image/png', originalName: 'hero.png', size: 4 },
    });
    expect(parsed.manifest.fonts).toEqual([
      { family: 'Acme', weight: 700, italic: true, path: 'assets/fonts/acme-700i.ttf' },
    ]);
    expect([...parsed.assets.get('assets/file-1.png')!]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(Buffer.from(parsed.assets.get('assets/fonts/acme-700i.ttf')!).toString()).toBe('font-bytes');
  });

  it('streaming parse yields the same result as the in-memory parse', async () => {
    const bytes = Buffer.from(v2Zip());
    const parsed = await parsePostmillFileStream(Readable.from([bytes]), 1024 * 1024);

    expect(parsed.manifest.name).toBe('Bundled');
    expect(parsed.doc).toEqual(sampleDoc());
    expect(parsed.assets.size).toBe(2);
  });

  it('streaming parse survives small chunks', async () => {
    const bytes = Buffer.from(v2Zip());
    const chunks: Buffer[] = [];
    for (let i = 0; i < bytes.length; i += 7) chunks.push(bytes.subarray(i, i + 7));
    const parsed = await parsePostmillFileStream(Readable.from(chunks), 1024 * 1024);
    expect(parsed.manifest.formatVersion).toBe(POSTMILL_FORMAT_VERSION);
    expect(parsed.assets.size).toBe(2);
  });

  it('streaming parse rejects corrupt bytes cleanly', async () => {
    await expect(
      parsePostmillFileStream(Readable.from([Buffer.from([1, 2, 3, 4, 5])]), 1024)
    ).rejects.toMatchObject({ code: 'corrupt' });
  });

  it('streaming parse caps decompressed asset bytes', async () => {
    const big = new Uint8Array(2048).fill(65);
    const bytes = zipSync({
      'manifest.json': strToU8(JSON.stringify(buildPostmillManifest(sampleDoc(), 'x'))),
      'doc.json': strToU8(JSON.stringify(sampleDoc())),
      'assets/big.bin': big,
    });
    await expect(
      parsePostmillFileStream(Readable.from([Buffer.from(bytes)]), 1024)
    ).rejects.toMatchObject({ code: 'corrupt' });
  });

  it('still accepts a v1 file (no assets key)', () => {
    const v1 = zipSync({
      'manifest.json': strToU8(
        JSON.stringify({
          type: POSTMILL_FILE_TYPE,
          formatVersion: 1,
          docVersion: DESIGNER_DOC_VERSION,
          mode: 'image',
          app: 'postmill',
          exportedAt: new Date().toISOString(),
          name: 'Legacy',
        })
      ),
      'doc.json': strToU8(JSON.stringify(sampleDoc())),
    });
    const parsed = parsePostmillFile(v1);
    expect(parsed.manifest.formatVersion).toBe(1);
    expect(parsed.manifest.assets).toBeUndefined();
    expect(parsed.assets.size).toBe(0);
    expect(parsed.doc).toEqual(sampleDoc());
  });

  it('rejects a v3 file with the dedicated newer-format error', () => {
    const v3 = zipSync({
      'manifest.json': strToU8(
        JSON.stringify({ type: POSTMILL_FILE_TYPE, formatVersion: 3, name: 'Future' })
      ),
      'doc.json': strToU8(JSON.stringify(sampleDoc())),
    });
    try {
      parsePostmillFile(v3);
      expect.unreachable();
    } catch (err) {
      expect((err as PostmillFileError).code).toBe('unsupported-format-version');
      expect((err as PostmillFileError).message).toMatch(/newer \.pdesign format \(v3\)/);
    }
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

describe('design file metadata', () => {
  it('reads image and primary-output video metadata', () => {
    expect(designFileMetadata(sampleDoc())).toEqual({ mode: 'image' });
    expect(designFileMetadata({
      mode: 'video',
      outputs: [{ durationMs: 12345 }, { durationMs: 9000 }],
    })).toEqual({ mode: 'video', durationMs: 12345 });
  });

  it.each([0, -1, NaN, Infinity, '5000', undefined])(
    'omits invalid video duration %s',
    (durationMs) => {
      expect(designFileMetadata({ mode: 'video', outputs: [{ durationMs }] })).toEqual({
        mode: 'video',
      });
    }
  );

  it('parses only manifest/doc entries and does not inflate bundled assets', async () => {
    const doc = { ...sampleDoc(), mode: 'video', outputs: [{ durationMs: 5000 }] };
    const bytes = Buffer.from(zipSync({
      'manifest.json': strToU8(JSON.stringify(buildPostmillManifest(sampleDoc(), 'Video'))),
      'doc.json': strToU8(JSON.stringify(doc)),
      'assets/large.bin': new Uint8Array(2 * 1024 * 1024).fill(65),
    }, { level: 9 }));

    await expect(
      parsePostmillFileMetadataStream(Readable.from([bytes]))
    ).resolves.toEqual({ mode: 'video', durationMs: 5000 });
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
