import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const fetchMock = vi.fn();
const getAndClear = vi.fn();

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => fetchMock,
}));
vi.mock('@postmill-ai/frontend/app/(app)/auth/return.url.component', () => ({
  useReturnUrl: () => ({ getAndClear }),
}));
vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

import {
  beginSsoCallback,
  completeSsoPopup,
  isSsoPopupCallback,
  markSsoFullPage,
  navigateAfterAuth,
  resetSsoCallbackMode,
  SSO_COMPLETE_MESSAGE_TYPE,
  SSO_COMPLETE_STORAGE_KEY,
  SSO_FULLPAGE_STORAGE_KEY,
  SSO_GRACE_MS,
  SSO_POPUP_FEATURES,
  SSO_POPUP_NAME,
  useSsoPopup,
} from './sso-popup';

// jsdom's window.location is not writable; swap in a stub so the navigation
// the handshake ends with can be asserted.
const location = { href: 'https://app.example.com/auth/login', origin: 'https://app.example.com', reload: vi.fn() };
const originalLocation = window.location;

const linkResponse = (link: string) =>
  ({ ok: true, text: async () => link }) as unknown as Response;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  getAndClear.mockReset().mockReturnValue(null);
  location.href = 'https://app.example.com/auth/login';
  location.reload.mockReset();
  Object.defineProperty(window, 'location', { value: location, writable: true, configurable: true });
  window.localStorage.clear();
  window.sessionStorage.clear();
  resetSsoCallbackMode();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'location', { value: originalLocation, writable: true, configurable: true });
});

describe('navigateAfterAuth', () => {
  it('honours a stored same-origin return URL first', () => {
    getAndClear.mockReturnValue('https://app.example.com/launches?x=1');
    navigateAfterAuth('onboarding', getAndClear);
    expect(location.href).toBe('https://app.example.com/launches?x=1');
  });

  it('refuses a cross-origin return URL', () => {
    getAndClear.mockReturnValue('https://evil.example.com/');
    navigateAfterAuth('reload', getAndClear);
    expect(location.href).toBe('/');
  });

  it('sends a fresh registration to /dashboard and an existing user to a reload', () => {
    navigateAfterAuth('onboarding', getAndClear);
    expect(location.href).toBe('/dashboard');
    navigateAfterAuth('reload', getAndClear);
    expect(location.reload).toHaveBeenCalledTimes(1);
  });
});

describe('useSsoPopup (opener side)', () => {
  it('fetches the authorize link and opens it in the named popup', async () => {
    fetchMock.mockResolvedValue(linkResponse('https://provider.example.com/oauth'));
    const popup = { closed: false };
    const open = vi.spyOn(window, 'open').mockReturnValue(popup as Window);
    const { result } = renderHook(() => useSsoPopup());

    await act(() => result.current.start('/auth/oauth/FACEBOOK'));

    expect(fetchMock).toHaveBeenCalledWith('/auth/oauth/FACEBOOK');
    expect(open).toHaveBeenCalledWith('https://provider.example.com/oauth', SSO_POPUP_NAME, SSO_POPUP_FEATURES);
    expect(result.current.waiting).toBe(true);
    expect(result.current.error).toBeNull();
    // no full-page marker: the popup is a script-opened window
    expect(window.sessionStorage.getItem(SSO_FULLPAGE_STORAGE_KEY)).toBeNull();
  });

  it('falls back to a full-page redirect (and marks the tab) when the popup is blocked', async () => {
    fetchMock.mockResolvedValue(linkResponse('https://provider.example.com/oauth'));
    vi.spyOn(window, 'open').mockReturnValue(null);
    const { result } = renderHook(() => useSsoPopup());

    await act(() => result.current.start('/auth/oauth/X'));

    expect(location.href).toBe('https://provider.example.com/oauth');
    expect(window.sessionStorage.getItem(SSO_FULLPAGE_STORAGE_KEY)).toBe('1');
    expect(result.current.waiting).toBe(false);
  });

  it('surfaces an error instead of opening anything when the link request fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => '' });
    const open = vi.spyOn(window, 'open');
    const { result } = renderHook(() => useSsoPopup());

    await act(() => result.current.start('/auth/oauth/GOOGLE'));

    expect(open).not.toHaveBeenCalled();
    expect(result.current.error).toContain('Could not start the sign-in');
  });

  it('finishes on the postMessage fast path (same origin only)', async () => {
    fetchMock.mockResolvedValue(linkResponse('https://provider.example.com/oauth'));
    vi.spyOn(window, 'open').mockReturnValue({ closed: false } as Window);
    const { result } = renderHook(() => useSsoPopup());
    await act(() => result.current.start('/auth/oauth/FACEBOOK'));

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://evil.example.com',
          data: { type: SSO_COMPLETE_MESSAGE_TYPE, action: 'reload', ts: Date.now() },
        })
      );
    });
    expect(location.reload).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://app.example.com',
          data: { type: SSO_COMPLETE_MESSAGE_TYPE, action: 'reload', ts: Date.now() },
        })
      );
    });
    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  it('finishes on the localStorage signal (COOP-severed opener) — but only one written after this attempt started', async () => {
    fetchMock.mockResolvedValue(linkResponse('https://provider.example.com/oauth'));
    vi.spyOn(window, 'open').mockReturnValue({ closed: true } as Window);
    // A stale signal from an earlier attempt must be ignored.
    window.localStorage.setItem(
      SSO_COMPLETE_STORAGE_KEY,
      JSON.stringify({ action: 'onboarding', ts: Date.now() - 1 })
    );
    const { result } = renderHook(() => useSsoPopup());
    await act(() => result.current.start('/auth/oauth/X'));
    // start() clears the stale one
    expect(window.localStorage.getItem(SSO_COMPLETE_STORAGE_KEY)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    // popup.closed=true (COOP) is not the end of the flow
    expect(result.current.waiting).toBe(true);
    expect(location.href).toBe('https://app.example.com/auth/login');

    act(() => {
      window.localStorage.setItem(
        SSO_COMPLETE_STORAGE_KEY,
        JSON.stringify({ action: 'onboarding', ts: Date.now() })
      );
      window.dispatchEvent(new StorageEvent('storage', { key: SSO_COMPLETE_STORAGE_KEY, newValue: 'x' }));
    });
    expect(location.href).toBe('/dashboard');
    expect(window.localStorage.getItem(SSO_COMPLETE_STORAGE_KEY)).toBeNull();
  });

  it('picks the signal up on the poll when neither event fires', async () => {
    fetchMock.mockResolvedValue(linkResponse('https://provider.example.com/oauth'));
    vi.spyOn(window, 'open').mockReturnValue({ closed: false } as Window);
    const { result } = renderHook(() => useSsoPopup());
    await act(() => result.current.start('/auth/oauth/X'));

    window.localStorage.setItem(
      SSO_COMPLETE_STORAGE_KEY,
      JSON.stringify({ action: 'reload', ts: Date.now() })
    );
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  it('shows the failure the popup reported and stops waiting', async () => {
    fetchMock.mockResolvedValue(linkResponse('https://provider.example.com/oauth'));
    vi.spyOn(window, 'open').mockReturnValue({ closed: false } as Window);
    const { result } = renderHook(() => useSsoPopup());
    await act(() => result.current.start('/auth/oauth/X'));

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://app.example.com',
          data: { type: SSO_COMPLETE_MESSAGE_TYPE, action: 'error', message: 'PKCE verifier missing', ts: Date.now() },
        })
      );
    });
    expect(result.current.waiting).toBe(false);
    expect(result.current.error).toBe('PKCE verifier missing');
    expect(location.reload).not.toHaveBeenCalled();
  });

  it('gives up waiting after the grace window', async () => {
    fetchMock.mockResolvedValue(linkResponse('https://provider.example.com/oauth'));
    vi.spyOn(window, 'open').mockReturnValue({ closed: false } as Window);
    const { result } = renderHook(() => useSsoPopup());
    await act(() => result.current.start('/auth/oauth/X'));

    act(() => {
      vi.advanceTimersByTime(SSO_GRACE_MS + 1500);
    });
    expect(result.current.waiting).toBe(false);
    expect(result.current.error).toBeNull();
  });
});

