// `file-type` renamed its named exports between v16 (`fromBuffer` / `fromFile`)
// and v21 (`fileTypeFromBuffer` / `fileTypeFromFile`). A transitive dependency
// (canvas/pdf render stack) can hoist v21 over our declared ^16.5.4, which made
// every local upload throw `fromBuffer is not a function`. Resolve whichever
// pair the loaded version actually exposes so we work under either major.
import * as fileType from 'file-type';

export type DetectedFileType = { ext: string; mime: string } | undefined;

const ft = fileType as unknown as Record<string, unknown>;

// Resolve lazily and guard each access: a partial test mock of `file-type`
// (e.g. only `fromBuffer`) throws on access of an undefined named export, so
// we never eagerly touch a name that may not exist.
const pick = (...names: string[]): ((...a: any[]) => any) | undefined => {
  for (const name of names) {
    try {
      const fn = ft[name];
      if (typeof fn === 'function') return fn as (...a: any[]) => any;
    } catch {
      // strict module mock with no such export — keep looking.
    }
  }
  return undefined;
};

export const fromBuffer = (
  input: Uint8Array | ArrayBuffer
): Promise<DetectedFileType> => {
  const fn = pick('fromBuffer', 'fileTypeFromBuffer');
  return fn ? fn(input) : Promise.resolve(undefined);
};

export const fromFile = (path: string): Promise<DetectedFileType> => {
  const fn = pick('fromFile', 'fileTypeFromFile');
  return fn ? fn(path) : Promise.resolve(undefined);
};
