'use client';

import { Component, ReactNode } from 'react';
import i18next from '@gitroom/react/translation/i18next';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      const error = this.state.error;
      const messageKey = (error as { messageKey?: string } | undefined)
        ?.messageKey;
      // With a messageKey (Pattern C fetch errors) translate it; otherwise show
      // the error's own message verbatim. Never route the dynamic message through
      // a static resource key — a key present in the locale files shadows the
      // defaultValue (it swallowed error.message and rendered the generic text twice).
      const errorMessage = messageKey
        ? i18next.t(messageKey, { defaultValue: error?.message ?? '' })
        : error?.message ||
          i18next.t('something_went_wrong', { defaultValue: 'Something went wrong' });
      return (
        this.props.fallback || (
          <div className="flex flex-col items-center justify-center py-[48px] text-center">
            <p className="text-newTableText text-[14px]">
              {i18next.t('something_went_wrong', {
                defaultValue: 'Something went wrong',
              })}
            </p>
            <p className="text-[12px] text-newTableText opacity-60 mt-[8px]">
              {errorMessage}
            </p>
            <button
              onClick={() =>
                this.setState({ hasError: false, error: undefined })
              }
              className="mt-[16px] px-[12px] py-[6px] text-[12px] bg-btnPrimary text-white rounded-[6px]"
            >
              {i18next.t('try_again', { defaultValue: 'Try again' })}
            </button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
