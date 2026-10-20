import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';

const mockSafeFetch = vi.hoisted(() => vi.fn());
const mockRedis = vi.hoisted(() => ({ get: vi.fn() }));
const mockExecFile = vi.hoisted(() => vi.fn());
const mockFs = vi.hoisted(() => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  rmSync: vi.fn(),
}));

vi.mock('@postmill-ai/nestjs-libraries/dtos/webhooks/safe.fetch', () => ({
  safeFetch: (...args: any[]) => mockSafeFetch(...args),
}));

vi.mock('@postmill-ai/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { get: (...args: any[]) => mockRedis.get(...args) },
}));

vi.mock('child_process', () => ({
  execFile: (...args: any[]) => mockExecFile(...args),
}));

// mkdirSync/writeFileSync/renameSync/rmSync are mocked so the cap tests never
// land 400 MB buffers on disk; statSync/readFileSync stay real for
// resolveRenderAsset fixtures (which use realFs from importActual).
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    mkdirSync: (...args: any[]) => mockFs.mkdirSync(...args),
    writeFileSync: (...args: any[]) => mockFs.writeFileSync(...args),
    renameSync: (...args: any[]) => mockFs.renameSync(...args),
    rmSync: (...args: any[]) => mockFs.rmSync(...args),
  };
});

import {
  collectRemoteRenderMediaUrls,
  preloadRenderMedia,
  resolveRenderAsset,
  renderAssetPath,
  rewriteCompositionMedia,
  RENDER_ASSET_MAX_BYTES,
} from './render-assets';
import { renderWorkDir } from './render-job-spec';
import { mediaJobWebhookToken } from '../media-job-token';

const realFs = await vi.importActual<typeof import('fs')>('fs');

const jobId = 'clzrenderassetspec0000001';
const orgId = 'org-1';

function mockFetchOk(
  body: Buffer,
  contentType = 'video/mp4',
  headers: Record<string, string> = {},
) {
  const map: Record<string, string> = {
    'content-type': contentType,
    'content-length': String(body.byteLength),
    ...headers,
  };
  return {
    ok: true,
    status: 200,
    headers: { get: (n: string) => map[n.toLowerCase()] ?? null },
    arrayBuffer: async () => body,
  };
}

const compositionWith = (srcs: {
  video?: string;
  bg?: string;
  frame?: string;
  audio?: string;
  sameOrigin?: string;
}): any => ({
  width: 1080,
  height: 1920,
  fps: 30,
  durationMs: 5000,
  ...(srcs.bg ? { bg: { type: 'image', src: srcs.bg } } : {}),
  tracks: [
    {
      id: 't1',
      type: 'video',
      clips: [
        { id: 'c1', src: srcs.video },
        ...(srcs.sameOrigin ? [{ id: 'c2', src: srcs.sameOrigin }] : []),
      ],
    },
    ...(srcs.frame
      ? [
          {
            id: 't2',
            type: 'sticker',
            clips: [{ id: 'c3', frames: [{ url: srcs.frame }] }],
          },
        ]
      : []),
    ...(srcs.audio
      ? [{ id: 't3', type: 'audio', clips: [{ id: 'c4', src: srcs.audio }] }]
      : []),
  ],
});

describe('collectRemoteRenderMediaUrls', () => {
  const prev = process.env.NEXT_PUBLIC_BACKEND_URL;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://api.example.com';
  });
  afterEach(() => {
    if (prev == null) delete process.env.NEXT_PUBLIC_BACKEND_URL;
    else process.env.NEXT_PUBLIC_BACKEND_URL = prev;
  });

  it('keeps off-origin https URLs, skips same-origin/relative/data/audio, dedupes', () => {
    const comp = compositionWith({
      video: 'https://videos.pexels.com/a.mp4',
      bg: 'https://cdn.example.com/bg.png',
      frame: 'https://cdn.example.com/f.png',
      audio: 'https://cdn.example.com/song.mp3',
      sameOrigin: 'https://api.example.com/uploads/stored.mp4',
    });
    comp.tracks[0].clips.push({ id: 'c5', src: 'https://videos.pexels.com/a.mp4' });
    comp.tracks[0].clips.push({ id: 'c6', src: '/uploads/relative.png' });
    comp.tracks[0].clips.push({ id: 'c7', src: 'data:image/png;base64,AAAA' });
    comp.tracks[0].clips.push({ id: 'c8', src: 'http://insecure.example.com/x.mp4' });

    expect(collectRemoteRenderMediaUrls(comp)).toEqual([
      'https://cdn.example.com/bg.png',
      'https://videos.pexels.com/a.mp4',
      'https://cdn.example.com/f.png',
    ]);
  });
});

