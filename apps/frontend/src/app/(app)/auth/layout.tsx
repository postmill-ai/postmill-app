import { getT } from '@postmill-ai/react/translation/get.translation.service.backend';

export const dynamic = 'force-dynamic';
import { ReactNode } from 'react';
import loadDynamic from 'next/dynamic';
import { Wordmark } from '@postmill-ai/frontend/components/new-layout/wordmark';
const ReturnUrlComponent = loadDynamic(() => import('./return.url.component'));
const SignupPlanComponent = loadDynamic(() => import('./signup.plan.component'));

const features = [
  {
    key: 'auth_feature_channels',
    text: '36+ social & chat channels, one composer',
  },
  {
    key: 'auth_feature_ai_content',
    text: 'AI writer & design studio — on your own keys',
  },
  {
    key: 'auth_feature_calendar',
    text: 'Visual calendar, timezone-aware scheduling',
  },
  {
    key: 'auth_feature_inbox',
    text: 'Daily analytics snapshots & a prioritized reply inbox',
  },
];

export default async function AuthLayout({
  children,
}: {
  children: ReactNode;
}) {
  const t = await getT();

  return (
    <div className="bg-[#0E0E0E] flex flex-1 p-[12px] gap-[12px] min-h-screen w-screen text-white">
      <ReturnUrlComponent />
      <SignupPlanComponent />
      <div className="flex flex-col py-[40px] px-[20px] flex-1 lg:w-[600px] lg:flex-none rounded-[12px] text-white p-[12px] bg-[#1A1919]">
        <div className="w-full max-w-[440px] mx-auto justify-center gap-[20px] h-full flex flex-col text-white">
          <Wordmark className="text-white" />
          <div className="flex">{children}</div>
        </div>
      </div>
      <div className="flex-1 hidden lg:flex flex-col items-center justify-center bg-newBgColorInner">
        <div className="flex flex-col items-center gap-[32px] max-w-[440px] px-[40px]">
          <div className="flex flex-col items-center gap-[16px]">
            <Wordmark height={32} className="text-textColor" />
            <h1 className="text-[28px] font-[700] text-textColor text-center leading-tight">
              {t('auth_tagline', 'Create. Post. Track. Engage.')}
            </h1>
          </div>
          <div className="flex flex-col gap-[14px] w-full">
            {features.map((feature) => (
              <div
                key={feature.key}
                className="flex items-center gap-[12px] text-[15px] text-textColor"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  className="shrink-0 text-btnPrimary"
                >
                  <circle cx="12" cy="12" r="10" fill="currentColor" />
                  <path
                    d="M8 12l3 3 5-5"
                    stroke="#fff"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>{t(feature.key, feature.text)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
