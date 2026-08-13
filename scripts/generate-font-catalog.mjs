#!/usr/bin/env node
/**
 * Regenerate the bundled Google Fonts catalog.
 *
 *   node scripts/generate-font-catalog.mjs
 *
 * The Designer used to carry a hand-written list of ~50 families, repeated in
 * three places and loaded through a single `@import` that had reached 2,000
 * characters — so growing it meant editing three files and pushing a
 * render-blocking request that every page paid for, Designer or not.
 *
 * This pulls the same metadata the fonts.google.com UI uses (public, no API key)
 * and writes a compact catalog the client and the server both read. Committing
 * the output rather than fetching at runtime keeps builds deterministic and
 * gives the server an allowlist to validate against before it puts a family
 * name into a URL.
 */

import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const METADATA_URL = 'https://fonts.google.com/metadata/fonts';

const OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../libraries/nestjs-libraries/src/media/designer-doc/google-fonts.catalog.ts'
);

/** Google's category strings, shortened to one character per row. */
const CATEGORY = {
  'Sans Serif': 's',
  Serif: 'f',
  Display: 'd',
  Handwriting: 'h',
  Monospace: 'm',
};

const main = async () => {
  const res = await fetch(METADATA_URL);
  if (!res.ok) throw new Error(`metadata fetch failed: ${res.status}`);
  // The endpoint prefixes its JSON with an anti-hijacking guard.
  const body = (await res.text()).replace(/^\)\]\}'\n?/, '');
  const list = JSON.parse(body).familyMetadataList || [];

  const rows = [];
  for (const entry of list) {
    const category = CATEGORY[entry.category];
    if (!category) continue;
    // Upright weights only: italics come from the same request when asked for,
    // and doubling every row for them would bloat the catalog for nothing.
    const weights = Object.keys(entry.fonts || {})
      .filter((v) => /^\d+$/.test(v))
      .map(Number)
      .sort((a, b) => a - b);
    if (!weights.length) continue;
    // Family names land verbatim inside a template literal below: anything that
    // could terminate or interpolate it (backtick, backslash, ${) or split a
    // row (|, newline) gets the family skipped rather than escaped.
    if (/[|`\\\r\n]|\$\{/.test(entry.family)) continue;
    rows.push(`${entry.family}|${category}|${weights.join(',')}`);
  }
  rows.sort();

  const file = `/**
 * Every family Google Fonts serves, as one compact row each:
 * \`Family|category|weights\`, category being s/f/d/h/m.
 *
 * GENERATED — run \`node scripts/generate-font-catalog.mjs\` to refresh. Do not
 * hand-edit; the point of committing it is that the client picker, the canvas
 * loader and the server renderer all read the SAME list, which is what the
 * three hand-maintained copies could never guarantee.
 *
 * A string rather than JSON so it costs one parse and compresses well: the
 * whole catalog is a few kB gzipped, against ~1.9k families.
 */
export const GOOGLE_FONTS_CATALOG_RAW = \`${rows.join('\n')}\`;
`;

  writeFileSync(OUT, file, 'utf8');
  console.log(`wrote ${rows.length} families to ${OUT}`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
