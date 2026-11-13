import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { createDesignerStore } from './designer.store';
import { ExportDialog } from './export-dialog';
import { DesignerExportError } from './export-format';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  render: vi.fn(),
  pdf: vi.fn(),
  upload: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => mocks.fetch,
}));
vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mocks.toast }),
}));
vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => {
  const translate = (_key: string, fallback: string, params?: Record<string, unknown>) =>
    Object.entries(params || {}).reduce(
      (text, [key, value]) => text.replaceAll(`{{${key}}}`, String(value)),
      fallback,
    );
  return { useT: () => translate };
});
vi.mock('@postmill-ai/frontend/components/layout/user.context', () => ({
  useUser: () => null,
}));
vi.mock('@postmill-ai/frontend/components/composer/store', () => {
  const state = { selectedIntegrations: [] };
  return {
    useLaunchStore: Object.assign(
      (selector: (value: typeof state) => unknown) => selector(state),
      { getState: () => state },
    ),
  };
});
vi.mock('@postmill-ai/frontend/components/composer/picks.socials.component', () => ({
  PicksSocialsComponent: () => null,
}));
vi.mock('@postmill-ai/frontend/components/shared/provider-icon', () => ({
  default: () => null,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('react-konva', () => ({
  Stage: () => null,
  Layer: () => null,
  Rect: () => null,
  Group: () => null,
}));
vi.mock('./export-format', async (importOriginal) => ({
  ...await importOriginal<typeof import('./export-format')>(),
  renderOutputWithFallback: mocks.render,
  renderPdfWithDiagnostics: mocks.pdf,
  uploadExportBlob: mocks.upload,
}));
vi.mock('./panels/use-brand-colors', () => ({ useBrandColors: () => [] }));
vi.mock('./panels/use-brand-fonts', () => ({ useBrandFonts: () => [] }));
vi.mock('./brand-compliance', () => ({ getBrandViolations: () => [] }));
vi.mock('./design-preflight', () => ({
  analyzeDesignerPreflight: () => ({ findings: [], unassessed: { contrast: 0, text: 0, geometry: 0 } }),
}));
vi.mock('./export-preflight', () => ({ ExportPreflight: () => null }));
vi.mock('./preflight-navigation', () => ({ openDesignerPreflightFinding: vi.fn() }));
vi.mock('./designer', () => ({ getThumbnailDataUrl: vi.fn() }));
vi.mock('./elements', () => ({
  CanvasElements: () => null,
  gradientFillProps: vi.fn(),
  getImageNaturalSize: vi.fn(),
}));
vi.mock('./textures', () => ({ textureFillProps: vi.fn() }));
vi.mock('./export-background', () => ({ ExportBackgroundImage: () => null }));
vi.mock('@postmill-ai/nestjs-libraries/media/designer-doc/svg-export', () => ({
  layersNeedingRaster: () => [],
  outputToSvg: vi.fn(),
  svgBackgroundNeedsRaster: () => false,
}));

const exportError = (stage: 'preview' | 'render' | 'upload', kind: 'http' | 'network', status?: number) =>
  new DesignerExportError({
    stage,
    output: 1,
    page: 1,
    format: 'jpeg',
    scale: 1,
    kind,
    status: status ?? kind,
  });

const makeStore = () => {
  const store = createDesignerStore();
  const first = store.getState().doc.outputs[0];
  store.setState((state) => ({
    doc: {
      ...state.doc,
      outputs: [
        { ...first, id: 'out-a', name: 'A' },
        { ...first, id: 'out-b', name: 'B' },
      ],
    },
  }));
  store.getState().setDesignName('Test');
  return store;
};

beforeEach(() => {
  mocks.fetch.mockReset().mockImplementation(async () => ({ ok: true, json: async () => [] }));
  mocks.render.mockReset().mockImplementation(async (_doc, output, format, quality, scale) => ({
    blob: new Blob([output.id]),
    usedFormat: format,
    usedQuality: quality,
    usedScale: scale,
  }));
  mocks.pdf.mockReset().mockResolvedValue(new Blob(['pdf']));
  mocks.upload.mockReset();
  mocks.toast.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  Object.assign(URL, {
    createObjectURL: vi.fn((blob: Blob) => `blob:${blob.size}`),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ExportDialog previews', () => {
  it('renders one preview per selected output without repeating on rerenders', async () => {
    const store = makeStore();
    const dialog = () => (
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ExportDialog store={store} initialAction="save" onClose={vi.fn()} />
      </SWRConfig>
    );
    const { rerender } = render(dialog());

    fireEvent.click(screen.getByRole('button', { name: 'Next: Choose Folder' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next: Export 2 file' }));

    await screen.findByRole('img', { name: 'Output 2' });
    await waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(2));

    rerender(dialog());
    await waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(2));
  });
});

describe('ExportDialog static export recovery', () => {
  it('preserves a completed output and retries only the failed upload through the UI', async () => {
    mocks.upload
      .mockResolvedValueOnce({ id: 'file-a', path: '/files/a.png' })
      .mockRejectedValueOnce(exportError('upload', 'http', 500));
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ExportDialog store={makeStore()} initialAction="save" onClose={vi.fn()} />
      </SWRConfig>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next: Choose Folder' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next: Export 2 file' }));
    await waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(2));
    mocks.render.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Export 2 file' }));
    expect(await screen.findByText('Some exports need attention')).toBeTruthy();
    expect(await screen.findByRole('link', { name: 'Test - A.jpg' })).toBeTruthy();
    expect(screen.getByText('Completed exports')).toBeTruthy();
    expect(mocks.render).toHaveBeenCalledTimes(2);
    expect(mocks.upload).toHaveBeenCalledTimes(2);

    mocks.upload.mockResolvedValueOnce({ id: 'file-b', path: '/files/b.jpg' });
    fireEvent.click(screen.getByRole('button', { name: 'Retry output' }));

    expect(await screen.findByText('Saved to /files')).toBeTruthy();
    expect(await screen.findByRole('link', { name: 'Test - B.jpg' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Test - A.jpg' })).toBeTruthy();
    expect(mocks.render).toHaveBeenCalledTimes(2);
    expect(mocks.upload).toHaveBeenCalledTimes(3);
  });

  it('invalidates PNG 3x bytes and failures after Back and a JPEG 1x change', async () => {
    mocks.upload.mockRejectedValue(exportError('upload', 'http', 500));
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ExportDialog store={makeStore()} initialAction="save" onClose={vi.fn()} />
      </SWRConfig>,
    );

    for (const select of screen.getAllByRole('combobox')) {
      fireEvent.change(select, { target: { value: 'png' } });
    }
    fireEvent.click(screen.getByRole('button', { name: '3x' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next: Choose Folder' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next: Export 2 file' }));
    await waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(2));
    mocks.render.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Export 2 file' }));
    expect(await screen.findByText('Some exports need attention')).toBeTruthy();
    expect(mocks.render.mock.calls.every((call) => call[2] === 'png' && call[4] === 3)).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    for (const select of screen.getAllByRole('combobox')) {
      fireEvent.change(select, { target: { value: 'jpeg' } });
    }
    fireEvent.click(screen.getByRole('button', { name: '1x' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next: Choose Folder' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next: Export 2 file' }));
    await waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(4));
    mocks.render.mockClear();
    mocks.upload.mockReset().mockImplementation((_endpoint, formData) => {
      const name = (formData.get('file') as File).name;
      return Promise.resolve({ id: `new-${name}`, path: `/files/${name}` });
    });

    expect(screen.queryByRole('button', { name: 'Retry failed' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Export 2 file' }));
    expect(await screen.findByText('Saved to /files')).toBeTruthy();
    const names = mocks.upload.mock.calls.map(([, formData]) => (formData.get('file') as File).name);
    expect(names).toEqual(['Test - A.jpg', 'Test - B.jpg']);
    expect(mocks.render).toHaveBeenCalledTimes(2);
    expect(mocks.render.mock.calls.every((call) => call[2] === 'jpeg' && call[4] === 1)).toBe(true);
  });

  it('clears a stale combined PDF failure when the format changes', async () => {
    mocks.pdf.mockRejectedValue(exportError('render', 'http', 500));
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ExportDialog store={makeStore()} initialAction="save" onClose={vi.fn()} />
      </SWRConfig>,
    );

    for (const select of screen.getAllByRole('combobox')) {
      fireEvent.change(select, { target: { value: 'pdf' } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Next: Choose Folder' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next: Export 2 file' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export 2 file' }));
    expect(await screen.findByText('Some exports need attention')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    for (const select of screen.getAllByRole('combobox')) {
      fireEvent.change(select, { target: { value: 'png' } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Next: Choose Folder' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next: Export 2 file' }));
    await waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(4));
    expect(screen.queryByRole('button', { name: 'Retry failed' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Export 2 file' })).toBeTruthy();
  });

  it('updates progress as each output finishes', async () => {
    let finishFirst!: (value: { id: string; path: string }) => void;
    let finishSecond!: (value: { id: string; path: string }) => void;
    mocks.upload
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { finishSecond = resolve; }));
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ExportDialog store={makeStore()} initialAction="save" onClose={vi.fn()} />
      </SWRConfig>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next: Choose Folder' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next: Export 2 file' }));
    await waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole('button', { name: 'Export 2 file' }));
    expect(await screen.findByRole('button', { name: 'Exporting 0/2…' })).toBeTruthy();
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1));
    finishFirst({ id: 'a', path: '/files/a.jpg' });
    expect(await screen.findByRole('button', { name: 'Exporting 1/2…' })).toBeTruthy();
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(2));
    finishSecond({ id: 'b', path: '/files/b.jpg' });
    expect(await screen.findByText('Saved to /files')).toBeTruthy();
  });

  it('localizes preview stage and retry advice', async () => {
    mocks.render.mockRejectedValue(exportError('preview', 'network'));
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ExportDialog store={makeStore()} initialAction="save" onClose={vi.fn()} />
      </SWRConfig>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next: Choose Folder' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next: Export 2 file' }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(
      'Preview could not reach the server. Check your connection. You can still try the final export.',
      'warning',
    ));
    expect(mocks.render).toHaveBeenCalledTimes(2);
  });

  it('aborts the active render on unmount without starting an upload', async () => {
    const store = makeStore();
    const dialog = render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ExportDialog store={store} initialAction="save" onClose={vi.fn()} />
      </SWRConfig>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next: Choose Folder' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next: Export 2 file' }));
    await waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(2));
    let renderSignal: AbortSignal | undefined;
    mocks.render.mockClear().mockImplementation((_doc, _output, _format, _quality, _scale, _fetch, context) => {
      renderSignal = context.signal;
      return new Promise((_, reject) => {
        context.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Export 2 file' }));
    await waitFor(() => expect(renderSignal).toBeDefined());
    dialog.unmount();
    await waitFor(() => expect(renderSignal?.aborted).toBe(true));
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('lets an active upload settle on unmount and cancels only the remaining queue', async () => {
    let finishUpload!: (value: { id: string; path: string }) => void;
    mocks.upload.mockImplementationOnce(() => new Promise((resolve) => { finishUpload = resolve; }));
    const dialog = render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ExportDialog store={makeStore()} initialAction="save" onClose={vi.fn()} />
      </SWRConfig>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next: Choose Folder' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next: Export 2 file' }));
    await waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(2));
    let renderSignal: AbortSignal | undefined;
    mocks.render.mockClear().mockImplementation(async (_doc, output, format, quality, scale, _fetch, context) => {
      renderSignal = context.signal;
      return { blob: new Blob([output.id]), usedFormat: format, usedQuality: quality, usedScale: scale };
    });

    fireEvent.click(screen.getByRole('button', { name: 'Export 2 file' }));
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1));
    dialog.unmount();
    expect(renderSignal?.aborted).toBe(false);
    finishUpload({ id: 'a', path: '/files/a.jpg' });
    await waitFor(() => expect(renderSignal?.aborted).toBe(true));
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(mocks.render).toHaveBeenCalledTimes(1);
  });
});
