import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, params?: Record<string, unknown>) =>
      (fallback || key).replace(/\{\{(\w+)\}\}/g, (_m, k) => String(params?.[k] ?? `{{${k}}}`)),
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

  // 502 ProviderUpstreamError envelope: attribute the failure to the org's
  // provider, explain the kind, link to settings.
  it('renders an upstream provider error attributed to the provider, not Postmill', () => {
    render(
      <AiErrorDisplay
        error={{
          statusCode: 502,
          error: 'ProviderUpstreamError',
          provider: 'google',
          providerName: 'Google AI Studio',
          domain: 'media',
          kind: 'quota',
          upstreamStatus: 429,
          message:
            "Google AI Studio reports the account's quota or billing limit was reached (HTTP 429): You exceeded your current quota",
          settingsUrl: '/settings/content/ai-media',
        }}
      />
    );
    expect(
      screen.getByText(
        'Google AI Studio returned an error — this comes from your Google AI Studio account, not Postmill.'
      )
    ).toBeTruthy();
    expect(screen.getByText(/You exceeded your current quota/)).toBeTruthy();
    expect(screen.getByText(/quota or billing limit was reached\. Check the plan/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open settings' }).getAttribute('href')).toBe(
      '/settings/content/ai-media'
    );
  });

  it('explains a rejected key for kind auth', () => {
    render(
      <AiErrorDisplay
        error={{
          error: 'ProviderUpstreamError',
          provider: 'openai',
          providerName: 'OpenAI',
          kind: 'auth',
          message: 'OpenAI rejected the API key (HTTP 401): Incorrect API key provided',
        }}
      />
    );
    expect(screen.getByText('The API key was rejected. Check the key in Settings.')).toBeTruthy();
  });
});
