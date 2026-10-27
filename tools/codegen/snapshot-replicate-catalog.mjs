#!/usr/bin/env node
// Snapshot Replicate allowlist model input schemas into the provider metadata.
//
// Usage:
//   REPLICATE_API_TOKEN=<token> node tools/codegen/snapshot-replicate-catalog.mjs
//   node tools/codegen/snapshot-replicate-catalog.mjs --offline
//   node tools/codegen/snapshot-replicate-catalog.mjs --offline --check
//
// Without a token the script still emits model ids (so completeness tests pass)
// but leaves fields empty; the output is marked NEEDS-LIVE-SMOKE-TEST.
// Offline mode instead preserves committed fields and notes, applies curated
// field policies, and never calls Replicate.
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
  '../../libraries/providers/replicate/src/v1/metadata.ts',
);
const ALLOWLIST_FILE = path.join(
  __dirname,
  '../../libraries/nestjs-libraries/src/media/replicate-studio/replicate-catalog.allowlist.ts',
);
const CONVERTER_FILE = path.join(
  __dirname,
  '../../libraries/nestjs-libraries/src/media/replicate-studio/replicate-schema-to-model-fields.ts',
);

const BASE = 'https://api.replicate.com/v1';
const TOKEN = process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY;
const OFFLINE = process.argv.includes('--offline');
const CHECK = process.argv.includes('--check');
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

function readExistingMetadata() {
  const source = fs.readFileSync(METADATA_FILE, 'utf8');
  const match = source.match(
    /export\s+const\s+metadata\s*:\s*ProviderMetadata\s*=\s*(\{[\s\S]*\});/,
  );
  if (!match) throw new Error('Could not read the committed Replicate metadata snapshot');
  return JSON.parse(match[1]);
}

const existingMetadata = readExistingMetadata();
const existingModelsByCategoryAndId = new Map(
  Object.entries(existingMetadata?.mediaModels ?? {})
    .flatMap(([category, models]) =>
      models.map((model) => [`${category}:${model.id}`, model]),
    ),
);

function applyCuratedFieldPolicies(modelId, fields) {
  if (modelId === 'minimax/video-01') {
    return fields.filter((field) => field.name !== 'duration');
  }
  const policies = {
    'google/veo-3.1': { choices: [4, 6, 8], defaultValue: 8 },
    'bytedance/seedance-1-pro': { choices: [5, 10], defaultValue: 5 },
    'kwaivgi/kling-v2.5-turbo-pro': { choices: [5, 10], defaultValue: 5 },
  };
  const policy = policies[modelId];
  if (!policy || fields.length === 0) return fields;
  return fields.map((field) => {
    if (field.name !== 'duration') return field;
    const next = {
      ...field,
      type: 'select',
      options: policy.choices.map((value) => ({ value: String(value), label: String(value) })),
      default: String(policy.defaultValue),
    };
    delete next.min;
    delete next.max;
    delete next.step;
    return next;
  });
}

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

// Kernel media categories served by Replicate that have no Replicate-studio tab,
// so they are absent from MODEL_ALLOWLIST. Without this list a re-run silently
// drops them from metadata.ts and the defaults resolver stops offering Replicate
// for them (#221 dropped `image-outpaint` this way, breaking Expand Image).
const METADATA_ONLY_MODELS = {
  'image-outpaint': ['black-forest-labs/flux-fill-pro'],
};

async function main() {
  const mediaModels = {};
  let fetched = 0;
  let failed = 0;

  const sources = [
    ...Object.entries(MODEL_ALLOWLIST).map(([key, ids]) => [
      categoryFromAllowlistKey(key),
      ids,
    ]),
    ...Object.entries(METADATA_ONLY_MODELS),
  ];

  for (const [category, modelIds] of sources) {
    if (!category) continue;

    for (const modelId of modelIds) {
      const [owner, name] = modelId.split('/');
      const existing = existingModelsByCategoryAndId.get(`${category}:${modelId}`);
      let fields = OFFLINE ? (existing?.fields ?? []) : [];
      let modelName = existing?.label ?? name;

      if (TOKEN && !OFFLINE) {
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
        ...existing,
        id: modelId,
        label: modelName,
        fields: applyCuratedFieldPolicies(modelId, fields),
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

  const originalSource = fs.readFileSync(METADATA_FILE, 'utf8');
  let newObject = `export const metadata: ProviderMetadata = ${JSON.stringify(
    metadata,
    null,
    2,
  )};`;
  if (!TOKEN && !OFFLINE) {
    newObject =
      '// NEEDS-LIVE-SMOKE-TEST: fields below were emitted without a REPLICATE_API_TOKEN.\n// Re-run this script with a token to populate per-model fields.\n' +
      newObject;
  }
  // Match (and drop) any prior NEEDS-LIVE-SMOKE-TEST banner so a token-backed re-run
  // after a tokenless run doesn't leave a stale, now-inaccurate comment behind.
  const source = originalSource.replace(
    /(?:\/\/\s*NEEDS-LIVE-SMOKE-TEST:[^\n]*\n(?:\/\/[^\n]*\n)*)?export\s+const\s+metadata\s*:\s*ProviderMetadata\s*=\s*\{[\s\S]*?\n\};/,
    newObject,
  );
  if (CHECK) {
    if (source !== originalSource) {
      console.error('Replicate metadata is out of date. Run snapshot-replicate-catalog.mjs.');
      process.exitCode = 1;
    } else {
      console.log('Replicate metadata snapshot is up to date.');
    }
    return;
  }
  fs.writeFileSync(METADATA_FILE, source, 'utf8');

  console.log(
    `Wrote replicate metadata: ${Object.keys(mediaModels).length} categories, ${Object.values(
      mediaModels,
    ).reduce((s, a) => s + a.length, 0)} models.`,
  );
  if (OFFLINE) {
    console.log('Offline mode: preserved committed schemas; no Replicate calls made.');
  } else if (TOKEN) {
    console.log(`Fetched schemas: ${fetched} ok, ${failed} failed.`);
  } else {
    console.log('No REPLICATE_API_TOKEN provided — model fields are empty.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
