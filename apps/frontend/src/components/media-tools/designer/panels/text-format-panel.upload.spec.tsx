import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { SWRConfig } from 'swr';
import { TextFormatPanel } from './text-format-panel';
import { createDesignerStore, type DesignerElement } from '../designer.store';

/**
 * The upload affordance in the font picker: it must hit the same endpoint the
 * Brand panel uses, reject bad files before any request, and say when an
 * uploaded WOFF2 will not be used in server-rendered exports.
 */

const { mockFetch, mockToast } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockToast: vi.fn(),
}));

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (k: string, d: string, vars?: Record<string, unknown>) =>
      vars ? d.replace(/\{\{(\w+)\}\}/g, (_m, key) => String(vars[key])) : d,
}));

vi.mock('@postmill-ai/frontend/components/layout/user.context', () => ({
  useUser: () => ({ orgId: 'org-1' }),
}));

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));

vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mockToast }),
}));

vi.mock('../fonts', () => ({
  DESIGNER_FONTS: [],
  ensureFontLoaded: () => Promise.resolve(),
}));

vi.mock('../measure-text', () => ({
  fittedFontSize: (el: { fontSize?: number }) => el.fontSize ?? 16,
  measureForElement: () => undefined,
}));

const jsonResponse = (body: unknown, ok = true) => ({
  ok,
  json: async () => body,
});

/** Route the panel's fetches: font list, brand list, upload. */
const installFetch = (fonts: unknown[] = []) => {
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/media/fonts/upload') {
      return jsonResponse({ uploaded: { serverRender: true }, fonts });
    }
    if (url === '/media/fonts') return jsonResponse(fonts);
    return jsonResponse([]);
  });
};

const renderPanel = () => {
  const store = createDesignerStore();
  store.getState().addElement({
    id: '',
    type: 'text',
    x: 0,
    y: 0,
    width: 200,
    height: 40,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    text: 'Hello',
    fontSize: 16,
    fontFamily: 'Inter',
    fill: '#000000',
  } as DesignerElement);
  // A fresh SWR cache per render — the default global cache would carry the
  // previous test's font list across the 2s deduping window.
  const rendered = render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <TextFormatPanel store={store} />
    </SWRConfig>
  );
  return { store, ...rendered };
};

const openPicker = (container: HTMLElement) => {
  const trigger = container.querySelector('#text-font-family');
  expect(trigger).toBeTruthy();
  fireEvent.click(trigger as Element);
};

const pickFile = (container: HTMLElement, file: File) => {
  const input = container.querySelector(
    'input[type="file"]'
  ) as HTMLInputElement;
  expect(input).toBeTruthy();
  fireEvent.change(input, { target: { files: [file] } });
};

describe('TextFormatPanel font picker upload', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockToast.mockClear();
    installFetch();
  });

  afterEach(cleanup);

  it('offers an upload affordance inside the font picker', () => {
    const { container } = renderPanel();
    openPicker(container);
    expect(screen.getByText('+ Upload font (.ttf, .otf, .woff2)')).toBeTruthy();
  });

  it('posts the chosen file to the existing upload endpoint', async () => {
    const { container } = renderPanel();
    openPicker(container);

    const file = new File(['font-bytes'], 'AcmeSans.ttf', {
      type: 'font/ttf',
    });
    pickFile(container, file);

    await waitFor(() => {
      const call = mockFetch.mock.calls.find(
        ([url]) => url === '/media/fonts/upload'
      );
      expect(call).toBeTruthy();
      expect((call![1] as RequestInit).method).toBe('POST');
      const body = (call![1] as RequestInit).body as FormData;
      expect(body.get('file')).toBe(file);
    });
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith('Font uploaded', 'success')
    );
  });

  it('rejects a non-font file before any request leaves', async () => {
    const { container } = renderPanel();
    openPicker(container);
    mockFetch.mockClear();

    pickFile(container, new File(['x'], 'notes.txt'));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        'Invalid file type. Accepted: .ttf, .otf, .woff2',
        'warning'
      )
    );
    expect(
      mockFetch.mock.calls.filter(([url]) => url === '/media/fonts/upload')
    ).toHaveLength(0);
  });

  it('warns when the uploaded WOFF2 will not be server-rendered', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url === '/media/fonts/upload') {
        return jsonResponse({
          uploaded: { family: 'Woff Face', serverRender: false },
          fonts: [],
        });
      }
      return jsonResponse([]);
    });
    const { container } = renderPanel();
    openPicker(container);

    pickFile(container, new File(['x'], 'woff-face.woff2'));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        'Font uploaded. WOFF2 fonts are not used in server-rendered exports.',
        'warning'
      )
    );
  });

  it('notes in the picker when a listed custom font is not server-renderable', async () => {
    installFetch([
      {
        family: 'Woff Face',
        fileId: 'f1',
        path: '/uploads/org-1/woff.woff2',
        weights: [400],
        serverRender: false,
      },
    ]);
    const { container } = renderPanel();
    openPicker(container);

    await waitFor(() =>
      expect(
        screen.getByText('WOFF2 fonts are not used in server-rendered exports')
      ).toBeTruthy()
    );
  });
});
