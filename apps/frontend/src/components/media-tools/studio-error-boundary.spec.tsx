import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StudioErrorBoundary } from './studio-error-boundary';

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}));

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

let shouldThrow = true;

function Studio() {
  if (shouldThrow) {
    throw new Error('Studio crashed');
  }
  return <div>Studio canvas</div>;
}

describe('StudioErrorBoundary', () => {
  it('renders the studio when there is no error', () => {
    shouldThrow = false;
    render(
      <StudioErrorBoundary>
        <Studio />
      </StudioErrorBoundary>
    );

    expect(screen.getByText('Studio canvas')).toBeTruthy();
  });

  it('shows the studio fallback when a studio throws', () => {
    shouldThrow = true;
    render(
      <StudioErrorBoundary>
        <Studio />
      </StudioErrorBoundary>
    );

    expect(screen.getByText('This studio hit a snag')).toBeTruthy();
    expect(screen.getByText('Studio crashed')).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
  });

  it('recovers when Try again is clicked and the studio no longer throws', async () => {
    shouldThrow = true;
    render(
      <StudioErrorBoundary>
        <Studio />
      </StudioErrorBoundary>
    );

    expect(screen.getByText('This studio hit a snag')).toBeTruthy();

    shouldThrow = false;
    fireEvent.click(screen.getByText('Try again'));

    expect(await screen.findByText('Studio canvas')).toBeTruthy();
    expect(screen.queryByText('This studio hit a snag')).toBeNull();
  });

  it('uses a custom fallback when provided', () => {
    shouldThrow = true;
    render(
      <StudioErrorBoundary fallback={<div>Custom studio fallback</div>}>
        <Studio />
      </StudioErrorBoundary>
    );

    expect(screen.getByText('Custom studio fallback')).toBeTruthy();
    expect(screen.queryByText('This studio hit a snag')).toBeNull();
  });
});
