import { readFile } from 'fs/promises';
import path from 'path';
import { isSafePublicHttpsUrl } from '@postmill-ai/nestjs-libraries/dtos/webhooks/webhook.url.validator';
import { fromBuffer } from '@postmill-ai/nestjs-libraries/upload/file-type.compat';

/**
 * Inline cap for a locally-stored image handed to a vision model. A `data:`
 * URI rides the request body, so this is a prompt-size bound, not a disk one.
 */
export const VISION_IMAGE_MAX_INLINE_BYTES = 2 * 1024 * 1024;

export interface ResolveVisionImageOptions {
  /** Where a skip/failure is reported. Defaults to silence. */
  warn?: (message: string) => void;
  /** Prefix for the warn lines ("Vision critic", "Focal point"). */
  label?: string;
  /** Max bytes a local file may occupy once inlined. */
  maxInlineBytes?: number;
  /**
   * What to do with a URL that is neither a verified public HTTPS URL nor a
   * local upload.
   *
   * `false` (default) — treat it as unusable and return null. This is the
   * vision critic's policy: it only ever passes URLs it minted itself, so an
   * unrecognized one is a bug worth surfacing.
   *
   * `true` — hand it to the provider unchanged. `detectFocalPoint` takes a URL
   * from a caller that may legitimately hold an http CDN URL, a presigned S3
   * link, or a host this process cannot DNS-resolve but the provider can.
   * Nothing here fetches the URL, so there is no SSRF surface to protect; the
   * only question is provider reachability, and for a remote host the provider
   * is the better judge.
   */
  allowUnverifiedRemote?: boolean;
}

/**
 * Make an image URL readable by an EXTERNAL vision provider.
 *
 * The provider fetches the URL from ITS OWN infrastructure, so anything served
 * off this instance's storage host is unreachable — a self-hosted (or dev)
 * deployment on `http://localhost:4200/uploads/...` failed 100% of vision
 * lookups with "Error while downloading". A local upload is therefore read off
 * disk and inlined as a `data:` URI, which `AIModelProvider` already accepts
 * on the image path.
 *
 * Extracted from the vision critic (round 6 landed this on ONE of the two
 * vision call sites; `detectFocalPoint` kept passing the raw URL) — both
 * callers now share this one implementation rather than a second copy.
 *
 * Returns the usable URL, or `null` when the image is definitively unreadable.
 */
export async function resolveVisionImageUrl(
  url: string,
  options: ResolveVisionImageOptions = {}
): Promise<string | null> {
  const {
    warn = () => undefined,
    label = 'Vision',
    maxInlineBytes = VISION_IMAGE_MAX_INLINE_BYTES,
    allowUnverifiedRemote = false,
  } = options;

  if (typeof url !== 'string' || !url.trim()) return null;

  // Already inline (the AI Designer's contact sheet rides memory as a data
  // URI instead of being persisted to storage on every save). No fetch, no
  // disk read — only the prompt-size bound applies.
  if (/^data:image\//i.test(url)) {
    const payload = url.slice(url.indexOf(',') + 1);
    const bytes = Math.floor((payload.length * 3) / 4);
    if (bytes > maxInlineBytes) {
      warn(`${label}: inlined image too large (${bytes} bytes)`);
      return null;
    }
    return url;
  }

  // A local upload URL is checked FIRST: with SSRF_ALLOWED_PRIVATE_CIDRS opted
  // in, a self-hosted `https://…/uploads/…` can pass the public check and would
  // otherwise be handed to a provider that cannot reach it.
  if (isLocalStorageUrl(url)) {
    try {
      const buffer = await readFile(localPathFromUrl(url));
      if (buffer.length > maxInlineBytes) {
        warn(`${label}: local image too large to inline (${buffer.length} bytes)`);
        return null;
      }
      const detected = await fromBuffer(buffer);
      const mime = detected?.mime || 'image/png';
      return `data:${mime};base64,${buffer.toString('base64')}`;
    } catch (err) {
      warn(`${label} failed to inline local image: ${(err as Error).message}`);
      return null;
    }
  }

  if (await isSafePublicHttpsUrl(url)) {
    return url;
  }

  if (allowUnverifiedRemote) {
    return url;
  }

  warn(`${label} skipping non-public, non-local image URL: ${url}`);
  return null;
}

/**
 * The raw bytes behind an inline-able image URL, for a caller that wants to
 * DOWNSCALE an image `resolveVisionImageUrl` refused for size instead of
 * skipping its vision pass. Only sources this process already holds are
 * readable — a `data:` URI or a local upload (same traversal guard) — a
 * remote URL returns null; nothing here fetches.
 */
export async function loadVisionImageBytes(
  url: string,
  options: Pick<ResolveVisionImageOptions, 'warn' | 'label'> = {}
): Promise<Buffer | null> {
  const { warn = () => undefined, label = 'Vision' } = options;
  if (typeof url !== 'string' || !url.trim()) return null;
  if (/^data:image\//i.test(url)) {
    return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  }
  if (isLocalStorageUrl(url)) {
    try {
      return await readFile(localPathFromUrl(url));
    } catch (err) {
      warn(`${label} failed to read local image: ${(err as Error).message}`);
      return null;
    }
  }
  return null;
}

/** A URL served by this instance's own local upload storage. */
export function isLocalStorageUrl(url: string): boolean {
  const frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
  return (
    (!!frontendUrl && url.startsWith(`${frontendUrl}/uploads/`)) ||
    url.startsWith('/uploads/')
  );
}

/** Resolved path must stay inside UPLOAD_DIRECTORY (traversal guard). */
export function localPathFromUrl(url: string): string {
  const frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
  let key = url;
  if (frontendUrl && key.startsWith(`${frontendUrl}/uploads/`)) {
    key = key.slice(`${frontendUrl}/uploads/`.length);
  } else if (key.startsWith('/uploads/')) {
    key = key.slice('/uploads/'.length);
  }
  const uploadDirectory = path.resolve(process.env.UPLOAD_DIRECTORY || './uploads');
  const decoded = decodeURIComponent(key);
  // Reject traversal BEFORE resolving, not only after. An upload key is a
  // relative storage key — never rooted, never `..`, never NUL-spliced — so a
  // crafted `…/uploads/../../etc/passwd` is refused on its shape rather than
  // relying solely on the prefix check below to catch where it landed.
  const escapes =
    !decoded ||
    decoded.includes('\0') ||
    path.isAbsolute(decoded) ||
    decoded.split(/[\\/]/).includes('..');
  if (escapes) {
    throw new Error(`upload path escapes storage root: ${url}`);
  }
  const resolved = path.resolve(uploadDirectory, decoded);
  if (
    resolved !== uploadDirectory &&
    !resolved.startsWith(uploadDirectory + path.sep)
  ) {
    throw new Error(`upload path escapes storage root: ${url}`);
  }
  return resolved;
}