describe('rewriteCompositionMedia', () => {
  it('swaps clip.src, bg.src and frame.url, leaves audio tracks and the input untouched', () => {
    const comp = compositionWith({
      video: 'https://cdn.example.com/a.mp4',
      bg: 'https://cdn.example.com/bg.png',
      frame: 'https://cdn.example.com/f.png',
      audio: 'https://cdn.example.com/song.mp3',
    });
    const replacements = new Map([
      ['https://cdn.example.com/a.mp4', '/media/designs/render-asset/j/asset-0.mp4?token=t'],
      ['https://cdn.example.com/bg.png', '/media/designs/render-asset/j/asset-1.png?token=t'],
      ['https://cdn.example.com/f.png', '/media/designs/render-asset/j/asset-2.png?token=t'],
    ]);

    const out = rewriteCompositionMedia(comp, replacements);

    expect(out.tracks[0].clips[0].src).toBe('/media/designs/render-asset/j/asset-0.mp4?token=t');
    expect(out.bg.src).toBe('/media/designs/render-asset/j/asset-1.png?token=t');
    expect(out.tracks[1].clips[0].frames[0].url).toBe('/media/designs/render-asset/j/asset-2.png?token=t');
    // Audio srcs are never rewritten — the mixer downloads them host-side.
    expect(out.tracks[2].clips[0].src).toBe('https://cdn.example.com/song.mp3');
    // The stored composition object is never mutated.
    expect(comp.tracks[0].clips[0].src).toBe('https://cdn.example.com/a.mp4');
  });
});

