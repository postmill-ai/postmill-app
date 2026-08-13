import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import { LEGACY_TAB_TO_PATH } from '@postmill-ai/frontend/components/settings/settings-paths';

let searchParamValues: Record<string, string> = {};
const replaceMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => ({ get: (key: string) => searchParamValues[key] ?? null }),
}));

// The landing itself is covered by its own component; here we only care which of
// the two branches the page takes.
vi.mock('@postmill-ai/frontend/components/settings/settings-index', () => ({
  SettingsIndexComponent: () => <div data-testid="settings-index" />,
}));

import SettingsIndex from './page';

beforeEach(() => {
  searchParamValues = {};
  replaceMock.mockClear();
});
afterEach(cleanup);

describe('/settings', () => {
  it('renders the landing and does not redirect on a bare /settings', () => {
    render(<SettingsIndex />);

    expect(screen.getByTestId('settings-index')).toBeTruthy();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  // `?tab=` is not legacy — the backend still emits these links (dashboard summary
  // cards, the short-link and integration exception filters) and /dashboard/summary
  // is Redis-cached, so they outlive any backend change. Every mapping must work.
  it.each(Object.entries(LEGACY_TAB_TO_PATH))(
    '?tab=%s redirects to %s',
    (tab, path) => {
      searchParamValues = { tab };
      const { container } = render(<SettingsIndex />);

      expect(replaceMock).toHaveBeenCalledWith(path);
      // Nothing paints before the bounce — the target is computed during render,
      // not only in the effect.
      expect(container.innerHTML).toBe('');
      expect(screen.queryByTestId('settings-index')).toBeNull();
    }
  );

  it('falls through to the landing for an unrecognised tab', () => {
    searchParamValues = { tab: 'not-a-real-tab' };
    render(<SettingsIndex />);

    expect(replaceMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('settings-index')).toBeTruthy();
  });

  it('covers every tab the backend is known to emit', () => {
    for (const tab of ['channels', 'ai', 'shortlinks']) {
      expect(LEGACY_TAB_TO_PATH[tab]).toBeTruthy();
    }
  });
});