describe('callback (popup) side', () => {
  it('assumes popup unless this tab marked itself as the full-page fallback, and consumes the marker', () => {
    markSsoFullPage();
    expect(beginSsoCallback()).toBe('fullpage');
    expect(isSsoPopupCallback()).toBe(false);
    expect(window.sessionStorage.getItem(SSO_FULLPAGE_STORAGE_KEY)).toBeNull();

    resetSsoCallbackMode();
    expect(beginSsoCallback()).toBe('popup');
    expect(isSsoPopupCallback()).toBe(true);
  });

  it('completeSsoPopup writes the storage signal, posts to a live opener and closes', () => {
    const opener = { postMessage: vi.fn() };
    Object.defineProperty(window, 'opener', { value: opener, writable: true, configurable: true });
    const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);

    completeSsoPopup({ action: 'reload' });

    const stored = JSON.parse(window.localStorage.getItem(SSO_COMPLETE_STORAGE_KEY)!);
    expect(stored.action).toBe('reload');
    expect(typeof stored.ts).toBe('number');
    expect(opener.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: SSO_COMPLETE_MESSAGE_TYPE, action: 'reload' }),
      'https://app.example.com'
    );
    expect(close).toHaveBeenCalled();
    Object.defineProperty(window, 'opener', { value: null, writable: true, configurable: true });
  });

  it('completeSsoPopup still signals through storage and closes when the opener is gone (COOP)', () => {
    Object.defineProperty(window, 'opener', { value: null, writable: true, configurable: true });
    const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);

    completeSsoPopup({ action: 'error', message: 'nope' });

    expect(JSON.parse(window.localStorage.getItem(SSO_COMPLETE_STORAGE_KEY)!)).toMatchObject({
      action: 'error',
      message: 'nope',
    });
    expect(close).toHaveBeenCalled();
  });
});

describe('callback (popup) side — one signal per document', () => {
  it('ignores a second completeSsoPopup (e.g. "Failed to fetch" from the aborted request while closing)', () => {
    Object.defineProperty(window, 'opener', { value: null, writable: true, configurable: true });
    vi.spyOn(window, 'close').mockImplementation(() => undefined);

    completeSsoPopup({ action: 'reload' });
    completeSsoPopup({ action: 'error', message: 'Failed to fetch' });

    expect(JSON.parse(window.localStorage.getItem(SSO_COMPLETE_STORAGE_KEY)!).action).toBe('reload');
  });

  it('opener takes the signal carried by the storage event, not a later overwrite', async () => {
    fetchMock.mockResolvedValue(linkResponse('https://provider.example.com/oauth'));
    vi.spyOn(window, 'open').mockReturnValue({ closed: true } as Window);
    const { result } = renderHook(() => useSsoPopup());
    await act(() => result.current.start('/auth/oauth/X'));

    act(() => {
      const success = JSON.stringify({ action: 'reload', ts: Date.now() });
      window.localStorage.setItem(
        SSO_COMPLETE_STORAGE_KEY,
        JSON.stringify({ action: 'error', message: 'Failed to fetch', ts: Date.now() })
      );
      window.dispatchEvent(new StorageEvent('storage', { key: SSO_COMPLETE_STORAGE_KEY, newValue: success }));
    });
    expect(location.reload).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });
});
