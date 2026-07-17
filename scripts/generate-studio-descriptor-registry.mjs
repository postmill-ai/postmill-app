#!/usr/bin/env node
// Generates provider metadata blocks from the frontend studio-kit descriptors.
//
// Default mode: merges generated `mediaModels`, `website`, `description.en`, and
// reconciled `mediaCategories`/`kind` into each provider's `metadata.ts`.
//
// --check: regenerates the expected metadata and compares it to the on-disk
// `metadata.ts` files. Exits non-zero if descriptor drift would change metadata.

import { globSync } from 'glob';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DESCRIPTOR_GLOB = path.join(
  __dirname,
  '../apps/frontend/src/components/media-tools/*/descriptor.ts',
);
const PROVIDER_METADATA_GLOB = path.join(
  __dirname,
  '../libraries/providers/*/src/v1/metadata.ts',
);

const AI_MEDIA_CATEGORIES = [
  'text-to-speech',
  'text-to-music',
  'text-to-image',
  'text-to-video',
  'image-to-image',
  'image-to-video',
  'image-upscale',
  'image-bg-remove',
  'image-inpaint',
  'image-focal-point',
  'image-slide',
  'video-avatar',
  'video-caption',
  'video-to-video',
  'video-background',
  'video-upscale',
];

const ORCHESTRATION_CATEGORIES = new Set([
  'image-focal-point',
  'image-slide',
  'video-caption',
]);

const ACTION_ONLY_PROVIDERS = new Set([
  'heygen',
  'did',
  'hedra',
  'tavus',
  'deepgram',
  'ideogram',
  'reelfarm',
]);

const LIVE_LISTMODELS_HUBS = new Set([
  'deepinfra',
  'fireworks',
  'gateway',
  'genviral',
  'groq',
  'openrouter',
  'siliconflow',
  'togetherai',
  'xai',
]);

const CHECK = process.argv.includes('--check');

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

function findDescriptorExport(file) {
  const source = fs.readFileSync(file, 'utf8');

  // Skip descriptors that import runtime values (custom panels). They have no
  // generic form fields and are not used by the studio-kit default path.
  if (/^import\s+\{[^}]+\}\s+from\s+['"][^'"]+['"];?\s*$/m.test(source)) {
    const base = path.basename(path.dirname(file));
    console.log(`Skipping ${base} (runtime import)`);
    return null;
  }

  const moduleExports = evaluateTsFile(file);
  return Object.values(moduleExports).find(
    (v) => v && typeof v === 'object' && v.provider && Array.isArray(v.tabs),
  );
}

function isMediaInputField(field) {
  return field.type === 'media';
}

function categoryForTab(tab, descriptorTitle) {
  if (AI_MEDIA_CATEGORIES.includes(tab.key)) {
    return tab.key;
  }

  if (tab.operation === 'image') {
    return tab.key === 'image-to-image' ? 'image-to-image' : 'text-to-image';
  }

  if (tab.operation === 'audio') {
    if (tab.key === 'text-to-music') return 'text-to-music';
    if (/suno/i.test(descriptorTitle) || /suno/i.test(tab.key) || /suno/i.test(tab.label)) {
      return 'text-to-music';
    }
    return 'text-to-speech';
  }

  if (tab.operation === 'video') {
    if (tab.key === 'image-to-video') return 'image-to-video';
    // Skip one-off VFX / talking-head / audio-to-video tabs that take media
    // inputs but are not the standard image-to-video default category.
    const hasMediaInput = tab.fields.some(isMediaInputField);
    if (hasMediaInput) return null;
    return 'text-to-video';
  }

  return null;
}

function modelFieldsFromTab(tab) {
  return (tab.fields || [])
    .filter(
      (f) =>
        f.type !== 'prompt' &&
        f.type !== 'media' &&
        !(f.type === 'select' && f.name === 'model'),
    )
    .map((f) => {
      const out = {
        name: f.name,
        type: f.type,
      };
      if (f.label !== undefined) out.label = f.label;
      if (f.placeholder !== undefined) out.placeholder = f.placeholder;
      if (f.default !== undefined) out.default = f.default;
      if (f.options !== undefined) out.options = f.options;
      if (f.min !== undefined) out.min = f.min;
      if (f.max !== undefined) out.max = f.max;
      if (f.step !== undefined) out.step = f.step;
      if (f.required !== undefined) out.required = f.required;
      if (f.help !== undefined) out.help = f.help;
      return out;
    });
}

