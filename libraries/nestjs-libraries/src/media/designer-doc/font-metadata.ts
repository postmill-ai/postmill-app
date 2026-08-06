/**
 * What an uploaded font file says about itself.
 *
 * Custom font upload derived the family from the FILENAME and hardcoded the
 * weight to 400. Uploading `Inter-Bold.ttf` and `Inter-Regular.ttf` therefore
 * produced two unrelated families, both claiming weight 400 — and if the user
 * renamed them to a common family, the client kept only the first
 * (`use-brand-fonts.ts` keys by family) while the server re-registered the
 * second over it. Either way, one of the two files silently never rendered.
 *
 * The file already carries the answer: `name` holds the typographic family and
 * `OS/2` holds `usWeightClass`. This reads them.
 *
 * TTF and OTF are plain sfnt. WOFF2 keeps the same tables behind one Brotli
 * stream, which Node can undo — worth doing, since woff2 is an accepted upload
 * and the alternative is silently falling back to the filename for it.
 */

import { brotliDecompressSync } from 'zlib';

export interface FontMetadata {
  /** Typographic family (name ID 16, else name ID 1). */
  family?: string;
  /** `OS/2.usWeightClass`, clamped to the 1–1000 the spec allows. */
  weight?: number;
  /** `OS/2.fsSelection` bit 0. */
  italic?: boolean;
}

/** WOFF2's fixed table-tag table; an entry's index stands in for its tag. */
const WOFF2_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post',
  'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
  'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea',
  'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH',
  'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar',
  'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop',
  'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
];

type Tables = Map<string, Buffer>;

/** Read the tables out of a plain sfnt (ttf/otf) file. */
const sfntTables = (buf: Buffer): Tables => {
  const tables: Tables = new Map();
  if (buf.length < 12) return tables;
  const numTables = buf.readUInt16BE(4);
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (rec + 16 > buf.length) break;
    const tag = buf.toString('latin1', rec, rec + 4);
    const offset = buf.readUInt32BE(rec + 8);
    const length = buf.readUInt32BE(rec + 12);
    if (offset + length <= buf.length) {
      tables.set(tag, buf.subarray(offset, offset + length));
    }
  }
  return tables;
};

/** WOFF2's variable-length integer. */
const readBase128 = (buf: Buffer, pos: number): [number, number] => {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    if (pos >= buf.length) return [0, pos];
    const byte = buf[pos++];
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) return [value, pos];
  }
  return [value, pos];
};

/**
 * Read the tables out of a WOFF2 file.
 *
 * Only `glyf` and `loca` are ever transformed, so everything this cares about
 * sits verbatim in the decompressed stream — laid out in directory order, each
 * table taking its transformed length where one is given and its original
 * length otherwise.
 */
const woff2Tables = (buf: Buffer): Tables => {
  const tables: Tables = new Map();
  if (buf.length < 48) return tables;
  const numTables = buf.readUInt16BE(12);
  const totalCompressedSize = buf.readUInt32BE(20);

  let pos = 48;
  const directory: { tag: string; length: number }[] = [];
  for (let i = 0; i < numTables; i++) {
    if (pos >= buf.length) return tables;
    const flags = buf[pos++];
    const tagIndex = flags & 0x3f;
    let tag: string;
    if (tagIndex === 63) {
      tag = buf.toString('latin1', pos, pos + 4);
      pos += 4;
    } else {
      tag = WOFF2_TAGS[tagIndex] ?? '';
    }
    let origLength: number;
    [origLength, pos] = readBase128(buf, pos);
    const transformVersion = (flags >> 6) & 0x03;
    const transformed =
      tag === 'glyf' || tag === 'loca'
        ? transformVersion === 0
        : transformVersion !== 0;
    let length = origLength;
    if (transformed) [length, pos] = readBase128(buf, pos);
    directory.push({ tag, length });
  }

  let data: Buffer;
  try {
    data = brotliDecompressSync(buf.subarray(pos, pos + totalCompressedSize));
  } catch {
    return tables;
  }

  let offset = 0;
  for (const entry of directory) {
    if (offset + entry.length > data.length) break;
    tables.set(entry.tag, data.subarray(offset, offset + entry.length));
    offset += entry.length;
  }
  return tables;
};

/**
 * The best family name in a `name` table.
 *
 * Name ID 16 is the typographic family — the one that groups Bold and Regular
 * under "Inter". ID 1 splits them ("Inter Bold"), which is exactly the mistake
 * being fixed, so it is only a fallback.
 */
const familyFromNameTable = (name: Buffer): string | undefined => {
  if (name.length < 6) return undefined;
  const count = name.readUInt16BE(2);
  const stringOffset = name.readUInt16BE(4);

  let best: { rank: number; value: string } | undefined;
  for (let i = 0; i < count; i++) {
    const rec = 6 + i * 12;
    if (rec + 12 > name.length) break;
    const platformId = name.readUInt16BE(rec);
    const nameId = name.readUInt16BE(rec + 6);
    if (nameId !== 16 && nameId !== 1) continue;
    const length = name.readUInt16BE(rec + 8);
    const offset = stringOffset + name.readUInt16BE(rec + 10);
    if (offset + length > name.length) continue;
    const raw = name.subarray(offset, offset + length);
    // Platform 3 (Windows) and 0 (Unicode) are UTF-16BE; platform 1 (Mac) is
    // a single-byte encoding that is ASCII for every name worth reading.
    // `swap16` throws on an odd length, which a truncated record can have.
    const value =
      platformId === 1 || raw.length % 2
        ? raw.toString('latin1')
        : Buffer.from(raw).swap16().toString('utf16le');
    const clean = value.replace(/\0/g, '').trim();
    if (!clean) continue;
    const rank = nameId === 16 ? 2 : 1;
    if (!best || rank > best.rank) best = { rank, value: clean };
  }
  return best?.value;
};

/** Read family, weight and italic out of a font file; fields absent if unreadable. */
export const parseFontMetadata = (buffer: Buffer): FontMetadata => {
  let tables: Tables;
  try {
    const signature = buffer.length >= 4 ? buffer.toString('latin1', 0, 4) : '';
    tables = signature === 'wOF2' ? woff2Tables(buffer) : sfntTables(buffer);
  } catch {
    return {};
  }

  const meta: FontMetadata = {};

  const name = tables.get('name');
  if (name) {
    try {
      meta.family = familyFromNameTable(name);
    } catch {
      // A malformed name table means we fall back to the filename, not a 500.
    }
  }

  const os2 = tables.get('OS/2');
  if (os2 && os2.length >= 64) {
    const weight = os2.readUInt16BE(4);
    if (weight >= 1 && weight <= 1000) meta.weight = weight;
    meta.italic = (os2.readUInt16BE(62) & 0x01) === 1;
  }

  return meta;
};
