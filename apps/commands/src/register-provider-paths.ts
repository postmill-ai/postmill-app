/**
 * Runtime resolver for the `@postmill-ai/provider-*` workspace packages.
 *
 * Same shim as apps/backend/src/register-provider-paths.ts, duplicated for the
 * commands app: `nest build` does not bundle, bare `@postmill-ai/provider-*`
 * specifiers would otherwise resolve to the raw TypeScript `src/index.ts` under
 * node_modules (which Node refuses to type-strip under node_modules), crashing
 * the CLI. Redirects to the already-compiled `dist/libraries/providers/<pkg>`
 * output. Must be the FIRST import in `main.ts`. No-op when the compiled file is
 * absent (dev/ts-node/vitest, where tsconfig paths resolve the source).
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require('module');
import { existsSync } from 'fs';
import { isAbsolute, join, resolve, sep } from 'path';

const PREFIX = '@postmill-ai/provider-';
// dist/apps/commands/src -> dist -> dist/libraries/providers
const providersRoot = resolve(
  join(__dirname, '..', '..', '..', 'libraries', 'providers'),
);

const originalResolve = Module._resolveFilename;

Module._resolveFilename = function (request: string, ...rest: any[]) {
  if (typeof request === 'string' && request.startsWith(PREFIX)) {
    // '@postmill-ai/provider-kernel'        -> pkg 'kernel',  sub 'index'
    // '@postmill-ai/provider-kernel/errors' -> pkg 'kernel',  sub 'errors'
    const rel = request.slice(PREFIX.length);

    // Reject path-traversal or absolute specifiers before touching the filesystem.
    if (!rel || isAbsolute(rel) || rel.includes('..')) {
      throw new Error(`Invalid provider specifier: ${request}`);
    }

    const slash = rel.indexOf('/');
    const pkg = slash === -1 ? rel : rel.slice(0, slash);
    const sub = slash === -1 ? 'index' : rel.slice(slash + 1);
    const base = join(providersRoot, pkg, 'src', sub);
    const resolved = resolve(base);
    if (!resolved.startsWith(providersRoot + sep)) {
      throw new Error(`Invalid provider specifier: ${request}`);
    }

    for (const candidate of [`${base}.js`, join(base, 'index.js')]) {
      if (existsSync(candidate)) {
        return originalResolve.call(this, candidate, ...rest);
      }
    }
  }
  return originalResolve.call(this, request, ...rest);
};
