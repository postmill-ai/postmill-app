import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockDeleteDialog = vi.fn();

vi.mock('@gitroom/react/helpers/delete.dialog', () => ({
  deleteDialog: (...args: any[]) => mockDeleteDialog(...args),
}));

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (key: string, fallback?: string) => fallback || key,
}));

vi.mock('@gitroom/react/form/button', () => ({
  Button: ({ children, onClick }: any) => (
    <button onClick={onClick}>{children}</button>
  ),
}));

import { MergePost } from './merge.post';

describe('MergePost (4.6f)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('merges once the confirm dialog is approved', async () => {
    mockDeleteDialog.mockResolvedValue(true);
    const merge = vi.fn();
    render(<MergePost merge={merge} />);

    fireEvent.click(screen.getByText('Merge comments into one post'));

    await waitFor(() => {
      expect(merge).toHaveBeenCalled();
    });
    // Confirm strings are routed through t() (fallback English shown here).
    expect(mockDeleteDialog).toHaveBeenCalledWith(
      expect.stringContaining('merge all comments'),
      'Yes'
    );
  });

  it('does not merge when the dialog is dismissed', async () => {
    mockDeleteDialog.mockResolvedValue(false);
    const merge = vi.fn();
    render(<MergePost merge={merge} />);

    fireEvent.click(screen.getByText('Merge comments into one post'));

    await waitFor(() => {
      expect(mockDeleteDialog).toHaveBeenCalled();
    });
    expect(merge).not.toHaveBeenCalled();
  });
});
