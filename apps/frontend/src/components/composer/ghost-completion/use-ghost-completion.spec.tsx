import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const holder = vi.hoisted(() => ({
  aiActive: true as boolean | undefined,
  enabled: true,
  store: {
    brandId: 'brand-1' as string | null,
    current: 'global',
    locked: false,
    isCreateSet: false,
    internal: [] as any[],
  },
  toastShow: vi.fn(),
  ghostState: { text: null as string | null, from: null as number | null, suppressed: false },
}));

vi.mock('@postmill-ai/react/helpers/variable.context', () => ({
  useVariables: () => ({ backendUrl: 'http://api.test' }),
}));

vi.mock('@postmill-ai/helpers/utils/csrf.header', () => ({
  csrfHeader: () => ({ 'x-csrf-token': 'tok' }),
}));

vi.mock('@postmill-ai/frontend/components/layout/use-ai-active', () => ({
  useAiActive: () => holder.aiActive,
}));

vi.mock('./use-inline-suggest-pref', () => ({
  useInlineSuggestPref: () => ({
    enabled: holder.enabled,
    setEnabled: vi.fn(),
    toggle: vi.fn(),
  }),
}));

vi.mock('@postmill-ai/frontend/components/composer/store', () => ({
  useLaunchStore: (selector: any) => selector(holder.store),
}));

// `useFetch` routes every response through layout.context's `afterRequest`,
// which turns a 429 into a toast, a 402/406 into a modal dialog and a 401 into a
// logout redirect. None of that may be triggered by someone pausing
// mid-sentence, so this path must use raw window.fetch. Blowing up here is the
// guard: if anyone swaps the transport, the suite says so.
vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => {
    throw new Error(
      'ghost completion must not use useFetch — its afterRequest surfaces toasts, billing dialogs and logout redirects'
    );
  },
}));

vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: holder.toastShow }),
}));

import { useGhostCompletion } from './use-ghost-completion';
import { SUGGEST_DEBOUNCE_MS } from './should-suggest';

const DRAFT = 'Our new summer drop lands Friday and it is';

/** Minimal stand-in for the TipTap editor surface this hook touches. */
const makeEditor = (overrides: any = {}) => {
  const handlers: Record<string, ((...a: any[]) => void)[]> = {};
  const editor: any = {
    isEditable: true,
    isFocused: true,
    isDestroyed: false,
    view: { composing: false },
    state: {
      selection: { empty: true, head: DRAFT.length + 1 },
      doc: {
        content: { size: DRAFT.length + 2 },
        textBetween: () => DRAFT,
      },
    },
    commands: {
      setGhostSuggestion: vi.fn(),
      clearGhostSuggestion: vi.fn(),
    },
    on: (name: string, fn: any) => {
      (handlers[name] ||= []).push(fn);
    },
    off: (name: string, fn: any) => {
      handlers[name] = (handlers[name] || []).filter((h) => h !== fn);
    },
    // TipTap calls transaction handlers with { editor, transaction }.
    fire: (transaction: any = { getMeta: () => undefined }) =>
      (handlers['transaction'] || []).forEach((h) => h({ editor, transaction })),
    ...overrides,
  };
  return editor;
};

/** A transaction carrying the extension's own meta, as a set/clear produces. */
const ghostTransaction = { getMeta: (key: any) => (key ? { type: 'set' } : undefined) };

// Plugin state is driven from the holder so a spec can put a ghost on screen.
vi.mock('./ghost-completion.extension', async () => {
  const actual: any = await vi.importActual('./ghost-completion.extension');
  return {
    ...actual,
    getGhostState: () => holder.ghostState,
    caretAtEndOfBlock: () => true,
  };
});

let fetchMock: any;

