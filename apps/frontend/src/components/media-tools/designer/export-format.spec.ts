import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DesignerExportError,
  EXPORT_REQUEST_TIMEOUT_MS,
  MAX_UPLOAD_BYTES,
  RENDER_RETRY_BACKOFF_MS,
  renderOutputWithFallback,
  renderWithFormatFallback,
  runStaticExportBatch,
  uploadExportBlob,
  type StaticExportTask,
} from './export-format';

const blob = (size: number): Blob => ({ size }) as Blob;
const responseBlob = (size: number) => new Response(new Uint8Array(size));

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('renderWithFormatFallback', () => {
  it('keeps PNG selected while reducing scale', async () => {
    const render = vi.fn()
      .mockResolvedValueOnce(blob(MAX_UPLOAD_BYTES + 1))
      .mockResolvedValueOnce(blob(100));

    const result = await renderWithFormatFallback('png', 0.92, 3, render);

    expect(result.usedFormat).toBe('png');
    expect(result.usedScale).toBe(2);
    expect(result.usedQuality).toBe(0.92);
    expect(render.mock.calls.map(([format]) => format)).toEqual(['png', 'png']);
    expect(render).toHaveBeenNthCalledWith(2, 'png', 0.92, 2);
  });

  it('reduces JPEG quality before reducing scale', async () => {
    const render = vi.fn()
      .mockResolvedValueOnce(blob(MAX_UPLOAD_BYTES + 1))
      .mockResolvedValueOnce(blob(100));

    const result = await renderWithFormatFallback('jpeg', 0.92, 3, render);

    expect(result.usedFormat).toBe('jpeg');
    expect(result.usedQuality).toBe(0.7);
    expect(result.usedScale).toBe(3);
    expect(render).toHaveBeenNthCalledWith(2, 'jpeg', 0.7, 3);
  });

  it('keeps transparent PNG selected down to 1x', async () => {
    const render = vi.fn()
      .mockResolvedValueOnce(blob(MAX_UPLOAD_BYTES + 1))
      .mockResolvedValueOnce(blob(MAX_UPLOAD_BYTES + 1))
      .mockResolvedValueOnce(blob(100));

    const result = await renderWithFormatFallback('transparent', 0.92, 3, render);

    expect(result.usedFormat).toBe('transparent');
    expect(result.usedScale).toBe(1);
    expect(render.mock.calls.map(([format]) => format)).toEqual([
      'transparent',
      'transparent',
      'transparent',
    ]);
  });

  it('fails with an actionable message instead of substituting JPEG', async () => {
    const render = vi.fn().mockResolvedValue(blob(MAX_UPLOAD_BYTES + 1));

    await expect(renderWithFormatFallback('png', 0.92, 3, render)).rejects.toThrow(
      'Could not reduce PNG under 10 MB. Choose a smaller scale or JPEG.'
    );
    expect(render).toHaveBeenCalledTimes(3);
    expect(render.mock.calls.every(([format]) => format === 'png')).toBe(true);
  });
});

