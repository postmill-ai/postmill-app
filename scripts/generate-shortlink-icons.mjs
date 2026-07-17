import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { deflateSync } from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const OUT = join(__dirname, '..', 'apps', 'frontend', 'public', 'icons', 'shortlinks');
const SIZE = 48;

const PROVIDERS = {
  bitly: '#EE6123',
  blink: '#1B73E8',
  tly: '#4361EE',
  replug: '#4361EE',
  owly: '#00A86B',
  dub: '#18181B',
  shortio: '#F97316',
  linkly: '#2563EB',
  isgd: '#059669',
  tinycc: '#DC2626',
  sniply: '#4361EE',
  cleanuri: '#0891B2',
  rebrandly: '#2563EB',
  tinyurl: '#0284C7',
  pixelme: '#2563EB',
  t2m: '#475569',
  vgd: '#15803D',
  cuttly: '#B45309',
  switchy: '#4361EE',
};

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function createChunk(type, data) {
  const payload = Buffer.concat([Buffer.from(type), data]);
  const crc = crc32(payload);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc, 0);
  return Buffer.concat([length, payload, crcBuf]);
}

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

for (const [name, color] of Object.entries(PROVIDERS)) {
  const [r, g, b] = hexToRgb(color);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // color type (RGB)
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  const raw = Buffer.alloc(SIZE * (1 + SIZE * 3));
  for (let y = 0; y < SIZE; y++) {
    raw[y * (1 + SIZE * 3)] = 0;
    for (let x = 0; x < SIZE; x++) {
      const off = y * (1 + SIZE * 3) + 1 + x * 3;
      raw[off] = r;
      raw[off + 1] = g;
      raw[off + 2] = b;
    }
  }

  const idat = deflateSync(raw);

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrChunk = createChunk('IHDR', ihdr);
  const idatChunk = createChunk('IDAT', idat);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  const png = Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
  writeFileSync(join(OUT, `${name}.png`), png);
  console.log(`Wrote ${name}.png`);
}
