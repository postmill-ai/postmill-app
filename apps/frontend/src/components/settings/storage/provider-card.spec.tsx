import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// Deterministic i18n: render the English default (interpolating {{vars}}) instead of
// relying on real i18next global state, which is non-deterministic across the suite.
vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_key: string, fallback: string, vars?: Record<string, unknown>) =>
      vars
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k] ?? ''))
        : fallback,
}));

import { ProviderCard } from './provider-card';

const makeProvider = (overrides: Record<string, any> = {}) => ({
  id: 'test-id',
  type: 'S3',
  name: 'Test Provider',
  mounted: true,
  quotaBytes: null,
  bucket: null,
  region: null,
  ...overrides,
});

const noop = () => {};

describe('ProviderCard', () => {
  describe('default / set-default UI', () => {
    it('does not render a "Default" badge', () => {
      render(
        <ProviderCard
          provider={makeProvider({ type: 'S3' })}
          onMount={noop}
          onUnmount={noop}
          onEdit={noop}
          onDelete={noop}
          onTest={noop}
        />,
      );

      expect(screen.queryByText('Default')).toBeNull();
    });

    it('does not render a "Set Default" button', () => {
      render(
        <ProviderCard
          provider={makeProvider({ type: 'S3' })}
          onMount={noop}
          onUnmount={noop}
          onEdit={noop}
          onDelete={noop}
          onTest={noop}
        />,
      );

      expect(screen.queryByText('Set Default')).toBeNull();
    });
  });

  describe('LOCAL type', () => {
    it('shows "Always on" badge', () => {
      render(
        <ProviderCard
          provider={makeProvider({ type: 'LOCAL' })}
          onMount={noop}
          onUnmount={noop}
          onEdit={noop}
          onDelete={noop}
          onTest={noop}
        />,
      );

      expect(screen.getByText('Always on')).toBeDefined();
    });

    it('does not show Mount or Unmount buttons', () => {
      render(
        <ProviderCard
          provider={makeProvider({ type: 'LOCAL' })}
          onMount={noop}
          onUnmount={noop}
          onEdit={noop}
          onDelete={noop}
          onTest={noop}
        />,
      );

      expect(screen.queryByText('Mount')).toBeNull();
      expect(screen.queryByText('Unmount')).toBeNull();
    });

    it('does not show Delete button', () => {
      render(
        <ProviderCard
          provider={makeProvider({ type: 'LOCAL' })}
          onMount={noop}
          onUnmount={noop}
          onEdit={noop}
          onDelete={noop}
          onTest={noop}
        />,
      );

      expect(screen.queryByText('Delete')).toBeNull();
    });
  });

  describe('non-LOCAL type', () => {
    it('shows Mount button when unmounted', () => {
      render(
        <ProviderCard
          provider={makeProvider({ type: 'S3', mounted: false })}
          onMount={noop}
          onUnmount={noop}
          onEdit={noop}
          onDelete={noop}
          onTest={noop}
        />,
      );

      expect(screen.getByText('Mount')).toBeDefined();
      expect(screen.queryByText('Unmount')).toBeNull();
    });

    it('shows Unmount button when mounted', () => {
      render(
        <ProviderCard
          provider={makeProvider({ type: 'S3', mounted: true })}
          onMount={noop}
          onUnmount={noop}
          onEdit={noop}
          onDelete={noop}
          onTest={noop}
        />,
      );

      expect(screen.getByText('Unmount')).toBeDefined();
      expect(screen.queryByText('Mount')).toBeNull();
    });

    it('shows Delete button', () => {
      render(
        <ProviderCard
          provider={makeProvider({ type: 'S3' })}
          onMount={noop}
          onUnmount={noop}
          onEdit={noop}
          onDelete={noop}
          onTest={noop}
        />,
      );

      expect(screen.getByText('Delete')).toBeDefined();
    });

    it('shows Mounted badge when mounted', () => {
      render(
        <ProviderCard
          provider={makeProvider({ type: 'S3', mounted: true })}
          onMount={noop}
          onUnmount={noop}
          onEdit={noop}
          onDelete={noop}
          onTest={noop}
        />,
      );

      expect(screen.getByText('Mounted')).toBeDefined();
      expect(screen.queryByText('Always on')).toBeNull();
    });

    it('shows Unmounted badge when not mounted', () => {
      render(
        <ProviderCard
          provider={makeProvider({ type: 'S3', mounted: false })}
          onMount={noop}
          onUnmount={noop}
          onEdit={noop}
          onDelete={noop}
          onTest={noop}
        />,
      );

      expect(screen.getByText('Unmounted')).toBeDefined();
      expect(screen.queryByText('Always on')).toBeNull();
    });
  });
});
