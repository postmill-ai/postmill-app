import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockFetch = vi.fn();
const mockShow = vi.fn();
const mockDeleteDialog = vi.fn();

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));

vi.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mockShow }),
}));

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

import { SeparatePost } from './separate.post';

describe('SeparatePost (4.6f)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('always clears loading + toasts when the response is not ok', async () => {
    mockDeleteDialog.mockResolvedValue(true);
    // A non-JSON error response: `useFetch` does not throw, so `res.ok` is the
    // only signal — and `.json()` would blow up on a non-JSON body.
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => {
        throw new Error('not json');
      },
    });
    const changeLoading = vi.fn();
    const merge = vi.fn();

    render(
      <SeparatePost
        posts={['a', 'b']}
        len={2}
        merge={merge}
        changeLoading={changeLoading}
      />
    );

    fireEvent.click(screen.getByText('Separate post to multiple posts'));

    await waitFor(() => {
      expect(changeLoading).toHaveBeenCalledWith(false);
    });
    expect(changeLoading).toHaveBeenCalledWith(true);
    expect(merge).not.toHaveBeenCalled();
    expect(mockShow).toHaveBeenCalledWith(expect.any(String), 'warning');
  });

  it('merges the returned posts and clears loading on success', async () => {
    mockDeleteDialog.mockResolvedValue(true);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ posts: ['x', 'y'] }),
    });
    const changeLoading = vi.fn();
    const merge = vi.fn();

    render(
      <SeparatePost
        posts={['a']}
        len={1}
        merge={merge}
        changeLoading={changeLoading}
      />
    );

    fireEvent.click(screen.getByText('Separate post to multiple posts'));

    await waitFor(() => {
      expect(merge).toHaveBeenCalledWith(['x', 'y']);
    });
    expect(changeLoading).toHaveBeenLastCalledWith(false);
    expect(mockShow).not.toHaveBeenCalled();
  });

  it('does nothing when the confirm dialog is dismissed', async () => {
    mockDeleteDialog.mockResolvedValue(false);
    const changeLoading = vi.fn();
    const merge = vi.fn();

    render(
      <SeparatePost
        posts={['a']}
        len={1}
        merge={merge}
        changeLoading={changeLoading}
      />
    );

    fireEvent.click(screen.getByText('Separate post to multiple posts'));

    await waitFor(() => {
      expect(mockDeleteDialog).toHaveBeenCalled();
    });
    expect(changeLoading).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
