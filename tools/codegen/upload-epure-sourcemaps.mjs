import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;

const sourcemapFiles = async (root) => {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await sourcemapFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.map')) files.push(fullPath);
  }
  return files;
};

const main = async () => {
  const release = process.argv[2] || process.env.GITHUB_SHA || process.env.VERCEL_GIT_COMMIT_SHA;
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
  let files = [];
  try {
    files = await sourcemapFiles(nextDir);
  } catch {
    console.log('Epure sourcemaps skipped: frontend .next directory is unavailable.');
    return;
  }

  let uploaded = 0;
  let oversized = 0;
  let failed = 0;
  for (const filePath of files) {
    const relative = path.relative(nextDir, filePath).split(path.sep).join('/');
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_ARTIFACT_BYTES) {
      oversized += 1;
      console.log(`Epure sourcemap skipped (>2 MiB): ${relative}`);
      continue;
    }

    const form = new FormData();
    form.append('name', `~/${relative}`);
    form.append('file', new Blob([await fs.readFile(filePath)], { type: 'application/json' }), path.basename(filePath));
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
  console.log(`Epure sourcemaps: ${uploaded} uploaded, ${oversized} oversized, ${failed} failed.`);
};

await main();
