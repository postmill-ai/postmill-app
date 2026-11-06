import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { SourceMapConsumer, SourceMapGenerator } = require('source-map');
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;

const productionFiles = async (root) => {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await productionFiles(fullPath));
    else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.map'))) files.push(fullPath);
  }
  return files;
};

const flattenSourcemap = async (filePath) => {
  const raw = JSON.parse(await fs.readFile(filePath, 'utf8'));
  if (!Array.isArray(raw.sections)) return raw;
  const consumer = await new SourceMapConsumer(raw);
  const generator = new SourceMapGenerator({ file: raw.file, sourceRoot: raw.sourceRoot });
  consumer.eachMapping((mapping) => {
    const entry = {
      generated: { line: mapping.generatedLine, column: mapping.generatedColumn },
    };
    if (mapping.originalLine != null) {
      entry.original = { line: mapping.originalLine, column: mapping.originalColumn };
      entry.source = mapping.source;
      entry.name = mapping.name;
    }
    generator.addMapping(entry);
  });
  for (const source of consumer.sources) {
    const content = consumer.sourceContentFor(source, true);
    if (content != null) generator.setSourceContent(source, content);
  }
  consumer.destroy();
  const flattened = generator.toJSON();
  if (raw.debugId) flattened.debugId = raw.debugId;
  if (raw.ignoreList) flattened.ignoreList = raw.ignoreList;
  return flattened;
};

const sourceMappingAliases = async (files) => {
  const aliases = new Map();
  for (const filePath of files.filter((file) => file.endsWith('.js'))) {
    const contents = await fs.readFile(filePath, 'utf8');
    const matches = [...contents.matchAll(/\/\/[#@]\s*sourceMappingURL=([^\s]+)/g)];
    const match = matches.at(-1);
    if (!match || match[1].includes('://')) continue;
    const reference = match[1].split(/[?#]/)[0];
    let decoded = reference;
    try {
      decoded = decodeURIComponent(reference);
    } catch {}
    aliases.set(path.resolve(path.dirname(filePath), decoded), `${filePath}.map`);
  }
  return aliases;
};

const main = async () => {
  const releaseArg = process.argv[2] === '--' ? process.argv[3] : process.argv[2];
  const release = releaseArg || process.env.GITHUB_SHA || process.env.VERCEL_GIT_COMMIT_SHA;
  const dsn = process.env.NEXT_PUBLIC_EPURE_DSN;
  if (!release || !dsn) {
    console.log('Epure sourcemaps skipped: release or DSN is not configured.');
    return;
  }

  const url = new URL(dsn);
  const projectId = url.pathname.split('/').filter(Boolean)[0];
  if (!projectId || !url.username) {
    console.log('Epure sourcemaps skipped: DSN is invalid.');
    return;
  }

  const nextDir = path.resolve('apps/frontend/.next');
  const files = [];
  try {
    for (const directory of ['static', 'server', 'serverless']) {
      try {
        files.push(...await productionFiles(path.join(nextDir, directory)));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  } catch {
    console.log('Epure sourcemaps skipped: frontend production artifacts are unavailable.');
    return;
  }
  const aliases = await sourceMappingAliases(files);

  let uploaded = 0;
  let oversized = 0;
  let unsupported = 0;
  let failed = 0;
  for (const filePath of files.filter((file) => file.endsWith('.map'))) {
    const relative = path.relative(nextDir, filePath).split(path.sep).join('/');
    if (relative.includes('..')) {
      unsupported += 1;
      console.log(`Epure sourcemap skipped (unsupported artifact path): ${relative}`);
      continue;
    }
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_ARTIFACT_BYTES) {
      oversized += 1;
      console.log(`Epure sourcemap skipped (>2 MiB): ${relative}`);
      continue;
    }

    let sourcemap;
    try {
      sourcemap = await flattenSourcemap(filePath);
    } catch {
      failed += 1;
      console.log(`Epure sourcemap upload failed (processing): ${relative}`);
      continue;
    }
    const payload = JSON.stringify(sourcemap);
    if (Buffer.byteLength(payload) > MAX_ARTIFACT_BYTES) {
      oversized += 1;
      console.log(`Epure sourcemap skipped (>2 MiB after flattening): ${relative}`);
      continue;
    }
    const artifactPath = aliases.get(filePath);
    const artifact = artifactPath
      ? path.relative(nextDir, artifactPath).split(path.sep).join('/')
      : relative;
    const form = new FormData();
    form.append('name', `~/_next/${artifact}`);
    form.append('file', new Blob([payload], { type: 'application/json' }), path.basename(filePath));
    try {
      const response = await fetch(
        `${url.origin}/api/${projectId}/releases/${encodeURIComponent(release)}/files/`,
        {
          method: 'POST',
          headers: { 'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${url.username}` },
          body: form,
          signal: AbortSignal.timeout(10_000),
        }
      );
      if (!response.ok) {
        failed += 1;
        console.log(`Epure sourcemap upload failed (${response.status}): ${relative}`);
        continue;
      }
      uploaded += 1;
    } catch {
      failed += 1;
      console.log(`Epure sourcemap upload failed (network): ${relative}`);
    }
  }
  console.log(`Epure sourcemaps: ${uploaded} uploaded, ${oversized} oversized, ${unsupported} unsupported, ${failed} failed.`);
};

await main();
