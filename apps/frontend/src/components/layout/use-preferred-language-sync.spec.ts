import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePreferredLanguageSync } from './use-preferred-language-sync';

const apply = vi.fn();
const save = vi.fn();
const show = vi.fn();
vi.mock('./preferred-language.client', () => ({
  applyPreferredLanguage: (...args: unknown[]) => apply(...args),
  savePreferredLanguage: (...args: unknown[]) => save(...args),
}));
vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show }),
}));
vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
vi.mock('i18next', () => ({
  default: { resolvedLanguage: 'en-US' },
}));

describe('usePreferredLanguageSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies a saved account language without overwriting it from the browser', async () => {
    const fetch = vi.fn();
    renderHook(() =>
      usePreferredLanguageSync(
        { id: 'user-1', profile: { preferredLanguage: 'fr' } },
        fetch
      )
    );
    await waitFor(() => expect(apply).toHaveBeenCalledWith('fr'));
    expect(save).not.toHaveBeenCalled();
  });

  it('captures the current browser locale once when the account has none', async () => {
    save.mockResolvedValue({ ok: true });
    const fetch = vi.fn();
    renderHook(() =>
      usePreferredLanguageSync({ id: 'user-1', profile: null }, fetch)
    );
    await waitFor(() => expect(save).toHaveBeenCalledWith(fetch, 'en'));
    expect(apply).not.toHaveBeenCalled();
  });

  it('reports a failed initial save', async () => {
    save.mockResolvedValue({ ok: false });
    renderHook(() =>
      usePreferredLanguageSync({ id: 'user-1', profile: null }, vi.fn())
    );
    await waitFor(() => expect(show).toHaveBeenCalled());
  });
});
