import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import dayjs from 'dayjs';

// deleteDialog always confirms so removeSlot proceeds.
vi.mock('@gitroom/react/helpers/delete.dialog', () => ({
  deleteDialog: vi.fn(() => Promise.resolve(true)),
}));

const fetchMock = vi.fn(() => Promise.resolve({ ok: true }));
vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => fetchMock,
}));

const toastShow = vi.fn();
vi.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: toastShow }),
}));

const closeAll = vi.fn();
vi.mock('@gitroom/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ closeAll }),
}));

vi.mock('react-use-keypress', () => ({ default: () => {} }));

vi.mock('@gitroom/react/helpers/use.prevent.window.unload', () => ({
  usePreventWindowUnload: () => {},
}));

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback?: string) => fallback || _key,
}));

vi.mock('@gitroom/frontend/components/layout/set.timezone', () => ({
  newDayjs: (...args: any[]) => dayjs(...args),
}));

vi.mock('@gitroom/react/form/select', () => ({
  Select: ({ children, value, onChange, name }: any) => (
    <select data-testid={name} value={value} onChange={onChange}>
      {children}
    </select>
  ),
}));

vi.mock('@gitroom/react/form/button', () => ({
  Button: ({ children, onClick }: any) => (
    <button onClick={onClick}>{children}</button>
  ),
}));

vi.mock('@gitroom/frontend/components/ui/icons', () => ({
  TrashIcon: () => <span data-testid="trash" />,
  PlusIcon: () => <span data-testid="plus" />,
  DelayIcon: () => <span data-testid="delay" />,
}));

import { TimeTable } from './time.table';

function integration(times: { time: number }[]) {
  return { id: 'int-1', time: times } as any;
}

describe('TimeTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockResolvedValue({ ok: true } as any);
  });

  // 3.4 — deletion is keyed by the slot value, not the sorted display index.
  it('deletes the correct slot (02:00) and keeps 18:00', async () => {
    // State insertion order: [18:00 (1080), 02:00 (120)]. The list renders sorted
    // ascending by value → row0 = smaller value (02:00), row1 = larger (18:00).
    render(
      <TimeTable integration={integration([{ time: 1080 }, { time: 120 }])} mutate={vi.fn()} />
    );

    let rows = document.querySelectorAll('span.tabular-nums');
    expect(rows.length).toBe(2);
    const survivorText = rows[1].textContent; // 18:00 (larger value)

    // Delete the FIRST rendered row (the smaller value). Under the old index-based
    // bug this removed state[0] (18:00); the fix removes the row's own value.
    const deleteButtons = screen.getAllByTestId('trash');
    fireEvent.click(deleteButtons[0].closest('button')!);

    await waitFor(() => {
      rows = document.querySelectorAll('span.tabular-nums');
      expect(rows.length).toBe(1);
    });
    expect(document.querySelector('span.tabular-nums')?.textContent).toBe(
      survivorText
    );
  });

  // 4.6a — a failed save must not close the modal or claim success.
  it('shows a warning and keeps the modal open when save fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false } as any);
    render(
      <TimeTable integration={integration([{ time: 600 }])} mutate={vi.fn()} />
    );

    fireEvent.click(screen.getByText('Save Changes'));

    await waitFor(() => {
      expect(toastShow).toHaveBeenCalledWith(
        'Failed to save time slots',
        'warning'
      );
    });
    expect(closeAll).not.toHaveBeenCalled();
  });

  it('saves and closes the modal on success', async () => {
    const mutate = vi.fn();
    render(
      <TimeTable integration={integration([{ time: 600 }])} mutate={mutate} />
    );

    fireEvent.click(screen.getByText('Save Changes'));

    await waitFor(() => {
      expect(mutate).toHaveBeenCalled();
    });
    expect(closeAll).toHaveBeenCalled();
  });
});
