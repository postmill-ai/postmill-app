import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

import { AiErrorDisplay } from './ai-error-display';

describe('AiErrorDisplay', () => {
  it('renders friendly mapped copy for BudgetExceeded', () => {
    render(
      <AiErrorDisplay error={{ error: 'BudgetExceeded', message: 'raw budget' }} />
    );
    expect(
      screen.getByText(
        "Your org's monthly AI budget is used up (resets on the 1st)"
      )
    ).toBeTruthy();
  });

  it('renders friendly mapped copy for GuardrailViolation', () => {
    render(
      <AiErrorDisplay
        error={{ error: 'GuardrailViolation', message: 'raw guardrail' }}
      />
    );
    expect(
      screen.getByText('This request was blocked by a content policy')
    ).toBeTruthy();
  });

  it('renders friendly mapped copy for CapabilityNotAvailable', () => {
    render(
      <AiErrorDisplay
        error={{ error: 'CapabilityNotAvailable', message: 'raw capability' }}
      />
    );
    expect(
      screen.getByText(
        "Image generation isn't available on the current AI provider"
      )
    ).toBeTruthy();
  });

  it('falls back to the raw message for an unknown error tag', () => {
    render(
      <AiErrorDisplay
        error={{ error: 'SomethingElse', message: 'a very specific failure' }}
      />
    );
    expect(screen.getByText('a very specific failure')).toBeTruthy();
  });

  it('renders the raw message when given a bare string', () => {
    render(<AiErrorDisplay error="just a string" />);
    expect(screen.getByText('just a string')).toBeTruthy();
  });

  it('renders the default message when no recognizable fields are present', () => {
    render(<AiErrorDisplay error={{ foo: 'bar' }} />);
    expect(screen.getByText('An AI error occurred')).toBeTruthy();
  });

  it('calls onDismiss when the dismiss control is activated', () => {
    const onDismiss = vi.fn();
    render(
      <AiErrorDisplay
        error={{ error: 'BudgetExceeded', message: 'x' }}
        onDismiss={onDismiss}
      />
    );
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not render a dismiss control when onDismiss is not provided', () => {
    render(<AiErrorDisplay error="something" />);
    expect(screen.queryByLabelText('Dismiss')).toBeNull();
  });

  it('renders nothing when error is null', () => {
    const { container } = render(<AiErrorDisplay error={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when error is falsy (empty string)', () => {
    const { container } = render(<AiErrorDisplay error="" />);
    expect(container.firstChild).toBeNull();
  });
});
