import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const reloadCalendarView = vi.fn();
const useCalendarMock = vi.fn();

vi.mock('./context', () => ({
  useCalendar: () => useCalendarMock(),
  CalendarContext: { Provider: ({ children }: any) => children },
  CalendarWeekProvider: ({ children }: any) => children,
}));

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback?: string) => fallback || _key,
}));

vi.mock('./day.view', () => ({ DayView: () => <div data-testid="day-view" /> }));
vi.mock('./week.view', () => ({ WeekView: () => <div data-testid="week-view" /> }));
vi.mock('./month.view', () => ({ MonthView: () => <div data-testid="month-view" /> }));
vi.mock('./list.view', () => ({ ListView: () => <div data-testid="list-view" /> }));
vi.mock('./range.view', () => ({ RangeView: () => <div data-testid="range-view" /> }));
vi.mock('./mobile.view', () => ({ MobileView: () => <div data-testid="mobile-view" /> }));

// index.tsx re-exports these leaf modules (which pull heavy deps like @mui through
// the sidebar/header); stub them so importing `Calendar` stays light.
vi.mock('./grid', () => ({ CalendarColumn: () => null, SetSelectionModal: () => null }));
vi.mock('./card', () => ({ CalendarItem: () => null }));
vi.mock('./helpers', () => ({
  IconButton: () => null,
  EditSettings: () => null,
  CopyDebug: () => null,
  Duplicate: () => null,
  Preview: () => null,
  Statistics: () => null,
  DeletePost: () => null,
}));
vi.mock('./header', () => ({ CalendarHeader: () => null }));
vi.mock('./sidebar', () => ({ CalendarSidebar: () => null }));

import { Calendar } from './index';

function ctx(overrides?: Record<string, any>) {
  return {
    display: 'week',
    customRange: false,
    error: null,
    reloadCalendarView,
    ...overrides,
  };
}

describe('Calendar error state (3.7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a retry banner instead of an empty calendar when the posts fetch fails', () => {
    useCalendarMock.mockReturnValue(ctx({ error: new Error('boom') }));
    render(<Calendar />);

    expect(screen.getByText("Couldn't load posts")).toBeTruthy();
    expect(screen.queryByTestId('week-view')).toBeNull();

    fireEvent.click(screen.getByText('Retry'));
    expect(reloadCalendarView).toHaveBeenCalledTimes(1);
  });

  it('renders the week view normally when there is no error', () => {
    useCalendarMock.mockReturnValue(ctx({ error: null }));
    render(<Calendar />);

    expect(screen.getByTestId('week-view')).toBeTruthy();
    expect(screen.queryByText("Couldn't load posts")).toBeNull();
  });
});
