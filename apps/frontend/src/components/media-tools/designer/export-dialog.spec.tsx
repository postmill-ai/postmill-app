import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { createDesignerStore } from './designer.store';
import { ExportDialog } from './export-dialog';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  render: vi.fn(),
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
      .mockRejectedValueOnce(new Error('Failed to fetch (api.postmill.ai)'));
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
});
