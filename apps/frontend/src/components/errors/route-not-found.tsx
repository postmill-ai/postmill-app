import Link from 'next/link';
import { getT } from '@gitroom/react/translation/get.translation.service.backend';

/**
 * Shared friendly fallback rendered by the App Router `not-found.tsx` segment
 * boundaries (unmatched routes within a segment / `notFound()`). Server-safe —
 * no client hooks — and themed with the app's global tokens.
 */
export async function RouteNotFound({
  title,
  description,
  homeHref = '/',
  homeLabel,
}: {
  title?: string;
  description?: string;
  homeHref?: string;
  homeLabel?: string;
}) {
  const t = await getT();
  const resolvedTitle = title ?? t('page_not_found', 'Page not found');
  const resolvedDescription =
    description ?? t('page_not_found_description', "The page you're looking for doesn't exist or has moved.");
  const resolvedHomeLabel = homeLabel ?? t('go_back_home', 'Go back home');

  return (
    <div className="flex flex-1 min-h-[60vh] items-center justify-center p-[24px] text-center">
      <div className="flex flex-col items-center gap-[12px] max-w-[420px]">
        <div className="text-[42px]">🧭</div>
        <h2 className="text-[18px] font-[600] text-textColor">{resolvedTitle}</h2>
        <p className="text-[13px] text-newTableText/70">{resolvedDescription}</p>
        <Link
          href={homeHref}
          className="mt-[4px] px-[16px] py-[9px] rounded-[8px] bg-btnPrimary text-white text-[13px] font-[500] hover:opacity-90 transition-opacity"
        >
          {resolvedHomeLabel}
        </Link>
      </div>
    </div>
  );
}
