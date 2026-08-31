import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from './error.boundary';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Kaboom!');
  }
  return <div>Safe content</div>;
}

let shouldThrow = true;

function ExternalBomb() {
  if (shouldThrow) {
    throw new Error('Kaboom!');
  }
  return <div>Recovered</div>;
}

describe('ErrorBoundary', () => {
  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div>Hello World</div>
      </ErrorBoundary>
    );

    expect(screen.getByText('Hello World')).toBeTruthy();
  });

  it('catches render error in child and shows fallback UI', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.getByText('Kaboom!')).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
  });

  it('does not show error UI when child renders normally', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Safe content')).toBeTruthy();
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });

  it('resets error state when Try again is clicked and children no longer throw', async () => {
    shouldThrow = true;
    render(
      <ErrorBoundary>
        <ExternalBomb />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeTruthy();

    shouldThrow = false;
    fireEvent.click(screen.getByText('Try again'));

    expect(await screen.findByText('Recovered')).toBeTruthy();
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });

  it('uses custom fallback when provided', () => {
    render(
      <ErrorBoundary fallback={<div>Custom error UI</div>}>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Custom error UI')).toBeTruthy();
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });
});
