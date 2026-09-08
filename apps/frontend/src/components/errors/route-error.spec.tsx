import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

const mockCaptureException = vi.hoisted(() => vi.fn());
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: any[]) => mockCaptureException(...args),
}));

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (k: string, fallback?: string) => fallback || k,
}));

import { RouteError } from './route-error';

describe('RouteError (segment error boundary)', () => {
  // Segment error boundaries catch the exception, so it never reaches the
  // global window handler — the boundary itself must report to Sentry or
  // route crashes are invisible (seen live on 2026-09-08).
  it('reports the caught error to Sentry', () => {
    const err = new Error('boom');
    render(<RouteError error={err} reset={vi.fn()} />);
    expect(mockCaptureException).toHaveBeenCalledWith(err);
  });

  it('renders the friendly fallback with the error message', () => {
    const view = render(
      <RouteError error={new Error('boom')} reset={vi.fn()} />
    );
    expect(view.getByText('Something went wrong')).toBeTruthy();
    expect(view.getByText('boom')).toBeTruthy();
    expect(view.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
