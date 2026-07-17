import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { parseCsv, BulkImport } from './bulk.import';

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (key: string, fallback?: string) => fallback || key,
}));

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => vi.fn(),
}));

vi.mock('@gitroom/frontend/components/ui/data-table', () => ({
  DataTable: () => <div data-testid="data-table" />,
}));

vi.mock('./useBulkImport', () => ({
  useBulkImport: () => ({
    submit: vi.fn(),
    loading: false,
    results: null,
    error: '',
    reset: vi.fn(),
  }),
}));

afterEach(() => cleanup());

describe('parseCsv (RFC-4180 quoted fields)', () => {
  it('preserves a comma inside a quoted field', () => {
    const rows = parseCsv(
      'content,channel,schedule_at\n"Hello, world",x;linkedin,2026-07-06T10:00'
    );
    expect(rows).toHaveLength(2);
    expect(rows[1][0]).toBe('Hello, world');
    expect(rows[1][1]).toBe('x;linkedin');
    expect(rows[1][2]).toBe('2026-07-06T10:00');
  });

  it('handles escaped double-quotes and embedded newlines', () => {
    const rows = parseCsv('a\n"line1\nline2 ""q"""');
    expect(rows).toHaveLength(2);
    expect(rows[1][0]).toBe('line1\nline2 "q"');
  });

  it('drops blank rows', () => {
    expect(parseCsv('a,b\n\n1,2\n')).toHaveLength(2);
  });
});

describe('BulkImport upload validation', () => {
  const uploadFile = async (container: HTMLElement, contents: string) => {
    const input = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const file = new File([contents], 'test.csv', { type: 'text/csv' });
    fireEvent.change(input, { target: { files: [file] } });
    // FileReader.onload resolves on a microtask/macrotask in jsdom.
    await new Promise((r) => setTimeout(r, 0));
  };

  it('shows an error for a header-less / invalid-header file', async () => {
    const { container } = render(<BulkImport />);
    await uploadFile(container, 'foo,bar\n1,2');
    expect(
      await screen.findByText(/Invalid or missing header/i)
    ).toBeTruthy();
  });

  it('shows an error for an empty file', async () => {
    const { container } = render(<BulkImport />);
    await uploadFile(container, '\n\n');
    expect(await screen.findByText(/file is empty/i)).toBeTruthy();
  });
});
