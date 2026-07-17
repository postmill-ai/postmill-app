import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

// ── Hook mocks ─────────────────────────────────────────────────────────────
const fetchMock = vi.fn();
const showMock = vi.fn();
const pushMock = vi.fn();

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => fetchMock,
}));
vi.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: showMock }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));
vi.mock('@gitroom/frontend/components/launches/calendar.context', () => ({
  CalendarWeekProvider: ({ children }: any) => children,
  useCalendar: () => ({ integrations: [], reloadCalendarView: vi.fn() }),
}));
vi.mock('@gitroom/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ closeAll: vi.fn(), openModal: vi.fn() }),
}));
vi.mock('@gitroom/frontend/components/layout/user.context', () => ({
  useUser: () => ({ tier: { ai: true } }),
}));
vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, def: string) => def,
}));

import { GeneratorPopup } from './generator';

// A ReadableStream-like reader that emits the given NDJSON lines then closes.
function makeReader(lines: string[]) {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    read: vi.fn().mockImplementation(async () => {
      if (i < lines.length) {
        const value = encoder.encode(lines[i]);
        i++;
        return { done: false, value };
      }
      return { done: true, value: undefined };
    }),
  };
}

async function submit() {
  const textbox = screen.getByRole('textbox');
  fireEvent.change(textbox, { target: { value: 'write about anything at all' } });
  const button = await screen.findByRole('button', { name: /generate/i });
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  fireEvent.click(button);
}

describe('Generator wizard (1.3 — no infinite hang on error)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('surfaces a pre-flight 429 budget error as a toast and re-enables the form', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'AI budget exceeded' }),
    });

    render(<GeneratorPopup />);
    await submit();

    await waitFor(() =>
      expect(showMock).toHaveBeenCalledWith('AI budget exceeded', 'warning')
    );
    // Form re-enabled: the submit button is not stuck disabled/loading.
    const button = screen.getByRole('button', { name: /generate/i });
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('surfaces a mid-stream {error} NDJSON line as a toast', async () => {
    const reader = makeReader(['{"error":"boom"}\n']);
    fetchMock.mockResolvedValue({ ok: true, body: { getReader: () => reader } });

    render(<GeneratorPopup />);
    await submit();

    await waitFor(() => expect(showMock).toHaveBeenCalledWith('boom', 'warning'));
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('happy path: streams to completion and navigates without a warning toast', async () => {
    const reader = makeReader([
      '{"name":"post-time","data":{"output":{"content":[{"content":"hello"}],"hook":"H","date":"2026-07-10T09:00:00.000Z"}}}\n',
    ]);
    fetchMock.mockResolvedValue({ ok: true, body: { getReader: () => reader } });

    render(<GeneratorPopup />);
    await submit();

    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(showMock).not.toHaveBeenCalled();
    expect(pushMock.mock.calls[0][0]).toContain('/posts/post?');
  });
});
