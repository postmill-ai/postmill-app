// Same trick as apps/backend/register-paths.cjs (see the rationale in its
// dev.cjs): map @postmill-ai/* to the COMPILED dist, not source .ts — the
// provider kernel and the ~144 provider packages only resolve against
// compiled JS (their package.json `main` points at raw TS, which Node's ESM
// loader refuses).
const path = require('path');
const tp = require('tsconfig-paths');
const base = require(path.resolve(__dirname, '../../tsconfig.base.json')).compilerOptions;
tp.register({ baseUrl: path.resolve(__dirname, 'dist'), paths: base.paths });
