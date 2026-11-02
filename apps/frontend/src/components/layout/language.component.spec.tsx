import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const apply = vi.fn();
const save = vi.fn();
const closeCurrent = vi.fn();
const show = vi.fn();
const fetch = vi.fn();

vi.mock('./preferred-language.client', () => ({
  applyPreferredLanguage: (...args: unknown[]) => apply(...args),
  savePreferredLanguage: (...args: unknown[]) => save(...args),
}));
vi.mock('@postmill-ai/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ closeCurrent }),
}));
vi.mock('@postmill-ai/react/translation/i18n.config', () => ({
  fallbackLng: 'en',
  languages: ['en', 'fr', 'ar'],
}));
vi.mock('@postmill-ai/react/translation/language-name', () => ({
  getLanguageName: (language: string) => language,
}));
vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show }),
}));
vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => fetch,
}));
vi.mock('react-country-flag', () => ({ default: () => null }));
vi.mock('i18next', () => ({ default: { resolvedLanguage: 'en' } }));
vi.mock('../composer/modal.wrapper.component', () => ({}));

import { ChangeLanguageComponent } from './language.component';

describe('ChangeLanguageComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apply.mockResolvedValue(undefined);
  });

  it('applies the language immediately and warns if the preference save fails', async () => {
    let finishSave!: (response: Response) => void;
    save.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finishSave = resolve;
        })
    );
    render(<ChangeLanguageComponent />);
    fireEvent.click(screen.getByText('fr'));

    await waitFor(() => expect(save).toHaveBeenCalledWith(fetch, 'fr'));
    expect(apply).toHaveBeenCalledWith('fr');
    expect(apply.mock.invocationCallOrder[0]).toBeLessThan(save.mock.invocationCallOrder[0]);
    expect(closeCurrent).not.toHaveBeenCalled();

    finishSave(new Response(null, { status: 500 }));
    await waitFor(() =>
      expect(show).toHaveBeenCalledWith(
        'Your language preference could not be saved. Please try again.',
        'warning'
      )
    );
    expect(closeCurrent).not.toHaveBeenCalled();
  });
});
