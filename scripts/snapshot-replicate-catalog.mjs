#!/usr/bin/env node
// Snapshot Replicate allowlist model input schemas into the provider metadata.
//
// Usage:
//   REPLICATE_API_TOKEN=<token> node scripts/snapshot-replicate-catalog.mjs
//
// Without a token the script still emits model ids (so completeness tests pass)
// but leaves fields empty; the output is marked NEEDS-LIVE-SMOKE-TEST.
//
// The committed snapshot is the runtime source of truth — the app never calls
// Replicate at catalog time.

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const METADATA_FILE = path.join(
  __dirname,
  '../libraries/providers/replicate/src/v1/metadata.ts',
);
const ALLOWLIST_FILE = path.join(
  __dirname,
  '../libraries/nestjs-libraries/src/media/replicate-studio/replicate-catalog.allowlist.ts',
);
const CONVERTER_FILE = path.join(
  __dirname,
  '../libraries/nestjs-libraries/src/media/replicate-studio/replicate-schema-to-model-fields.ts',
);

const BASE = 'https://api.replicate.com/v1';
const TOKEN = process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY;
const require = createRequire(import.meta.url);

const ALLOWLIST_TO_MEDIA_CATEGORY = {
  'text-to-image': 'text-to-image',
  'image-to-image': 'image-to-image',
  'background-remove': 'image-bg-remove',
  'upscale': 'image-upscale',
  'inpaint': 'image-inpaint',
  'text-to-video': 'text-to-video',
  'image-to-video': 'image-to-video',
  'video-to-video': 'video-to-video',
  'video-upscale': 'video-upscale',
  'video-background': 'video-background',
  'text-to-music': 'text-to-music',
};

function evaluateTsFile(file) {
  const source = fs.readFileSync(file, 'utf8');
  const result = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.Preserve,
      removeComments: true,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
    reportDiagnostics: false,
  });
  const exports = {};
  const moduleObj = { exports };
  const fn = new Function(
    'exports',
    'module',
    'require',
    '__dirname',
    '__filename',
    result.outputText,
  );
  fn(exports, moduleObj, require, path.dirname(file), file);
  return moduleObj.exports;
}

const allowlistModule = evaluateTsFile(ALLOWLIST_FILE);
const converterModule = evaluateTsFile(CONVERTER_FILE);
const MODEL_ALLOWLIST = allowlistModule.MODEL_ALLOWLIST;
const CATEGORIES = allowlistModule.CATEGORIES;
const convertReplicateInputSchema = converterModule.convertReplicateInputSchema;

function categoryFromAllowlistKey(key) {
  return ALLOWLIST_TO_MEDIA_CATEGORY[key] || null;
}

async function fetchModel(owner, name) {
  const res = await fetch(`${BASE}/models/${owner}/${name}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    throw new Error(`Replicate fetch failed for ${owner}/${name}: ${res.status}`);
  }
  return res.json();
}

async function main() {
  const mediaModels = {};
  let fetched = 0;
  let failed = 0;

  for (const [allowlistKey, modelIds] of Object.entries(MODEL_ALLOWLIST)) {
    const category = categoryFromAllowlistKey(allowlistKey);
    if (!category) continue;

    for (const modelId of modelIds) {
      const [owner, name] = modelId.split('/');
      let fields = [];
      let modelName = name;

      if (TOKEN) {
        try {
          const data = await fetchModel(owner, name);
          modelName = data.name || name;
          const schemas =
            data.latest_version?.openapi_schema?.components?.schemas;
          const inputSchema = schemas?.Input || null;
          fields = convertReplicateInputSchema(inputSchema, schemas);
          fetched++;
        } catch (err) {
          console.warn(`Could not fetch ${modelId}: ${err.message}`);
          failed++;
        }
      }

      if (!mediaModels[category]) mediaModels[category] = [];
      mediaModels[category].push({
        id: modelId,
        label: modelName,
        fields,
      });
    }
  }

  // Orchestration categories have no per-model catalog (they resolve via the
  // image-frame / vision / TTS pools), so they don't appear in `mediaModels`.
  // Replicate's text-to-image models make it a valid Slide-Generator frame source,
  // so keep `image-slide` rather than letting the keys-only derivation drop it.
  const ORCHESTRATION_CATEGORIES = ['image-slide'];

  const metadata = {
    id: 'replicate',
    displayName: 'replicate',
    kind: 'direct',
    domains: ['media'],
    mediaCategories: Array.from(
      new Set([...Object.keys(mediaModels), ...ORCHESTRATION_CATEGORIES]),
    ).sort(),
    hasModelList: false,
    mediaModels,
    website: 'https://replicate.com',
    description: {
      en: 'Run and fine-tune open-source image, video, and audio models through one API — from FLUX and Stable Diffusion to video upscalers and music generators.',
    },
  };

  let source = fs.readFileSync(METADATA_FILE, 'utf8');
  let newObject = `export const metadata: ProviderMetadata = ${JSON.stringify(
    metadata,
    null,
    2,
  )};`;
  if (!TOKEN) {
    newObject =
      '// NEEDS-LIVE-SMOKE-TEST: fields below were emitted without a REPLICATE_API_TOKEN.\n// Re-run this script with a token to populate per-model fields.\n' +
      newObject;
  }
  // Match (and drop) any prior NEEDS-LIVE-SMOKE-TEST banner so a token-backed re-run
  // after a tokenless run doesn't leave a stale, now-inaccurate comment behind.
  source = source.replace(
    /(?:\/\/\s*NEEDS-LIVE-SMOKE-TEST:[^\n]*\n(?:\/\/[^\n]*\n)*)?export\s+const\s+metadata\s*:\s*ProviderMetadata\s*=\s*\{[\s\S]*?\n\};/,
    newObject,
  );
  fs.writeFileSync(METADATA_FILE, source, 'utf8');

  console.log(
    `Wrote replicate metadata: ${Object.keys(mediaModels).length} categories, ${Object.values(
      mediaModels,
    ).reduce((s, a) => s + a.length, 0)} models.`,
  );
  if (TOKEN) {
    console.log(`Fetched schemas: ${fetched} ok, ${failed} failed.`);
  } else {
    console.log('No REPLICATE_API_TOKEN provided — model fields are empty.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
