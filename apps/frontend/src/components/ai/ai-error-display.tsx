'use client';

import React, { FC } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface AiErrorDisplayProps {
  error: any;
  onDismiss?: () => void;
}

const ERROR_TYPE_MAP: Record<string, string> = {
  'BudgetExceeded': 'ai_budget_exceeded_message',
  'GuardrailViolation': 'ai_guardrail_violation_message',
  'CapabilityNotAvailable': 'ai_capability_not_available_message',
};

const DEFAULT_MESSAGES: Record<string, string> = {
  'ai_budget_exceeded_message': 'Your org\'s monthly AI budget is used up (resets on the 1st)',
  'ai_guardrail_violation_message': 'This request was blocked by a content policy',
  'ai_capability_not_available_message': 'Image generation isn\'t available on the current AI provider',
  'ai_error_default': 'An AI error occurred',
};

export const AiErrorDisplay: FC<AiErrorDisplayProps> = ({ error, onDismiss }) => {
  const t = useT();

  if (!error) {
    return null;
  }

  let errorType: string | undefined;
  let rawMessage: string | undefined;

  if (typeof error === 'string') {
    rawMessage = error;
  } else if (error && typeof error === 'object') {
    errorType = error.error;
    rawMessage = error.message;
  }

  const translationKey = errorType && ERROR_TYPE_MAP[errorType]
    ? ERROR_TYPE_MAP[errorType]
    : undefined;

  const displayedMessage = translationKey
    ? t(translationKey, DEFAULT_MESSAGES[translationKey])
    : rawMessage
      ? rawMessage
      : t('ai_error_default', DEFAULT_MESSAGES['ai_error_default']);

  return (
    <div className="flex items-start gap-[12px] bg-yellow-950/20 border border-yellow-700/30 text-yellow-200 rounded-[8px] px-[16px] py-[12px]">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mt-[1px] shrink-0"
      >
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] leading-[1.5] break-words">{displayedMessage}</p>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-amber-600 hover:text-amber-700 transition-colors"
          aria-label={t('dismiss', 'Dismiss')}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  );
};
