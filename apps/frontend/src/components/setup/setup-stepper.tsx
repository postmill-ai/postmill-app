'use client';

import React from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import clsx from 'clsx';

export interface SetupStep {
  id: string;
  label: string;
  required?: boolean;
}

export interface SetupStepperProps {
  steps: SetupStep[];
  currentStep: number;
  completedSteps: Set<number>;
  skippedSteps: Set<number>;
  onStepClick: (index: number) => void;
}

export function SetupStepper({
  steps,
  currentStep,
  completedSteps,
  skippedSteps,
  onStepClick,
}: SetupStepperProps) {
  const t = useT();

  const stateFor = (index: number) => {
    if (index === currentStep) return 'active';
    if (completedSteps.has(index)) return 'complete';
    if (skippedSteps.has(index)) return 'skipped';
    return 'upcoming';
  };

  return (
    <div className="w-full border-b border-newBorder bg-primary shrink-0">
      {/* Mobile compact view */}
      <div className="mobile:flex hidden items-center justify-between px-[16px] py-[12px]">
        <div className="text-[14px] font-[500] text-textColor">
          {t('step_of', 'Step {{current}} of {{total}}', {
            current: currentStep + 1,
            total: steps.length,
          })}
          <span className="ml-[8px] text-newTableText font-normal">
            {steps[currentStep].label}
          </span>
        </div>
        <div className="w-[80px] h-[4px] bg-newBorder rounded-full overflow-hidden">
          <div
            className="h-full bg-[#2B5CD3] rounded-full transition-all"
            style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Desktop / horizontal scroll view */}
      <div className="mobile:hidden flex items-center px-[24px] py-[16px] gap-[8px] overflow-x-auto">
        {steps.map((step, index) => {
          const state = stateFor(index);
          const clickable = state === 'complete' || state === 'skipped' || index <= currentStep;
          return (
            <React.Fragment key={step.id}>
              <button
                type="button"
                onClick={() => clickable && onStepClick(index)}
                disabled={!clickable}
                className={clsx(
                  'flex items-center gap-[10px] px-[14px] py-[8px] rounded-[8px] transition-colors shrink-0',
                  state === 'active' && 'bg-[#2B5CD3]/15 text-textColor',
                  state === 'complete' && 'text-textColor hover:bg-boxHover',
                  state === 'skipped' && 'text-newTableText hover:bg-boxHover',
                  state === 'upcoming' && 'text-newTableText opacity-60 cursor-not-allowed'
                )}
              >
                <span
                  className={clsx(
                    'w-[26px] h-[26px] rounded-full flex items-center justify-center text-[12px] font-[600] border',
                    state === 'active' && 'bg-[#2B5CD3] border-[#2B5CD3] text-white',
                    state === 'complete' && 'bg-transparent border-[#2B5CD3] text-btnPrimaryAccent',
                    state === 'skipped' && 'bg-transparent border-newTableBorder text-newTableText',
                    state === 'upcoming' && 'bg-transparent border-newTableBorder text-newTableText'
                  )}
                >
                  {state === 'complete' ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    index + 1
                  )}
                </span>
                <span className="text-[13px] font-[500] whitespace-nowrap">
                  {step.label}
                </span>
                {step.required && (
                  <span className="text-[10px] text-amber-600" aria-label={t('required', 'Required')}>
                    ●
                  </span>
                )}
              </button>
              {index < steps.length - 1 && (
                <div
                  className={clsx(
                    'w-[24px] h-[1px] shrink-0',
                    state === 'complete' ? 'bg-[#2B5CD3]' : 'bg-newBorder'
                  )}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