describe('preloadRenderMedia', () => {
  let token: string;
  const prev = process.env.NEXT_PUBLIC_BACKEND_URL;

  const execFileOk = () =>
    mockExecFile.mockImplementation((...args: any[]) => {
      const callback = args[args.length - 1] as (
        err: Error | null,
        stdout: string,
        stderr: string,
      ) => void;
      callback(null, '', '');
    });

  beforeEach(() => {
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://api.example.com';
    token = mediaJobWebhookToken(jobId, orgId);
    mockSafeFetch.mockReset();
    mockExecFile.mockReset();
    execFileOk();
    mockFs.mkdirSync.mockClear();
    mockFs.writeFileSync.mockClear();
    mockFs.renameSync.mockClear();
    mockFs.rmSync.mockClear();
  });

  afterEach(() => {
    if (prev == null) delete process.env.NEXT_PUBLIC_BACKEND_URL;
    else process.env.NEXT_PUBLIC_BACKEND_URL = prev;
  });

  it('downloads remote media into the job assets dir and rewrites srcs to the token-gated route', async () => {
    const comp = compositionWith({
      video: 'https://videos.pexels.com/a.mp4',
      bg: 'https://cdn.example.com/bg.png',
      audio: 'https://cdn.example.com/song.mp3',
      sameOrigin: 'https://api.example.com/uploads/stored.mp4',
    });
    mockSafeFetch.mockImplementation(async (url: string) =>
      url.includes('pexels')
        ? mockFetchOk(Buffer.from('video-bytes'), 'video/mp4')
        : mockFetchOk(Buffer.from('png-bytes'), 'image/png'),
    );

    const result = await preloadRenderMedia({ jobId, composition: comp, token });

    expect(result.downloaded).toBe(2);
    expect(mockSafeFetch).toHaveBeenCalledTimes(2);
    const assetsDir = path.join(renderWorkDir(jobId), 'assets');
    // collectCompositionMediaUrls yields the bg image before track clips.
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      path.join(assetsDir, 'asset-0.png'),
      expect.any(Buffer),
    );
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      path.join(assetsDir, 'asset-1.mp4'),
      expect.any(Buffer),
    );
    // The manifest maps each file name to its downloaded content-type.
    const manifestCall = mockFs.writeFileSync.mock.calls.find(
      (c) => String(c[0]).endsWith('manifest.json'),
    );
    expect(manifestCall).toBeDefined();
    expect(JSON.parse(String(manifestCall![1]))).toEqual({
      'asset-0.png': 'image/png',
      'asset-1.mp4': 'video/mp4',
    });

    expect(result.composition.bg.src).toBe(renderAssetPath(jobId, 'asset-0.png', token));
    expect(result.composition.tracks[0].clips[0].src).toBe(
      renderAssetPath(jobId, 'asset-1.mp4', token),
    );
    // Same-origin and audio srcs pass through untouched.
    expect(result.composition.tracks[0].clips[1].src).toBe(
      'https://api.example.com/uploads/stored.mp4',
    );
    expect(result.composition.tracks[1].clips[0].src).toBe('https://cdn.example.com/song.mp3');
    // Rewritten URLs are root-relative same-origin paths carrying the job token.
    expect(result.composition.bg.src).toMatch(/^\/media\/designs\/render-asset\/.+\?token=.+/);
  });

  it('remuxes a downloaded video asset to faststart (stream copy, atomic rename)', async () => {
    const comp = compositionWith({ video: 'https://cdn.example.com/clip.mp4' });
    mockSafeFetch.mockResolvedValue(mockFetchOk(Buffer.from('video-bytes'), 'video/mp4'));

    const result = await preloadRenderMedia({ jobId, composition: comp, token });

    expect(result.downloaded).toBe(1);
    const assetsDir = path.join(renderWorkDir(jobId), 'assets');
    const filePath = path.join(assetsDir, 'asset-0.mp4');
    const tmpPath = path.join(assetsDir, 'asset-0.faststart-tmp.mp4');
    expect(mockExecFile).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = mockExecFile.mock.calls[0];
    expect(cmd).toBe('ffmpeg');
    expect(args).toEqual([
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      filePath,
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      tmpPath,
    ]);
    expect(opts).toMatchObject({ timeout: 60_000 });
    // The remuxed temp atomically replaces the original download.
    expect(mockFs.renameSync).toHaveBeenCalledWith(tmpPath, filePath);
    expect(result.composition.tracks[0].clips[0].src).toBe(
      renderAssetPath(jobId, 'asset-0.mp4', token),
    );
  });

  it('keeps the original file (and the job alive) when the faststart remux fails', async () => {
    const comp = compositionWith({ video: 'https://cdn.example.com/clip.mp4' });
    mockSafeFetch.mockResolvedValue(mockFetchOk(Buffer.from('video-bytes'), 'video/mp4'));
    mockExecFile.mockImplementation((...args: any[]) => {
      const callback = args[args.length - 1] as (
        err: Error | null,
        stdout: string,
        stderr: string,
      ) => void;
      callback(new Error('spawn ffmpeg ENOENT'), '', 'ffmpeg: not found');
    });

    const result = await preloadRenderMedia({ jobId, composition: comp, token });

    // The download still lands and the src is still rewritten — the render
    // degrades to the pre-faststart behavior instead of failing.
    expect(result.downloaded).toBe(1);
    expect(result.composition.tracks[0].clips[0].src).toBe(
      renderAssetPath(jobId, 'asset-0.mp4', token),
    );
    expect(mockFs.renameSync).not.toHaveBeenCalled();
    // The orphaned temp file is cleaned up best-effort.
    const assetsDir = path.join(renderWorkDir(jobId), 'assets');
    expect(mockFs.rmSync).toHaveBeenCalledWith(
      path.join(assetsDir, 'asset-0.faststart-tmp.mp4'),
      { force: true },
    );
  });

  it('never remuxes a non-video asset', async () => {
    const comp = compositionWith({ bg: 'https://cdn.example.com/bg.png' });
    mockSafeFetch.mockResolvedValue(mockFetchOk(Buffer.from('png-bytes'), 'image/png'));

    const result = await preloadRenderMedia({ jobId, composition: comp, token });

    expect(result.downloaded).toBe(1);
    expect(mockExecFile).not.toHaveBeenCalled();
    expect(mockFs.renameSync).not.toHaveBeenCalled();
  });

  it('passes the composition through untouched when nothing is remote', async () => {
    const comp = compositionWith({ sameOrigin: 'https://api.example.com/uploads/x.mp4' });
    const result = await preloadRenderMedia({ jobId, composition: comp, token });
    expect(result).toEqual({ composition: comp, downloaded: 0, bytes: 0 });
    expect(mockSafeFetch).not.toHaveBeenCalled();
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });

  it('fails the job fast on a download error instead of rendering black', async () => {
    const comp = compositionWith({ video: 'https://cdn.example.com/gone.mp4' });
    mockSafeFetch.mockResolvedValue({
      ok: false,
      status: 503,
      headers: { get: () => null },
      arrayBuffer: async () => Buffer.alloc(0),
    });

    await expect(
      preloadRenderMedia({ jobId, composition: comp, token }),
    ).rejects.toThrow('Render media download failed (503): https://cdn.example.com/gone.mp4');
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });

  it('rejects a clip whose declared content-length exceeds the 500 MB cap before reading the body', async () => {
    const comp = compositionWith({ video: 'https://cdn.example.com/huge.mp4' });
    const arrayBuffer = vi.fn();
    mockSafeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: (n: string) =>
          n.toLowerCase() === 'content-length'
            ? String(RENDER_ASSET_MAX_BYTES + 1)
            : 'video/mp4',
      },
      arrayBuffer,
    });

    await expect(
      preloadRenderMedia({ jobId, composition: comp, token }),
    ).rejects.toThrow(/500 MB per-clip limit/);
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });

  it('rejects a clip whose downloaded bytes exceed the 500 MB cap (lying content-length)', async () => {
    const comp = compositionWith({ video: 'https://cdn.example.com/huge.mp4' });
    mockSafeFetch.mockResolvedValue(
      mockFetchOk(Buffer.alloc(RENDER_ASSET_MAX_BYTES + 1), 'video/mp4', {
        'content-length': '1024',
      }),
    );

    await expect(
      preloadRenderMedia({ jobId, composition: comp, token }),
    ).rejects.toThrow(/500 MB per-clip limit/);
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });

  it('enforces the 1 GB total cap across clips', async () => {
    const comp: any = {
      width: 1080,
      height: 1920,
      fps: 30,
      durationMs: 5000,
      tracks: [
        {
          id: 't1',
          type: 'video',
          clips: [0, 1, 2].map((i) => ({
            id: `c${i}`,
            src: `https://cdn.example.com/${i}.mp4`,
          })),
        },
      ],
    };
    mockSafeFetch.mockResolvedValue(mockFetchOk(Buffer.alloc(400 * 1024 * 1024)));

    await expect(
      preloadRenderMedia({ jobId, composition: comp, token }),
    ).rejects.toThrow('Render media exceeds the 1 GB total limit');
  });
});

