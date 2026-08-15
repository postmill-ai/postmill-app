#!/usr/bin/env node
// Regenerates openapi.yml from the live NestJS Swagger document.
//
// Default mode: writes openapi.yml.
// --check: regenerates and compares against the on-disk file. Exits non-zero on drift.
//
// The document comes from apps/backend/src/openapi-dump.ts, which constructs AppModule
// and serializes the same document the app serves at /docs. That means this needs the
// backend BUILT and the usual boot env present (DATABASE_URL, REDIS_URL, JWT_SECRET) —
// hence the CI gate lives in boot-guard.yml, which already provisions all of it.
//
//   pnpm run build:backend && pnpm run openapi:generate
//   pnpm run openapi:generate -- --check

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const OUT_FILE = path.join(REPO_ROOT, 'openapi.yml');
const DUMP_ENTRY = path.join(
  REPO_ROOT,
  'apps/backend/dist/apps/backend/src/openapi-dump.js',
);

const CHECK = process.argv.includes('--check');

const HEADER = `# GENERATED — do not hand-edit.
#
# Produced from the NestJS controllers by \`pnpm run openapi:generate\`, which builds the
# same document the running backend serves at /docs. Request/response schemas are inferred
# from the TypeScript types by the @nestjs/swagger CLI plugin (apps/backend/nest-cli.json).
#
# To enrich this file, add @ApiOperation / @Api*Response decorators or JSDoc to the
# controllers and DTOs and re-run the generator — do not edit the output.
#
# CI enforces that this file matches the code (.github/workflows/boot-guard.yml).
`;

function readVersion() {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'),
  );
  return pkg.version;
}

function buildDocument() {
  if (!fs.existsSync(DUMP_ENTRY)) {
    console.error(
      `openapi generator: ${path.relative(REPO_ROOT, DUMP_ENTRY)} not found.\n` +
        'Run `pnpm run build:backend` first.',
    );
    process.exit(2);
  }

  const res = spawnSync(
    process.execPath,
    ['--experimental-require-module', DUMP_ENTRY],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env, OPENAPI_VERSION: readVersion() },
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );

  if (res.status !== 0) {
    console.error('openapi generator: the dump entrypoint failed.');
    process.exit(res.status ?? 1);
  }

  try {
    return JSON.parse(res.stdout);
  } catch {
    console.error(
      'openapi generator: dump entrypoint did not emit valid JSON on stdout.',
    );
    process.exit(1);
  }
}

function serialize(document) {
  // lineWidth: 0 disables YAML's line folding — folded descriptions produce enormous,
  // unreviewable diffs whenever an unrelated word changes earlier in the string.
  return HEADER + YAML.stringify(document, { lineWidth: 0 });
}

function main() {
  const text = serialize(buildDocument());

  if (CHECK) {
    if (!fs.existsSync(OUT_FILE)) {
      console.error(`DRIFT: ${path.relative(REPO_ROOT, OUT_FILE)} does not exist.`);
      process.exit(1);
    }
    const current = fs.readFileSync(OUT_FILE, 'utf8');
    if (current.trim() !== text.trim()) {
      console.error(
        `DRIFT: ${path.relative(REPO_ROOT, OUT_FILE)} does not match the controllers.`,
      );
      console.error(
        '\nOpenAPI drift detected. Run the generator without --check to refresh.',
      );
      process.exit(1);
    }
    console.log('No OpenAPI drift.');
    return;
  }

  fs.writeFileSync(OUT_FILE, text, 'utf8');
  const doc = YAML.parse(text);
  console.log(
    `Wrote ${path.relative(REPO_ROOT, OUT_FILE)}: ${
      Object.keys(doc.paths || {}).length
    } paths, ${Object.keys(doc.components?.schemas || {}).length} schemas, version ${
      doc.info?.version
    }.`,
  );
}

main();
