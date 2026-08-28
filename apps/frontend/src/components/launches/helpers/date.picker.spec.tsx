import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import dayjs from 'dayjs';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_k: string, fallback?: string) => fallback || _k,
}));

vi.mock('@postmill-ai/react/form/button', () => ({
  Button: ({ children, ...p }: any) => <button {...p}>{children}</button>,
}));

// jsdom has no matchMedia; Mantine's use-color-scheme media queries need it.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

import { DatePicker } from './date.picker';

describe('DatePicker (composer/calendar date editor)', () => {
  // Mantine 9 throws "MantineProvider was not found in component tree" when its
  // components render outside a provider — the app tree has none, so the picker
  // popover carries its own. Opening the editor must not crash the page.
  it('opens the Mantine date/time popover without a provider crash', () => {
    const onChange = vi.fn();
    const view = render(
      <DatePicker date={dayjs('2026-08-28T15:36:00Z')} onChange={onChange} />
    );

    const trigger = view.container.querySelector('.cursor-pointer')!;
    expect(() => fireEvent.click(trigger)).not.toThrow();

    // The popover actually mounted: calendar grid + time input + close button.
    expect(view.container.querySelector('table')).toBeTruthy();
    expect(view.container.querySelector('input[type="time"]')).toBeTruthy();
    expect(view.getByText('Close')).toBeTruthy();
  });
});
