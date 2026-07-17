import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import React from 'react';
import type { MediaSelectorItem } from '@gitroom/frontend/components/media-tools/media-selector-modal';

const mockFetch = vi.fn();
const mockToasterShow = vi.fn();

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));

vi.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mockToasterShow }),
}));

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}));

vi.mock('@gitroom/frontend/components/settings/brand/use-brands', () => ({
  useBrands: () => ({ data: [] }),
}));

const stockItem: MediaSelectorItem = {
  source: 'stock',
  url: 'https://stock.example/photo.jpg',
  width: 100,
  height: 100,
  type: 'image',
  name: 'Stock Photo',
  stockSource: 'unsplash',
  attribution: { source: 'unsplash' },
  downloadLocation: null,
};

const fileItem: MediaSelectorItem = {
  source: 'file',
  url: '/files/existing.png',
  fileId: 'existing-file-id',
  width: 100,
  height: 100,
  type: 'image',
  name: 'Existing File',
};

vi.mock('@gitroom/frontend/components/media-tools/media-selector-modal', () => ({
  MediaSelectorModal: ({ onConfirm, onSelect }: any) => (
    <div data-testid="media-selector-mock">
      <button data-testid="mock-confirm-stock" onClick={() => onConfirm?.([stockItem])}>
        Confirm stock
      </button>
      <button data-testid="mock-confirm-mixed" onClick={() => onConfirm?.([stockItem, fileItem])}>
        Confirm mixed
      </button>
      <button data-testid="mock-select-stock" onClick={() => onSelect?.(stockItem)}>
        Select stock
      </button>
    </div>
  ),
}));

import { AiDesignerStart } from './ai-designer-start';
import { InteractiveForm } from './interactive-form';
import { useImportStockMedia } from './ai-designer.hooks';

describe('AI Designer stock import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'imported-file-id', path: '/files/imported.png' }),
    });
  });

  describe('useImportStockMedia', () => {
    it('imports a stock item via POST /files/import and returns a real fileId', async () => {
      const { result } = renderHook(() => useImportStockMedia());
      const imported = await result.current(stockItem);

      expect(mockFetch).toHaveBeenCalledWith('/files/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'https://stock.example/photo.jpg',
          name: 'Stock Photo',
          type: 'image',
          source: 'unsplash',
          attribution: { source: 'unsplash' },
        }),
      });
      expect(imported.source).toBe('file');
      expect(imported.fileId).toBe('imported-file-id');
      expect(imported.url).toBe('/files/imported.png');
    });

    it('passes file items through unchanged', async () => {
      const { result } = renderHook(() => useImportStockMedia());
      const imported = await result.current(fileItem);

      expect(mockFetch).not.toHaveBeenCalled();
      expect(imported).toBe(fileItem);
    });
  });

  describe('AiDesignerStart', () => {
    it('imports stock references before submit so referenceFileIds contains real file ids', async () => {
      const onStart = vi.fn();
      render(<AiDesignerStart onStart={onStart} isConnected />);

      fireEvent.click(screen.getByText('Instagram Post'));
      fireEvent.click(screen.getByText('Add reference'));

      expect(screen.getByTestId('media-selector-mock')).toBeTruthy();

      fireEvent.click(screen.getByText('Confirm mixed'));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          '/files/import',
          expect.objectContaining({ method: 'POST' })
        );
      });

      await waitFor(() => {
        expect(screen.getByText('Add reference')).toBeTruthy();
      });

      fireEvent.click(screen.getByText('Start designing'));

      await waitFor(() => {
        expect(onStart).toHaveBeenCalled();
      });

      const payload = onStart.mock.calls[0][0];
      expect(payload.config.referenceFileIds).toEqual(
        expect.arrayContaining(['existing-file-id', 'imported-file-id'])
      );
    });

    it('toasts a warning when stock import fails and does not add a fileId-less reference', async () => {
      mockFetch.mockResolvedValue({ ok: false, text: async () => 'Import denied' });
      const onStart = vi.fn();
      render(<AiDesignerStart onStart={onStart} isConnected />);

      fireEvent.click(screen.getByText('Instagram Post'));
      fireEvent.click(screen.getByText('Add reference'));
      fireEvent.click(screen.getByText('Confirm stock'));

      await waitFor(() => {
        expect(mockToasterShow).toHaveBeenCalledWith('Import denied', 'warning');
      });

      fireEvent.click(screen.getByText('Start designing'));

      await waitFor(() => {
        expect(onStart).toHaveBeenCalled();
      });

      const payload = onStart.mock.calls[0][0];
      expect(payload.config.referenceFileIds).toBeUndefined();
    });
  });

  describe('InteractiveForm', () => {
    it('imports a stock media-pick selection before submit so the field value carries a real fileId', async () => {
      const onSubmit = vi.fn();
      const fields = [
        {
          name: 'hero',
          label: 'Hero image',
          type: 'media-pick',
        } as any,
      ];

      render(<InteractiveForm prompt="Pick a hero" fields={fields} replyTo="r1" onSubmit={onSubmit} />);

      fireEvent.click(screen.getByText('Pick media'));

      expect(screen.getByTestId('media-selector-mock')).toBeTruthy();

      fireEvent.click(screen.getByText('Select stock'));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          '/files/import',
          expect.objectContaining({ method: 'POST' })
        );
      });

      await waitFor(() => {
        expect(screen.getByText('Change media')).toBeTruthy();
      });

      fireEvent.click(screen.getByText('Submit'));

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled();
      });

      const [, values] = onSubmit.mock.calls[0];
      expect(values.hero.fileId).toBe('imported-file-id');
      expect(values.hero.url).toBe('/files/imported.png');
      expect(values.hero.stockSource).toBe('unsplash');
    });
  });
});
