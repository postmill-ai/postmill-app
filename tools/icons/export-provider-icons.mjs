#!/usr/bin/env node
/**
 * Export provider icons as static SVG files for the public catalogue.
 *
 * `GET /public/integrations/list` returns `icon` URLs on the app frontend:
 * channels/comms use the existing `/icons/platforms/<id>.png` set; every other
 * domain points at `/icons/providers/<id>.svg` — the files this script writes.
 *
 * Source of truth is the inline glyph map in
 * `apps/frontend/src/components/shared/provider-icon.tsx` (`const ICONS`),
 * rendered with the same rules as the `ProviderIcon` component (glyph only —
 * not the padded rounded tile the app wraps it in). Providers without a glyph
 * get the component's initials-tile fallback so nothing on the site 404s.
 *
 * Usage:
 *   node tools/icons/export-provider-icons.mjs [--ids <url|file>] [--force]
 *
 *   --ids    where to read the provider list from: the live catalogue URL
 *            (default http://127.0.0.1:4300/public/integrations/list), a saved
 *            JSON response, or a text file with one `domain/id` per line.
 *   --force  overwrite existing files (by default hand-curated SVGs are kept).
 *
 * The backend spec `provider-icons.completeness.spec.ts` fails CI whenever a
 * registered provider has no file — run this and commit the output.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FRONTEND = path.join(ROOT, 'apps/frontend');
const SHARED = path.join(FRONTEND, 'src/components/shared');
const OUT_DIR = path.join(FRONTEND, 'public/icons/providers');
const ICON_DOMAINS = new Set(['ai', 'media', 'storage', 'shortlink', 'vpn']);
// `currentColor` inherits the app's text colour; standalone files need a real one.
const CURRENT_COLOR = '#1f2937';

const args = process.argv.slice(2);
const force = args.includes('--force');
const idsArg = args.includes('--ids') ? args[args.indexOf('--ids') + 1] : 'http://127.0.0.1:4300/public/integrations/list';

const require = createRequire(path.join(ROOT, 'package.json'));
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// ── load the component's data tables ──────────────────────────────────────────

function loadModule(file, patch) {
  const src = patch(fs.readFileSync(file, 'utf8'));
  const { code } = esbuild.transformSync(src, {
    loader: file.endsWith('.tsx') ? 'tsx' : 'ts',
    format: 'cjs',
    jsx: 'automatic',
    target: 'node20',
  });
  const mod = { exports: {} };
  const localRequire = (spec) => {
    if (spec === '@postmill-ai/frontend/components/shared/readable-text-color') return readable;
    if (spec.startsWith('.')) throw new Error(`unexpected relative import ${spec}`);
    return require(spec);
  };
  new Function('require', 'module', 'exports', code)(localRequire, mod, mod.exports);
  return mod.exports;
}

const readable = loadModule(path.join(SHARED, 'readable-text-color.ts'), (s) => s);
const icons = loadModule(path.join(SHARED, 'provider-icon.tsx'), (s) =>
  s
    .replace(/^'use client';\s*/m, '')
    // the translation hook is render-only; the tables don't need it
    .replace(/import \{ useT \} from '[^']+';/, 'const useT = () => (k, d) => d;')
    + '\nexport { ICONS, FALLBACK_COLORS, LABEL_MAP, deterministicColor };\n',
);
const { ICONS, FALLBACK_COLORS, LABEL_MAP, deterministicColor } = icons;

// ── render ─────────────────────────────────────────────────────────────────────

const bgColorFor = (key) => FALLBACK_COLORS[key] || deterministicColor(key);

function glyphSvg(key) {
  const icon = ICONS[key];
  if (icon.src) {
    return fs.readFileSync(path.join(FRONTEND, 'public', icon.src), 'utf8');
  }
  const fill = icon.full ? undefined : icon.color || bgColorFor(key);
  const markup = renderToStaticMarkup(
    React.createElement(
      'svg',
      { xmlns: 'http://www.w3.org/2000/svg', viewBox: icon.viewBox || '0 0 24 24', fill },
      icon.node,
    ),
  );
  return markup.replaceAll('currentColor', CURRENT_COLOR) + '\n';
}

function tileSvg(key) {
  const bg = bgColorFor(key);
  const label = LABEL_MAP[key] || key.slice(0, 2).toUpperCase();
  const fg = readable.readableTextColor(bg);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">` +
    `<rect width="24" height="24" rx="7" fill="${bg}"/>` +
    `<text x="12" y="12.5" text-anchor="middle" dominant-baseline="central" ` +
    `font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="9.5" font-weight="600" fill="${fg}">${label}</text>` +
    `</svg>\n`
  );
}

// The component keys storage entries by the UPPER_SNAKE StorageProviderType;
// the kernel providerId (and so the filename) is that lowercased.
const keyFor = (id) => Object.keys(ICONS).find((k) => k.toLowerCase() === id) ?? Object.keys(LABEL_MAP).find((k) => k.toLowerCase() === id) ?? id;

// ── provider list ─────────────────────────────────────────────────────────────

async function loadIds() {
  let text;
  if (/^https?:\/\//.test(idsArg)) {
    const res = await fetch(idsArg);
    if (!res.ok) throw new Error(`${idsArg} → HTTP ${res.status}`);
    text = await res.text();
  } else {
    text = fs.readFileSync(idsArg, 'utf8');
  }
  const ids = new Set();
  if (text.trimStart().startsWith('{')) {
    for (const d of JSON.parse(text).domains) {
      if (ICON_DOMAINS.has(d.id)) for (const p of d.providers) ids.add(p.id);
    }
  } else {
    for (const line of text.split('\n')) {
      const m = line.trim().match(/^([a-z]+)\/(\S+)$/);
      if (m && ICON_DOMAINS.has(m[1])) ids.add(m[2]);
    }
  }
  return ids;
}

// ── main ──────────────────────────────────────────────────────────────────────

const ids = await loadIds();
const wanted = ids;
fs.mkdirSync(OUT_DIR, { recursive: true });

let written = 0, kept = 0, tiles = 0;
for (const id of [...wanted].sort()) {
  const file = path.join(OUT_DIR, `${id}.svg`);
  if (fs.existsSync(file) && !force) { kept++; continue; }
  const key = keyFor(id);
  const isTile = !ICONS[key];
  fs.writeFileSync(file, isTile ? tileSvg(key) : glyphSvg(key));
  written++;
  if (isTile) { tiles++; console.log(`  tile   ${id}.svg (no glyph in provider-icon.tsx)`); }
}
console.log(`wrote ${written} (${tiles} initials tiles), kept ${kept} existing → ${path.relative(ROOT, OUT_DIR)}`);
