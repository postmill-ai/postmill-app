#!/usr/bin/env node
/*
 * Backend dev orchestrator (hot-reload).
 *
 * Two long-lived children:
 *   1. `nest build --watch` — incremental tsc that emits compiled JS into
 *      apps/backend/dist (driven by nest-cli.json → tsconfig.build.json).
 *   2. `node --watch -r register-paths.cjs dist/.../main.js` — the runtime,
 *      restarted automatically whenever (1) rewrites the dist files it loaded.
 *
 * Why run the COMPILED dist instead of the TS source: the provider kernel and
 * the ~144 `@gitroom/provider-*` workspace packages only resolve correctly
 * against compiled JS. register-paths.cjs maps `@gitroom/*` to dist (baseUrl=dist).
 * A swc-node/ts-node source run trips circular-init order in nestjs-libraries
 * ("Cannot access 'IntegrationService' before initialization"), and `nest start`'s
 * own tsconfig-paths registration resolves the aliases to raw .ts (ESM, fails).
 *
 * We wait for the first compile to emit main.js before starting the runtime, so
 * the deleteOutDir wipe at the start of `nest build --watch` can't race the runner.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const entry = path.join(root, 'dist/apps/backend/src/main.js');
const nestCli = require.resolve('@nestjs/cli/bin/nest.js');
const registerPaths = path.join(root, 'register-paths.cjs');

const children = [];
let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try {
      c.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
  process.exit(code ?? 0);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

function run(cmd, args) {
  const child = spawn(cmd, args, { stdio: 'inherit', cwd: root });
  children.push(child);
  child.on('exit', (code) => shutdown(code ?? 0));
  return child;
}

// Remove any stale entry from a previous run so the poll below can't latch onto
// it and start the runtime before `nest build`'s deleteOutDir wipe + first compile.
try {
  fs.rmSync(entry, { force: true });
} catch {
  /* nothing to clean */
}

// 1) incremental compiler
run(process.execPath, [nestCli, 'build', '--watch', '--preserveWatchOutput']);

// 2) start the watched runtime once the first compile has produced main.js
let started = false;
const poll = setInterval(() => {
  if (started || !fs.existsSync(entry)) return;
  started = true;
  clearInterval(poll);
  // Optional inspector for the manual "Attach to Node.js" workflow. Off by default
  // so it can't collide with WebStorm's own debug injection when you hit Debug on
  // the npm script (that path auto-attaches to this child without a fixed port).
  // Enable with BACKEND_INSPECT=1 (optional BACKEND_INSPECT_PORT, default 9229).
  const inspect = process.env.BACKEND_INSPECT;
  const inspectFlag =
    inspect && inspect !== '0' && inspect !== 'false'
      ? [`--inspect=127.0.0.1:${process.env.BACKEND_INSPECT_PORT || '9229'}`]
      : [];

  console.log('[dev] compiled dist ready → starting backend (node --watch)');
  run(process.execPath, [
    '--watch',
    '--enable-source-maps',
    ...inspectFlag,
    '-r',
    registerPaths,
    entry,
  ]);
}, 500);
