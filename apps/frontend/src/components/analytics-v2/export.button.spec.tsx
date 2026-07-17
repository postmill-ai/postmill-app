import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockDownload = vi.fn();
const mockShow = vi.fn();
vi.mock('./hooks/useExport', () => ({
  useExport: () => ({ download: mockDownload }),
}));
vi.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mockShow }),
}));
vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}));

import { ExportButton } from './export.button';

describe('ExportButton', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens the menu and exports as CSV with the current filters', async () => {
    mockDownload.mockResolvedValue(undefined);
    render(<ExportButton from="2024-01-01" to="2024-01-07" integrations={['i1']} compare />);

    fireEvent.click(screen.getByText('Export'));
    fireEvent.click(screen.getByText('CSV'));

    await waitFor(() =>
      expect(mockDownload).toHaveBeenCalledWith({
        from: '2024-01-01',
        to: '2024-01-07',
        format: 'csv',
        integrations: ['i1'],
        compare: true,
      })
    );
  });

  it('swallows a failed export without throwing', async () => {
    mockDownload.mockRejectedValue(new Error('boom'));
    render(<ExportButton from="2024-01-01" to="2024-01-07" />);

    fireEvent.click(screen.getByText('Export'));
    fireEvent.click(screen.getByText('JSON'));

    await waitFor(() => expect(mockDownload).toHaveBeenCalled());
    // Button recovers to its idle label after the failure.
    await waitFor(() => expect(screen.getByText('Export')).toBeTruthy());
  });
});
