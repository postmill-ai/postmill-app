import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AiDesignerPage from './page';

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  show: vi.fn(),
  replace: vi.fn(),
}));

const payloadA = {
  mode: 'prompt',
  prompt: 'Launch',
  config: { channels: ['ig-post'], variants: 1, attachmentFileIds: ['doc-1'] },
};
const payloadB = {
  ...payloadA,
  config: { ...payloadA.config, variants: 2 },
};
let socketCallbacks: {
  onError?: (err: { code?: string; message: string; nonce?: string }) => void;
};

vi.mock('next/navigation', () => ({
  usePathname: () => '/media/ai-designer',
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mocks.show }),
}));
vi.mock('@postmill-ai/frontend/components/media-tools/ai-designer/ai-designer.hooks', () => ({
  useAiDesignerSession: () => ({ data: null, isLoading: false }),
}));
vi.mock('@postmill-ai/frontend/components/media-tools/ai-designer/sessions-drawer', () => ({
  AiDesignerSessionsDrawer: () => null,
}));
vi.mock('@postmill-ai/frontend/components/media-tools/ai-designer/ai-designer-start', () => ({
  AiDesignerStart: ({ onStart }: { onStart: (payload: typeof payloadA) => void }) => (
    <>
      <button onClick={() => onStart(payloadA)}>Start A</button>
      <button onClick={() => onStart(payloadB)}>Start B</button>
    </>
  ),
}));
vi.mock('@postmill-ai/frontend/components/media-tools/ai-designer/use-ai-designer-socket', () => ({
  useAiDesignerSocket: (callbacks: typeof socketCallbacks) => {
    socketCallbacks = callbacks;
    return { start: mocks.start, connected: true, reconnect: vi.fn() };
  },
}));

describe('AI Designer start retry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.start.mockReset();
    mocks.show.mockReset();
    let nextNonce = 0;
    mocks.start.mockImplementation((_payload, nonce?: string) => nonce ?? `nonce-${++nextNonce}`);
  });

  afterEach(() => vi.useRealTimers());

  it('reuses the nonce for an unchanged timeout retry and rotates it for changed input', async () => {
    render(<AiDesignerPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Start A' }));
    expect(mocks.start.mock.calls[0][1]).toBeUndefined();

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    fireEvent.click(screen.getByRole('button', { name: 'Start A' }));
    expect(mocks.start.mock.calls[1][1]).toBe('nonce-1');

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    fireEvent.click(screen.getByRole('button', { name: 'Start B' }));
    expect(mocks.start.mock.calls[2][1]).toBeUndefined();
    expect(mocks.start.mock.results[2].value).toBe('nonce-2');
  });

  it('keeps the pending nonce after a duplicate response and shows no raw code', async () => {
    render(<AiDesignerPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Start A' }));
    act(() => socketCallbacks.onError?.({
      code: 'duplicate_nonce', message: '', nonce: 'nonce-1',
    }));

    expect(mocks.show).toHaveBeenCalledWith(
      'Your previous start is still being processed. Please wait a moment.',
      'warning'
    );
    expect(mocks.show).not.toHaveBeenCalledWith('duplicate_nonce', 'warning');
    fireEvent.click(screen.getByRole('button', { name: 'Start A' }));
    expect(mocks.start.mock.calls[1][1]).toBe('nonce-1');
  });
});
