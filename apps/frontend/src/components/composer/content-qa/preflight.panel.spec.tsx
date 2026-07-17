import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PreflightPanel } from './preflight.panel';
import type { PreflightResultItem } from './usePreflight';

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (key: string, fallback?: string) => fallback || key,
}));

afterEach(() => cleanup());

const item = (over: Partial<PreflightResultItem>): PreflightResultItem => ({
  integrationId: 'int-1',
  name: 'Twitter',
  valid: true,
  warnings: [],
  blocks: [],
  ...over,
});

describe('PreflightPanel (3.13)', () => {
  it('renders Proceed (and calls onProceed) for a warnings-only result', () => {
    const onProceed = vi.fn();
    const results = [item({ warnings: ['Close to character limit'] })];
    render(
      <PreflightPanel
        results={results}
        blocking={[]}
        passed={false}
        onClose={vi.fn()}
        onProceed={onProceed}
      />
    );

    expect(screen.getByText('Warnings')).toBeTruthy();
    const proceed = screen.getByText('Proceed');
    expect(proceed).toBeTruthy();
    fireEvent.click(proceed);
    expect(onProceed).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Fix issues')).toBeNull();
  });

  it('renders only "Fix issues" (no Proceed) for a blocking result', () => {
    const onProceed = vi.fn();
    const blockingItem = item({ valid: false, blocks: ['Missing media'] });
    render(
      <PreflightPanel
        results={[blockingItem]}
        blocking={[blockingItem]}
        passed={false}
        onClose={vi.fn()}
        onProceed={onProceed}
      />
    );

    expect(screen.getByText('Fix issues')).toBeTruthy();
    expect(screen.queryByText('Proceed')).toBeNull();
    expect(onProceed).not.toHaveBeenCalled();
  });
});