describe('resolveRenderAsset (token gating)', () => {
  let token: string;
  const assetsDir = path.join(renderWorkDir(jobId), 'assets');

  beforeEach(() => {
    token = mediaJobWebhookToken(jobId, orgId);
    mockRedis.get.mockReset();
    mockRedis.get.mockResolvedValue(
      JSON.stringify({ organizationId: orgId, composition: {} }),
    );
    realFs.mkdirSync(assetsDir, { recursive: true });
    realFs.writeFileSync(path.join(assetsDir, 'asset-0.mp4'), Buffer.from('video-bytes'));
    realFs.writeFileSync(
      path.join(assetsDir, 'manifest.json'),
      JSON.stringify({ 'asset-0.mp4': 'video/mp4' }),
    );
  });

  afterEach(() => {
    realFs.rmSync(renderWorkDir(jobId), { recursive: true, force: true });
  });

  it('resolves a valid token to the asset file with the manifest content-type', async () => {
    const result = await resolveRenderAsset(jobId, 'asset-0.mp4', token);
    expect(result).toEqual({
      status: 'ok',
      filePath: path.join(assetsDir, 'asset-0.mp4'),
      contentType: 'video/mp4',
      size: Buffer.byteLength('video-bytes'),
    });
    expect(mockRedis.get).toHaveBeenCalledWith(`video-render:payload:${jobId}`);
  });

  it('rejects a missing or wrong token without serving bytes', async () => {
    await expect(resolveRenderAsset(jobId, 'asset-0.mp4', '')).resolves.toEqual({
      status: 'forbidden',
    });
    await expect(resolveRenderAsset(jobId, 'asset-0.mp4', 'nope')).resolves.toEqual({
      status: 'forbidden',
    });
    // A token minted for a different job/org never opens this job's assets.
    const foreign = mediaJobWebhookToken('job-other', orgId);
    await expect(resolveRenderAsset(jobId, 'asset-0.mp4', foreign)).resolves.toEqual({
      status: 'forbidden',
    });
  });

  it('404s when the render payload is gone (render concluded)', async () => {
    mockRedis.get.mockResolvedValue(null);
    await expect(resolveRenderAsset(jobId, 'asset-0.mp4', token)).resolves.toEqual({
      status: 'not-found',
    });
  });

  it('serves only asset-N.ext names — traversal and the manifest itself 404', async () => {
    for (const name of ['../manifest.json', 'manifest.json', '..%2f..%2fetc', 'asset-0.mp4/..', 'job.json']) {
      await expect(resolveRenderAsset(jobId, name, token)).resolves.toEqual({
        status: 'not-found',
      });
    }
    // A non-cuid job id never reaches the filesystem either.
    await expect(resolveRenderAsset('../../etc', 'asset-0.mp4', token)).resolves.toEqual({
      status: 'not-found',
    });
  });

  it('404s a well-formed name the preloader never wrote', async () => {
    await expect(resolveRenderAsset(jobId, 'asset-9.mp4', token)).resolves.toEqual({
      status: 'not-found',
    });
  });

  it('falls back to an extension-derived content-type when the manifest is missing', async () => {
    realFs.rmSync(path.join(assetsDir, 'manifest.json'));
    const result = await resolveRenderAsset(jobId, 'asset-0.mp4', token);
    expect(result).toMatchObject({ status: 'ok', contentType: 'video/mp4' });
  });
});
