import { NextRequest, NextResponse } from 'next/server';
import { createReadStream, realpathSync, statSync } from 'fs';
import { resolve, sep } from 'path';
// @ts-ignore
import mime from 'mime';
async function* nodeStreamToIterator(stream: any) {
  for await (const chunk of stream) {
    yield chunk;
  }
}
function iteratorToStream(iterator: any) {
  return new ReadableStream({
    async pull(controller) {
      const { value, done } = await iterator.next();
      if (done) {
        controller.close();
      } else {
        controller.enqueue(new Uint8Array(value));
      }
    },
  });
}
// Canonical (symlink-resolved) upload root, memoized lazily once per root so
// the symlink containment check below compares canonical paths. Keyed by the
// configured root so an env change (tests) re-resolves.
let cachedRealRoot: { root: string; real: string } | undefined;
const realRootFor = (root: string) => {
  if (cachedRealRoot?.root !== root) {
    cachedRealRoot = { root, real: realpathSync(root) };
  }
  return cachedRealRoot.real;
};
export const GET = async (
  request: NextRequest,
  context: {
    params: Promise<{
      path?: string[];
    }>;
  }
) => {
  const { path } = await context.params;
  // No-auth is intentional: /uploads/* is a public bucket with unguessable
  // stored filenames served with immutable cache headers — do not gate it.
  const dir = process.env.UPLOAD_DIRECTORY;
  if (!dir) {
    // Fail closed: an unset upload root must not become a 500 (or a relative
    // "undefined/..." path read).
    return new NextResponse('Not found', { status: 404 });
  }
  const root = resolve(dir);
  const filePath = resolve(root, (path ?? []).join('/'));
  if (filePath !== root && !filePath.startsWith(root + sep)) {
    return new NextResponse('Not found', { status: 404 });
  }
  let fileStats;
  try {
    // Stat before streaming: an ENOENT read stream's unhandled 'error' throws
    // process-level.
    fileStats = statSync(filePath);
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }
  if (!fileStats.isFile()) {
    // Reject directories (EISDIR) and anything that is not a regular file.
    return new NextResponse('Not found', { status: 404 });
  }
  try {
    // resolve() does not follow symlinks: also contain the canonical target
    // inside the canonical root so a planted symlink cannot escape.
    const realPath = realpathSync(filePath);
    const realRoot = realRootFor(root);
    if (realPath !== realRoot && !realPath.startsWith(realRoot + sep)) {
      return new NextResponse('Not found', { status: 404 });
    }
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }
  const response = createReadStream(filePath);
  // Swallow late stream errors (e.g. the file is removed between stat and
  // read) instead of an unhandled process-level throw.
  response.on('error', () => {});
  const contentType = mime.getType(filePath) || 'application/octet-stream';
  const iterator = nodeStreamToIterator(response);
  const webStream = iteratorToStream(iterator);
  return new Response(webStream, {
    headers: {
      'Content-Type': contentType,
      // Set the appropriate content-type header
      'Content-Length': fileStats.size.toString(),
      // Set the content-length header
      'Last-Modified': fileStats.mtime.toUTCString(),
      // Set the last-modified header
      'Cache-Control': 'public, max-age=31536000, immutable', // Example cache-control header
    },
  });
};