beforeEach(() => {
  vi.useFakeTimers();
  holder.aiActive = true;
  holder.enabled = true;
  holder.store = {
    brandId: 'brand-1',
    current: 'global',
    locked: false,
    isCreateSet: false,
    internal: [],
  };
  holder.toastShow.mockClear();
  holder.ghostState = { text: null, from: null, suppressed: false };
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ suggestion: 'Grab yours early.' }),
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('useGhostCompletion', () => {
  it('requests once after the typing pause and shows the ghost', async () => {
    const editor = makeEditor();
    renderHook(() => useGhostCompletion(editor));

    act(() => editor.fire());
    expect(fetchMock).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(SUGGEST_DEBOUNCE_MS));
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(editor.commands.setGhostSuggestion).toHaveBeenCalledWith(
      ' Grab yours early.',
      DRAFT.length + 1
    );
  });

  it('sends the selected brand and only the whitelisted keys', async () => {
    // The API pipe is whitelist + forbidNonWhitelisted: an extra key 400s.
    const editor = makeEditor();
    renderHook(() => useGhostCompletion(editor));

    act(() => editor.fire());
    act(() => vi.advanceTimersByTime(SUGGEST_DEBOUNCE_MS));
    await flush();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/ai/suggest');
    expect(init.credentials).toBe('include');
    expect(init.headers['x-csrf-token']).toBe('tok');
    // Global edit has no platform, so the key is simply absent.
    expect(Object.keys(JSON.parse(init.body)).sort()).toEqual(['brandId', 'prefix']);
    expect(JSON.parse(init.body).brandId).toBe('brand-1');
  });

  it('sends the channel identifier when editing one channel', async () => {
    // This is what makes the brand's per-platform override apply.
    holder.store = {
      ...holder.store,
      current: 'int-1',
      internal: [
        {
          integration: { id: 'int-1', identifier: 'linkedin' },
          integrationValue: [],
        },
      ],
    };
    const editor = makeEditor();
    renderHook(() => useGhostCompletion(editor));

    act(() => editor.fire());
    act(() => vi.advanceTimersByTime(SUGGEST_DEBOUNCE_MS));
    await flush();

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).platform).toBe('linkedin');
  });

  it('does not suggest for a channel the user has not unlocked', async () => {
    // `current` is a channel but there is no matching `internal` entry, which is
    // the composer's "click to edit this channel" blur overlay state.
    holder.store = { ...holder.store, current: 'int-9', internal: [] };
    const editor = makeEditor();
    renderHook(() => useGhostCompletion(editor));

    act(() => editor.fire());
    act(() => vi.advanceTimersByTime(SUGGEST_DEBOUNCE_MS * 2));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a keystroke before the pause cancels the request', () => {
    const editor = makeEditor();
    renderHook(() => useGhostCompletion(editor));

    act(() => editor.fire());
    act(() => vi.advanceTimersByTime(SUGGEST_DEBOUNCE_MS - 100));
    act(() => editor.fire());
    act(() => vi.advanceTimersByTime(SUGGEST_DEBOUNCE_MS - 100));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts an in-flight request when typing resumes', async () => {
    let capturedSignal: AbortSignal | null = null;
    fetchMock.mockImplementation((_u: string, init: any) => {
      capturedSignal = init.signal;
      return new Promise(() => {});
    });
    const editor = makeEditor();
    renderHook(() => useGhostCompletion(editor));

    act(() => editor.fire());
    act(() => vi.advanceTimersByTime(SUGGEST_DEBOUNCE_MS));
    await flush();
    expect(capturedSignal!.aborted).toBe(false);

    act(() => editor.fire());
    expect(capturedSignal!.aborted).toBe(true);
  });

  it('discards a response that arrives after the caret moved', async () => {
    const editor = makeEditor();
    renderHook(() => useGhostCompletion(editor));

    act(() => editor.fire());
    act(() => vi.advanceTimersByTime(SUGGEST_DEBOUNCE_MS));
    editor.state.selection = { empty: true, head: 3 };
    await flush();

    expect(editor.commands.setGhostSuggestion).not.toHaveBeenCalled();
  });

  it('discards a response that arrives after the editor was destroyed', async () => {
    const editor = makeEditor();
    renderHook(() => useGhostCompletion(editor));

    act(() => editor.fire());
    act(() => vi.advanceTimersByTime(SUGGEST_DEBOUNCE_MS));
    editor.isDestroyed = true;
    await flush();

    expect(editor.commands.setGhostSuggestion).not.toHaveBeenCalled();
  });

  it('fails silently — a writer is never interrupted', async () => {
    // The reason this route returns 200-empty and this client bypasses useFetch.
    fetchMock.mockRejectedValue(new Error('network down'));
    const editor = makeEditor();
    renderHook(() => useGhostCompletion(editor));

    act(() => editor.fire());
    act(() => vi.advanceTimersByTime(SUGGEST_DEBOUNCE_MS));
    await flush();

    expect(holder.toastShow).not.toHaveBeenCalled();
    expect(editor.commands.setGhostSuggestion).not.toHaveBeenCalled();
  });

  it('shows nothing on a non-ok response', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    const editor = makeEditor();
    renderHook(() => useGhostCompletion(editor));

    act(() => editor.fire());
    act(() => vi.advanceTimersByTime(SUGGEST_DEBOUNCE_MS));
    await flush();

    expect(holder.toastShow).not.toHaveBeenCalled();
    expect(editor.commands.setGhostSuggestion).not.toHaveBeenCalled();
  });

  it('makes no request at all when the preference is off', () => {
    holder.enabled = false;
    const editor = makeEditor();
    renderHook(() => useGhostCompletion(editor));

    act(() => editor.fire());
    act(() => vi.advanceTimersByTime(SUGGEST_DEBOUNCE_MS * 3));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('makes no request when the org has no AI provider', () => {
    holder.aiActive = false;
    const editor = makeEditor();
    renderHook(() => useGhostCompletion(editor));

    act(() => editor.fire());
    act(() => vi.advanceTimersByTime(SUGGEST_DEBOUNCE_MS * 3));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('serves a repeated prefix from cache instead of re-billing', async () => {
    const editor = makeEditor();
    renderHook(() => useGhostCompletion(editor));

    act(() => editor.fire());
    act(() => vi.advanceTimersByTime(SUGGEST_DEBOUNCE_MS));
    await flush();

    act(() => editor.fire());
    act(() => vi.advanceTimersByTime(SUGGEST_DEBOUNCE_MS));
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(editor.commands.setGhostSuggestion).toHaveBeenCalledTimes(2);
  });

  it('ignores its own show/hide transactions', async () => {
    // Regression: setGhostSuggestion dispatches a transaction, which re-enters
    // this handler. Without the meta check it cleared the ghost it had just set,
    // so the suggestion never appeared on screen at all.
    const editor = makeEditor();
    renderHook(() => useGhostCompletion(editor));

    act(() => editor.fire());
    act(() => vi.advanceTimersByTime(SUGGEST_DEBOUNCE_MS));
    await flush();
    expect(editor.commands.setGhostSuggestion).toHaveBeenCalledTimes(1);

    // The ghost is now on screen — which is exactly the state in which the old
    // code wiped it.
    holder.ghostState = { text: ' Grab yours early.', from: 1, suppressed: false };
    editor.commands.clearGhostSuggestion.mockClear();
    act(() => editor.fire(ghostTransaction));

    expect(editor.commands.clearGhostSuggestion).not.toHaveBeenCalled();
    // …and it is not treated as typing, so no new request is queued either.
    act(() => vi.advanceTimersByTime(SUGGEST_DEBOUNCE_MS * 2));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('clears a visible ghost as soon as the user types', () => {
    holder.ghostState = { text: ' Grab yours early.', from: 1, suppressed: false };
    const editor = makeEditor();
    renderHook(() => useGhostCompletion(editor));

    act(() => editor.fire());

    expect(editor.commands.clearGhostSuggestion).toHaveBeenCalledTimes(1);
  });

  it('tolerates a null editor on first render', () => {
    expect(() => renderHook(() => useGhostCompletion(null))).not.toThrow();
  });

  it('unsubscribes on unmount', () => {
    const editor = makeEditor();
    const off = vi.spyOn(editor, 'off');
    const { unmount } = renderHook(() => useGhostCompletion(editor));

    unmount();

    expect(off).toHaveBeenCalledWith('transaction', expect.any(Function));
  });
});
