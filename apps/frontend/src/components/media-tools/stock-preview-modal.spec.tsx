import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: vi.fn() }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@postmill-ai/frontend/components/shared/provider-icon', () => ({ default: () => null }));

const mockFetch = vi.fn();
vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));

// Capture whatever the preview opens (the Save-to-Files dialog) so the test can render it.
let opened: React.ReactNode = null;
vi.mock('@postmill-ai/frontend/components/layout/new-modal', () => ({
  useModals: () => ({
    closeAll: vi.fn(),
    openModal: (opts: { children: React.ReactNode }) => {
      opened = opts.children;
    },
  }),
}));

const mockRasterize = vi.fn();
vi.mock('./media-svg', () => ({
  rasterizeSvgUrlToPngBlob: (...args: unknown[]) => mockRasterize(...args),
}));

import { StockPreviewModal } from './stock-preview-modal';

const okJson = (body: unknown) =>
  ({ ok: true, json: async () => body, text: async () => '' }) as unknown as Response;

const iconItem = (source: string) => ({
  id: '123',
  url: source === 'iconify' ? 'https://api.iconify.design/mdi/home.svg' : 'https://cdn.magnific/preview.png',
  thumbUrl: 'https://cdn/thumb.png',
  description: 'home',
  author: 'Someone',
  authorUrl: '',
  width: 24,
  height: 24,
  source,
  prefix: source === 'iconify' ? 'mdi' : 'magnific',
  iconName: 'home',
  license: 'x',
});

async function openSaveAndSubmit(
  item: Record<string, unknown>,
  type: 'icon' | 'vector'
) {
  render(<StockPreviewModal item={item as any} type={type} />);
  fireEvent.click(screen.getByText('Save to Files'));
  cleanup();
  render(<>{opened}</>);
  fireEvent.click(screen.getByText('Save File'));
  await waitFor(() =>
    expect(
      mockFetch.mock.calls.some(([u]) => u === '/files/import' || u === '/files/upload-simple')
    ).toBe(true)
  );
  return mockFetch.mock.calls.find(
    ([u]) => u === '/files/import' || u === '/files/upload-simple'
  )!;
}

beforeEach(() => {
  opened = null;
  mockFetch.mockReset();
  mockFetch.mockImplementation(async () => okJson([]));
  mockRasterize.mockReset();
  mockRasterize.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
});

afterEach(() => cleanup());

describe('StockPreviewModal — Save to Files', () => {
  it('imports a premium content-pack icon server-side with its licensed downloadLocation', async () => {
    const [url, init] = await openSaveAndSubmit(iconItem('magnific'), 'icon');

    expect(url).toBe('/files/import');
    expect(mockRasterize).not.toHaveBeenCalled();
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      source: 'magnific',
      type: 'icon',
      downloadLocation: '123',
      name: 'magnific-magnific-home.png',
    });
  });

  it('imports a premium content-pack SVG vector server-side instead of rasterizing the preview', async () => {
    const [url, init] = await openSaveAndSubmit(
      { ...iconItem('vecteezy'), url: 'https://cdn.vecteezy/preview.svg' },
      'vector'
    );

    expect(url).toBe('/files/import');
    expect(mockRasterize).not.toHaveBeenCalled();
    expect(JSON.parse(init.body)).toMatchObject({ downloadLocation: '123', type: 'vector' });
  });

  it('still rasterizes a free SVG icon and uploads it as a PNG', async () => {
    const [url, init] = await openSaveAndSubmit(iconItem('iconify'), 'icon');

    expect(url).toBe('/files/upload-simple');
    expect(mockRasterize).toHaveBeenCalledWith('https://api.iconify.design/mdi/home.svg', 512);
    const file = (init.body as FormData).get('file') as File;
    expect(file.name).toBe('iconify-mdi-home.png');
  });

  it('names a non-SVG vector import .jpg and a rasterized SVG vector .png', async () => {
    const [, jpgInit] = await openSaveAndSubmit(
      { ...iconItem('pixabay'), url: 'https://cdn.pixabay/v.jpg' },
      'vector'
    );
    expect(JSON.parse(jpgInit.body).name).toBe('pixabay-123.jpg');

    cleanup();
    mockFetch.mockClear();
    const [url, svgInit] = await openSaveAndSubmit(
      { ...iconItem('pixabay'), url: 'https://cdn.pixabay/v.svg' },
      'vector'
    );
    expect(url).toBe('/files/upload-simple');
    expect(((svgInit.body as FormData).get('file') as File).name).toBe('pixabay-123.png');
  });
});