describe('renderOutputWithFallback', () => {
  const doc = { mode: 'image', outputs: [] } as any;
  const output = { id: 'out-1', width: 1080, height: 1350, children: [] } as any;

  it('renders transparent PNG through the server with only the selected output', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(blob(100)));
    await renderOutputWithFallback(doc, output, 'transparent', 0.92, 0.25, fetchFn);

    const [path, init] = fetchFn.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(path).toBe('/media/designs/render');
    expect(init.method).toBe('POST');
    expect(body).toMatchObject({
      outputIndex: 0,
      pageNumber: 0,
      format: 'png',
      quality: 0.92,
      pixelRatio: 0.25,
      transparent: true,
    });
    expect(body.doc.outputs).toEqual([output]);
  });

  it('preserves JPEG while reducing quality before scale', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(responseBlob(MAX_UPLOAD_BYTES + 1))
      .mockResolvedValueOnce(responseBlob(100));
    const result = await renderOutputWithFallback(doc, output, 'jpeg', 0.92, 3, fetchFn);
    const qualities = fetchFn.mock.calls.map(([, init]) => JSON.parse(init.body).quality);
    const scales = fetchFn.mock.calls.map(([, init]) => JSON.parse(init.body).pixelRatio);

    expect(result.usedFormat).toBe('jpeg');
    expect(qualities).toEqual([0.92, 0.7]);
    expect(scales).toEqual([3, 3]);
  });

  it('keeps JPEG at 3x when the actual blob is within the upload limit', async () => {
    const fetchFn = vi.fn().mockResolvedValue(responseBlob(MAX_UPLOAD_BYTES));

    const result = await renderOutputWithFallback(doc, output, 'jpeg', 0.92, 3, fetchFn);

    expect(result.usedScale).toBe(3);
    expect(result.usedQuality).toBe(0.92);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toMatchObject({
      format: 'jpeg',
      quality: 0.92,
      pixelRatio: 3,
    });
  });

  it('uses a safe HTTP error and does not blindly retry a 500', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message: 'render unavailable with /uploads/private-image.png',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    }));

    const promise = renderOutputWithFallback(doc, output, 'png', 0.92, 1, fetchFn);
    await expect(promise).rejects.toThrow('Render failed with HTTP 500');
    await expect(promise).rejects.not.toThrow('/uploads/private-image.png');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('render request reliability', () => {
  const doc = { mode: 'image', outputs: [], prompt: 'do not log this prompt' } as any;
  const output = {
    id: 'out-private',
    width: 1080,
    height: 1350,
    children: [{ src: 'https://assets.example.com/private.png' }],
  } as any;

  it('retries a network throw once with backoff and then succeeds', async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch (api.postmill.ai)'))
      .mockResolvedValueOnce(responseBlob(100));

    const promise = renderOutputWithFallback(doc, output, 'jpeg', 0.92, 3, fetchFn);
    await vi.advanceTimersByTimeAsync(RENDER_RETRY_BACKOFF_MS);
    const result = await promise;

    expect(result.usedScale).toBe(3);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it.each([400, 500])('does not retry HTTP %i', async (status) => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status }));

    await expect(renderOutputWithFallback(doc, output, 'png', 0.92, 1, fetchFn)).rejects.toMatchObject({
      diagnostic: { kind: 'http', status },
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('bounds a 503 to one retry', async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(responseBlob(100));

    const promise = renderOutputWithFallback(doc, output, 'webp', 0.92, 2, fetchFn);
    await vi.advanceTimersByTimeAsync(RENDER_RETRY_BACKOFF_MS);
    await expect(promise).resolves.toMatchObject({ usedFormat: 'webp' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('distinguishes a timeout from a network failure and retries it once', async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn()
      .mockImplementationOnce((_, init) => new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }))
      .mockResolvedValueOnce(responseBlob(100));

    const promise = renderOutputWithFallback(doc, output, 'png', 0.92, 1, fetchFn);
    await vi.advanceTimersByTimeAsync(EXPORT_REQUEST_TIMEOUT_MS + RENDER_RETRY_BACKOFF_MS);

    await expect(promise).resolves.toMatchObject({ usedFormat: 'png' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('reports a persistent timeout after the bounded retry', async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn().mockImplementation((_, init) => new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));

    const promise = renderOutputWithFallback(doc, output, 'png', 0.92, 1, fetchFn);
    const assertion = expect(promise).rejects.toMatchObject({
      diagnostic: { kind: 'timeout', stage: 'render' },
    });
    await vi.advanceTimersByTimeAsync((EXPORT_REQUEST_TIMEOUT_MS * 2) + RENDER_RETRY_BACKOFF_MS);

    await assertion;
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('does not retry an explicit abort', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchFn = vi.fn();

    await expect(renderOutputWithFallback(doc, output, 'png', 0.92, 1, fetchFn, {
      stage: 'render',
      signal: controller.signal,
    })).rejects.toMatchObject({ diagnostic: { kind: 'abort', stage: 'render' } });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('reports only sanitized preview stage diagnostics', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 400 }));

    await expect(renderOutputWithFallback(doc, output, 'jpeg', 0.92, 0.25, fetchFn, {
      stage: 'preview',
      outputIndex: 1,
      pageNumber: 2,
    })).rejects.toMatchObject({
      diagnostic: {
        stage: 'preview',
        output: 2,
        page: 3,
        format: 'jpeg',
        scale: 0.25,
        status: 400,
        kind: 'http',
      },
    });

    const logged = JSON.stringify(vi.mocked(console.warn).mock.calls);
    expect(logged).toContain('"stage":"preview"');
    expect(logged).not.toContain('do not log this prompt');
    expect(logged).not.toContain('assets.example.com');
    expect(logged).not.toContain('out-private');
  });
});

describe('upload and resumable static batches', () => {
  const makeTask = (outputId: string, render = vi.fn().mockResolvedValue(new Blob(['rendered']))): StaticExportTask => ({
    key: `${outputId}:page:0`,
    outputId,
    outputIndex: Number(outputId.replace(/\D/g, '')) || 0,
    pageNumber: 0,
    format: 'jpeg',
    scale: 3,
    fileName: `${outputId}.jpg`,
    render,
  });

  it('classifies upload network failure without an automatic retry or raw URL details', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch (api.postmill.ai)'));
    const formData = new FormData();
    formData.append('file', new Blob(['image']), 'output.jpg');

    await expect(uploadExportBlob('/files/upload-simple', formData, fetchFn, {
      outputIndex: 0,
      pageNumber: 0,
      format: 'jpeg',
      scale: 3,
    })).rejects.toMatchObject({
      message: expect.not.stringContaining('api.postmill.ai'),
      diagnostic: { stage: 'upload', kind: 'network' },
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('keeps completed files and retries a failed upload from its cached blob without duplicates', async () => {
    const renderA = vi.fn().mockResolvedValue(new Blob(['a']));
    const renderB = vi.fn().mockResolvedValue(new Blob(['b']));
    const tasks = [makeTask('out-1', renderA), makeTask('out-2', renderB)];
    const upload = vi.fn()
      .mockResolvedValueOnce({ id: 'file-a', path: '/files/a.jpg' })
      .mockRejectedValueOnce(new Error('upload unavailable'));

    const first = await runStaticExportBatch(tasks, upload);
    expect(first.completed.map((file) => file.id)).toEqual(['file-a']);
    expect(first.failures.map((failure) => failure.outputId)).toEqual(['out-2']);
    expect(first.pendingUploads).toHaveLength(1);

    upload.mockResolvedValueOnce({ id: 'file-b', path: '/files/b.jpg' });
    const retry = await runStaticExportBatch(tasks, upload, first, { retryFailedOnly: true });

    expect(retry.completed.map((file) => file.id)).toEqual(['file-a', 'file-b']);
    expect(new Set(retry.completed.map((file) => file.key)).size).toBe(2);
    expect(retry.failures).toEqual([]);
    expect(retry.pendingUploads).toEqual([]);
    expect(renderA).toHaveBeenCalledTimes(1);
    expect(renderB).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(3);
  });

  it('retries only the requested failed output and preserves other results', async () => {
    const tasks = [makeTask('out-1'), makeTask('out-2'), makeTask('out-3')];
    const upload = vi.fn()
      .mockResolvedValueOnce({ id: 'file-a', path: '/files/a.jpg' })
      .mockRejectedValueOnce(new Error('failed b'))
      .mockRejectedValueOnce(new Error('failed c'));
    const first = await runStaticExportBatch(tasks, upload);

    upload.mockResolvedValueOnce({ id: 'file-b', path: '/files/b.jpg' });
    const retry = await runStaticExportBatch(tasks, upload, first, {
      retryFailedOnly: true,
      outputId: 'out-2',
    });

    expect(retry.completed.map((file) => file.id)).toEqual(['file-a', 'file-b']);
    expect(retry.failures.map((failure) => failure.outputId)).toEqual(['out-3']);
    expect(tasks[0].render).toHaveBeenCalledTimes(1);
    expect(tasks[1].render).toHaveBeenCalledTimes(1);
    expect(tasks[2].render).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(4);
  });

  it('does not rerender completed pages when another page fails', async () => {
    const firstPage = makeTask('out-1');
    const secondPage = { ...makeTask('out-1'), key: 'out-1:page:1', pageNumber: 1 };
    const upload = vi.fn()
      .mockResolvedValueOnce({ id: 'page-1', path: '/files/page-1.jpg' })
      .mockRejectedValueOnce(new Error('page 2 failed'));
    const first = await runStaticExportBatch([firstPage, secondPage], upload);

    upload.mockResolvedValueOnce({ id: 'page-2', path: '/files/page-2.jpg' });
    const retry = await runStaticExportBatch([firstPage, secondPage], upload, first, {
      retryFailedOnly: true,
      outputId: 'out-1',
    });

    expect(retry.completed.map((file) => file.id)).toEqual(['page-1', 'page-2']);
    expect(firstPage.render).toHaveBeenCalledTimes(1);
    expect(secondPage.render).toHaveBeenCalledTimes(1);
  });
});