function buildProviderCatalog(descriptors) {
  const catalog = {};

  for (const descriptor of descriptors) {
    const provider = descriptor.provider;
    if (!catalog[provider]) {
      catalog[provider] = {
        provider,
        title: descriptor.title,
        website: descriptor.landing?.website,
        description: descriptor.landing?.description,
        mediaModels: {},
      };
    }

    const entry = catalog[provider];
    // Merge landing info if the first descriptor didn't carry it.
    if (!entry.website && descriptor.landing?.website) {
      entry.website = descriptor.landing.website;
    }
    if (!entry.description && descriptor.landing?.description) {
      entry.description = descriptor.landing.description;
    }

    for (const tab of descriptor.tabs || []) {
      const category = categoryForTab(tab, descriptor.title);
      if (!category) continue;

      const fields = modelFieldsFromTab(tab);

      if (tab.model) {
        if (!entry.mediaModels[category]) entry.mediaModels[category] = [];
        const genericLabels = new Set([
          'Text → Video',
          'Image → Video',
          'Audio → Video',
          'Text → Image',
          'Image → Image',
          'Text → Speech',
          'Text → Music',
        ]);
        let label = tab.label || tab.model;
        if (genericLabels.has(label)) {
          label = `${descriptor.title} (${label})`;
        }
        entry.mediaModels[category].push({
          id: tab.model,
          label,
          fields,
        });
      } else {
        const modelField = tab.fields.find(
          (f) => f.type === 'select' && f.name === 'model',
        );
        if (modelField && modelField.options) {
          if (!entry.mediaModels[category]) entry.mediaModels[category] = [];
          for (const opt of modelField.options) {
            entry.mediaModels[category].push({
              id: opt.value,
              label: opt.label || opt.value,
              fields,
            });
          }
        }
      }
    }
  }

  return catalog;
}

function generatedCategories(mediaModels) {
  return new Set(Object.keys(mediaModels));
}

function reconcileMetadata(providerId, existing, catalog) {
  const isLiveHub = LIVE_LISTMODELS_HUBS.has(providerId);
  const isActionOnly = ACTION_ONLY_PROVIDERS.has(providerId);
  const generatedCats = generatedCategories(catalog.mediaModels);

  let kind = existing.kind;
  let mediaCategories = existing.mediaCategories ?? [];
  let hasModelList = existing.hasModelList;

  if (isLiveHub) {
    // Live hubs keep their broad category declarations; listModels is the source.
    kind = 'hub';
    hasModelList = true;
  } else if (isActionOnly) {
    kind = 'action';
    hasModelList = false;
  } else if (existing.kind === 'hub') {
    // Non-live hubs (azure/bedrock/openai/vertex): keep hub kind and live
    // hasModelList, but provide a static mediaModels fallback for media categories.
    kind = 'hub';
    hasModelList = true;
    mediaCategories = mediaCategories.filter(
      (c) => generatedCats.has(c) || ORCHESTRATION_CATEGORIES.has(c),
    );
  } else if (generatedCats.size > 0) {
    kind = 'direct';
    hasModelList = false;
    // Keep orchestration categories the file already declared (image-slide /
    // image-focal-point have no descriptor-derived models — they resolve via the
    // image-frame / vision / TTS pools — so dropping them would silently remove a
    // direct image provider as a Slide-Generator / focal-point candidate), then add
    // the descriptor-generated categories on top.
    mediaCategories = Array.from(
      new Set([
        ...mediaCategories.filter((c) => ORCHESTRATION_CATEGORIES.has(c)),
        ...generatedCats,
      ]),
    );
  } else {
    // Fallback: preserve whatever the file had.
    hasModelList = !!existing.hasModelList;
  }

  const mergedMediaModels = {};
  for (const cat of mediaCategories) {
    if (catalog.mediaModels[cat]) {
      mergedMediaModels[cat] = catalog.mediaModels[cat];
    }
  }

  // Snapshot-backed direct providers (e.g. Replicate) have no descriptor but do
  // carry a committed mediaModels catalog. Preserve it rather than clearing it.
  const hasGeneratedModels = Object.keys(mergedMediaModels).length > 0;
  if (!hasGeneratedModels && existing.kind === 'direct' && existing.mediaModels) {
    Object.assign(mergedMediaModels, existing.mediaModels);
    for (const cat of Object.keys(existing.mediaModels)) {
      if (!mediaCategories.includes(cat)) mediaCategories.push(cat);
    }
  }

  const description = {};
  if (catalog.description) {
    description.en = catalog.description;
  } else if (existing.description?.en) {
    description.en = existing.description.en;
  }

  return {
    ...existing,
    kind,
    mediaCategories: Array.from(new Set(mediaCategories)).sort(),
    hasModelList,
    mediaModels: hasGeneratedModels || Object.keys(mergedMediaModels).length > 0 ? mergedMediaModels : undefined,
    website: catalog.website || existing.website,
    description: Object.keys(description).length > 0 ? description : undefined,
  };
}

