import { Metadata } from 'next';
import { getT } from '@gitroom/react/translation/get.translation.service.backend';
import { RefreshButton } from './refresh-button';

export const metadata: Metadata = {
  title: 'Error',
  description: '',
};

export default async function Page() {
  const t = await getT();

  return (
    <div className="flex items-center justify-center min-h-screen bg-newBgColor p-[12px]">
      <div className="bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[32px] max-w-[440px] w-full flex flex-col items-center gap-[20px] text-center">
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-red-500"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <h1 className="text-[24px] font-[600] text-textColor">
          {t('something_went_wrong', 'Something went wrong')}
        </h1>
        <p className="text-[14px] text-newTableText">
          {t(
            'we_are_experiencing_some_difficulty_try_to_refresh_the_page',
            'We are experiencing some difficulty, try to refresh the page'
          )}
        </p>
        <div className="flex gap-[12px] mt-[8px]">
          <RefreshButton />
          <a
            href="/dashboard"
            className="bg-btnSimple text-btnText border border-newTableBorder rounded-[8px] h-[40px] px-[20px] text-[14px] font-[500] flex items-center hover:bg-boxHover transition-colors no-underline"
          >
            {t('back_to_dashboard', 'Back to dashboard')}
          </a>
        </div>
      </div>
    </div>
  );
}
