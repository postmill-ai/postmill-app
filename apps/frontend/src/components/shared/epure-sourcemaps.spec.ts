import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd().endsWith(`${path.sep}apps${path.sep}frontend`)
  ? path.resolve(process.cwd(), '../..')
  : process.cwd();
const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dispose) => dispose()));
});

describe('Epure production sourcemap upload', () => {
  it('uploads only current production artifacts and skips unsupported paths', async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'epure-sourcemaps-'));
    cleanup.push(() => fs.rm(temporary, { recursive: true, force: true }));
    const nextDir = path.join(temporary, 'apps/frontend/.next');
    const fixtures = [
      'static/chunks/client.js.map',
      'server/app.js.map',
      'serverless/lambda.js.map',
      'dev/static/chunks/stale.js.map',
      'server/app/(app)/files/[[...path]]/page.js.map',
    ];
    await Promise.all(fixtures.map(async (relative) => {
      const file = path.join(nextDir, relative);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, '{"version":3}');
    }));

    const artifacts: string[] = [];
    const server = http.createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        const name = body.match(/name="name"\r\n\r\n([^\r]+)/)?.[1];
        if (name) artifacts.push(name);
        response.writeHead(201, { 'Content-Type': 'application/json' });
        response.end('{}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing test port');

    const { stdout } = await execFileAsync(
      process.execPath,
      [path.join(repoRoot, 'tools/codegen/upload-epure-sourcemaps.mjs'), '--', 'qa-release'],
      {
        cwd: temporary,
        env: {
          ...process.env,
          NEXT_PUBLIC_EPURE_DSN: `http://qa@127.0.0.1:${address.port}/100012`,
        },
      }
    );

    expect(artifacts.sort()).toEqual([
      '~/_next/server/app.js.map',
      '~/_next/serverless/lambda.js.map',
      '~/_next/static/chunks/client.js.map',
    ]);
    expect(stdout).toContain('3 uploaded, 0 oversized, 1 unsupported, 0 failed');
    expect(stdout).not.toContain('dev/static');
  }, 15000);
});
