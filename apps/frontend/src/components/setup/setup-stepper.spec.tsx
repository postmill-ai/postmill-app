import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

const mockT = vi.fn((_key: string, fallback?: string, opts?: Record<string, any>) => {
  if (!fallback) return _key;
  return fallback
    .replace('{{current}}', String(opts?.current ?? ''))
    .replace('{{total}}', String(opts?.total ?? ''));
});

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => mockT,
}));

import { SetupStepper, SetupStep } from './setup-stepper';

const steps: SetupStep[] = [
  { id: 'llm', label: 'LLM', required: true },
  { id: 'ai-media', label: 'AI Media' },
  { id: 'channels', label: 'Channels' },
];

describe('SetupStepper', () => {
  it('renders all step labels', () => {
    render(
      <SetupStepper
        steps={steps}
        currentStep={0}
        completedSteps={new Set()}
        skippedSteps={new Set()}
        onStepClick={vi.fn()}
      />
    );
    expect(screen.getAllByText('LLM').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('AI Media').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Channels').length).toBeGreaterThanOrEqual(1);
  });

  it('marks the active step with the accent style', () => {
    const { container } = render(
      <SetupStepper
        steps={steps}
        currentStep={1}
        completedSteps={new Set([0])}
        skippedSteps={new Set()}
        onStepClick={vi.fn()}
      />
    );
    const active = container.querySelector('[class*="bg-[#2B5CD3]/15"]');
    expect(active).not.toBeNull();
  });

  it('calls onStepClick only for completed/visited steps', () => {
    const onClick = vi.fn();
    render(
      <SetupStepper
        steps={steps}
        currentStep={1}
        completedSteps={new Set([0])}
        skippedSteps={new Set()}
        onStepClick={onClick}
      />
    );
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[0]); // completed
    expect(onClick).toHaveBeenCalledWith(0);
    fireEvent.click(buttons[2]); // upcoming
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