function metadataObjectText(metadata) {
  return `export const metadata: ProviderMetadata = ${JSON.stringify(
    metadata,
    null,
    2,
  )};`;
}

function replaceMetadataObject(source, metadata) {
  const newObject = metadataObjectText(metadata);
  const pattern =
    /export\s+const\s+metadata\s*:\s*ProviderMetadata\s*=\s*\{[\s\S]*?\n\};/;
  if (!pattern.test(source)) {
    return newObject + '\n';
  }
  return source.replace(pattern, newObject);
}

function loadExistingMetadata(file) {
  try {
    const exports = evaluateTsFile(file);
    return exports.metadata;
  } catch (err) {
    console.error(`Failed to evaluate ${file}:`, err.message);
    return null;
  }
}

function main() {
  const descriptorFiles = globSync(DESCRIPTOR_GLOB).sort();
  const descriptors = descriptorFiles
    .map(findDescriptorExport)
    .filter(Boolean);

  const catalog = buildProviderCatalog(descriptors);

  const metadataFiles = globSync(PROVIDER_METADATA_GLOB).sort();
  const filesById = {};
  const allFiles = [];
  for (const file of metadataFiles) {
    const existing = loadExistingMetadata(file);
    if (!existing) continue;
    allFiles.push({ file, existing });
    const key = existing.id;
    if (!filesById[key]) filesById[key] = [];
    filesById[key].push({ file, existing });
  }

  // Map each generated catalog provider id to the best metadata file.
  // Media descriptors always target the provider's media-domain metadata.
  const catalogFileForId = {};
  for (const id of Object.keys(catalog)) {
    const candidates = filesById[id] || [];
    const mediaFile = candidates.find((c) => c.existing.domains.includes('media'));
    catalogFileForId[id] = mediaFile || candidates[0];
  }

  let drift = false;

  for (const { file, existing } of allFiles) {
    const providerId = existing.id;
    const isMediaTarget =
      catalogFileForId[providerId] && catalogFileForId[providerId].file === file;
    const providerCatalog = isMediaTarget
      ? catalog[providerId] || {
          mediaModels: {},
          website: undefined,
          description: undefined,
        }
      : { mediaModels: {}, website: undefined, description: undefined };
    const reconciled = reconcileMetadata(providerId, existing, providerCatalog);

    if (CHECK) {
      const currentText = fs.readFileSync(file, 'utf8');
      const expectedText = replaceMetadataObject(currentText, reconciled);
      if (currentText.trim() !== expectedText.trim()) {
        console.error(`DRIFT: ${file} metadata does not match generated catalog.`);
        drift = true;
      }
      continue;
    }

    const currentText = fs.readFileSync(file, 'utf8');
    const out = replaceMetadataObject(currentText, reconciled);
    fs.writeFileSync(file, out, 'utf8');
    const modelCount = Object.values(reconciled.mediaModels || {}).reduce(
      (sum, arr) => sum + arr.length,
      0,
    );
    console.log(
      `Updated ${providerId}: kind=${reconciled.kind}, categories=[${reconciled.mediaCategories.join(
        ',',
      )}], models=${modelCount}`,
    );
  }

  if (CHECK) {
    if (drift) {
      console.error('\nMetadata drift detected. Run the generator without --check to refresh.');
      process.exit(1);
    }
    console.log('No metadata drift.');
  }
}

main();
