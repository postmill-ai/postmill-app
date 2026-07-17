'use client';

import { useT } from '@gitroom/react/translation/get.transation.service.client';

/**
 * Shared friendly fallback rendered by the App Router `error.tsx` segment
 * boundaries. Next.js passes `{ error, reset }`; `reset` re-renders the
 * segment subtree to retry. Themed with the app's global tokens so it works in
 * both light and dark mode. The underlying exception is still captured by
 * Sentry's global handler / `global-error.tsx`.
 */
export function RouteError({
  error,
  reset,
  title,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
}) {
  const t = useT();
  const resolvedTitle = title ?? t('something_went_wrong', 'Something went wrong');

  return (
    <div className="flex flex-1 min-h-[60vh] items-center justify-center p-[24px] text-center">
      <div className="flex flex-col items-center gap-[12px] max-w-[420px]">
        <div className="text-[42px]">😬</div>
        <h2 className="text-[18px] font-[600] text-textColor">{resolvedTitle}</h2>
        <p className="text-[13px] text-newTableText/70">
          {error?.message || t('unexpected_error_occurred', 'An unexpected error occurred. Please try again.')}
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-[4px] px-[16px] py-[9px] rounded-[8px] bg-btnPrimary text-white text-[13px] font-[500] hover:opacity-90 transition-opacity"
        >
          {t('try_again', 'Try again')}
        </button>
      </div>
    </div>
  );
}
