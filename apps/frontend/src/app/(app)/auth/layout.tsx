import { getT } from '@gitroom/react/translation/get.translation.service.backend';

export const dynamic = 'force-dynamic';
import { ReactNode } from 'react';
import loadDynamic from 'next/dynamic';
import Image from 'next/image';
import { LogoTextComponent } from '@gitroom/frontend/components/ui/logo-text.component';
const ReturnUrlComponent = loadDynamic(() => import('./return.url.component'));

const features = [
  { key: 'auth_feature_channels', text: '28+ social & chat channels' },
  { key: 'auth_feature_ai_content', text: 'AI-powered content creation' },
  {
    key: 'auth_feature_team_collab',
    text: 'Team collaboration & approval workflows',
  },
  { key: 'auth_feature_analytics', text: 'Analytics & best-time scheduling' },
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
      <div className="flex flex-col py-[40px] px-[20px] flex-1 lg:w-[600px] lg:flex-none rounded-[12px] text-white p-[12px] bg-[#1A1919]">
        <div className="w-full max-w-[440px] mx-auto justify-center gap-[20px] h-full flex flex-col text-white">
          <LogoTextComponent />
          <div className="flex">{children}</div>
        </div>
      </div>
      <div className="flex-1 hidden lg:flex flex-col items-center justify-center bg-newBgColorInner">
        <div className="flex flex-col items-center gap-[32px] max-w-[440px] px-[40px]">
          <div className="flex flex-col items-center gap-[16px]">
            <Image
              src="/postmill-logo.png"
              alt="Postmill"
              width={48}
              height={48}
              className="h-[48px] w-auto"
            />
            <h1 className="text-[28px] font-[700] text-textColor text-center leading-tight">
              {t('auth_headline_schedule_smarter', 'Schedule smarter.')}
              <br />
              <span className="text-[#1d9bf0]">
                {t('auth_headline_grow_faster', 'Grow faster.')}
              </span>
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
                  className="shrink-0"
                >
                  <circle cx="12" cy="12" r="10" fill="#2b5cd3" />
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
