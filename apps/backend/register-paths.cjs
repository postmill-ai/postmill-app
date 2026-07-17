// Dev runtime path resolver: map @gitroom/* to the COMPILED dist (baseUrl=dist),
// not source .ts. Mirrors nest's intent but with the correct baseUrl so the 144
// provider packages + kernel resolve to dist JS instead of raw TS.
const path = require('path');
const tp = require('tsconfig-paths');
const base = require(path.resolve(__dirname, '../../tsconfig.base.json')).compilerOptions;
tp.register({ baseUrl: path.resolve(__dirname, 'dist'), paths: base.paths });
