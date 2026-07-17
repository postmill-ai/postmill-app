/**
 * Runtime resolver for the `@gitroom/provider-*` workspace packages.
 *
 * Background: the backend is built with `nest build` (tsc, `webpack: false`), which does
 * NOT bundle. The Nest CLI path transformer rewrites `@gitroom/<pkg>/<subpath>` imports
 * (wildcard `/*` mappings) to relative paths that resolve to the compiled JS under
 * `dist/libraries/...`, but it leaves BARE package imports (`@gitroom/provider-kernel`,
 * `@gitroom/provider-runway`, …) untouched. At runtime those bare specifiers resolve via
 * `node_modules/@gitroom/provider-*`, whose `package.json` `main` points at the raw
 * TypeScript `src/index.ts` — which Node's ESM loader cannot resolve (extensionless
 * relative re-exports throw `ERR_MODULE_NOT_FOUND`), crashing boot.
 *
 * The provider sources ARE compiled into `dist/libraries/providers/<pkg>/src/*.js` (they
 * are in the tsc program via the import graph). This shim redirects every bare
 * `@gitroom/provider-*` specifier to that already-compiled CommonJS output. It must be the
 * FIRST import in `main.ts` so the patch is installed before any transitive
 * `require('@gitroom/provider-*')` runs (the backend emits CommonJS, so requires execute
 * sequentially).
 *
 * If the compiled file is absent (e.g. dev/ts-node or vitest, where tsconfig `paths`
 * already resolve the source), the shim falls through to Node's normal resolution — so it
 * is a no-op outside the built backend.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require('module');
import { existsSync } from 'fs';
import { isAbsolute, join, resolve, sep } from 'path';

const PREFIX = '@gitroom/provider-';
// dist/apps/backend/src -> dist -> dist/libraries/providers
const providersRoot = resolve(
  join(__dirname, '..', '..', '..', 'libraries', 'providers'),
);

const originalResolve = Module._resolveFilename;

Module._resolveFilename = function (request: string, ...rest: any[]) {
  if (typeof request === 'string' && request.startsWith(PREFIX)) {
    // '@gitroom/provider-kernel'        -> pkg 'kernel',  sub 'index'
    // '@gitroom/provider-kernel/errors' -> pkg 'kernel',  sub 'errors'
    const rel = request.slice(PREFIX.length);

    // PF-02: reject path-traversal or absolute specifiers before touching the
    // filesystem. A specifier like `@gitroom/provider-foo/../../../../etc/passwd`
    // must not escape `providersRoot`.
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
