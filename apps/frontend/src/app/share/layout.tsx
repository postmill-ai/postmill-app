export const dynamic = 'force-dynamic';
export const metadata = { title: { default: 'Postmill', template: '%s' } };
import '../global.scss';
import { ReactNode } from 'react';
import { Plus_Jakarta_Sans } from 'next/font/google';
import clsx from 'clsx';
import { cookies } from 'next/headers';
import { VariableContextComponent } from '@gitroom/react/helpers/variable.context';
import { FetchWrapperComponent } from '@gitroom/helpers/utils/custom.fetch';

const jakartaSans = Plus_Jakarta_Sans({
  weight: ['600', '500'],
  style: ['normal', 'italic'],
  subsets: ['latin'],
});

export default async function ShareLayout({
  children,
}: {
  children: ReactNode;
}) {
  const cookieStore = await cookies();
  const mode = cookieStore.get('mode')?.value || 'dark';
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
      </head>
      <body
        className={clsx(
          jakartaSans.className,
          mode === 'dark' ? 'dark' : 'light',
          'text-primary !bg-primary'
        )}
      >
        <VariableContextComponent
          storageProvider={'local'}
          environment={process.env.NODE_ENV!}
          backendUrl={process.env.NEXT_PUBLIC_BACKEND_URL!}
          stripeClient={process.env.STRIPE_PUBLISHABLE_KEY!}
          billingEnabled={!!process.env.STRIPE_PUBLISHABLE_KEY}
          discordUrl={process.env.NEXT_PUBLIC_DISCORD_SUPPORT!}
          frontEndUrl={process.env.FRONTEND_URL!}
          isGeneral={!!process.env.IS_GENERAL}
          genericOauth={process.env.POSTMILL_GENERIC_OAUTH === 'true'}
          oauthLogoUrl={process.env.NEXT_PUBLIC_POSTMILL_OAUTH_LOGO_URL!}
          oauthDisplayName={process.env.NEXT_PUBLIC_POSTMILL_OAUTH_DISPLAY_NAME!}
          uploadDirectory={process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY!}
          mainUrl={process.env.MAIN_URL || ''}
          mcpUrl={process.env.MCP_URL}
          dub={!!process.env.STRIPE_PUBLISHABLE_KEY}
          facebookPixel={process.env.NEXT_PUBLIC_FACEBOOK_PIXEL!}
          telegramBotName={process.env.TELEGRAM_BOT_NAME!}
          neynarClientId={process.env.NEYNAR_CLIENT_ID!}
          isSecured={!process.env.NOT_SECURED}
          disableImageCompression={!!process.env.DISABLE_IMAGE_COMPRESSION}
          disableXAnalytics={!!process.env.DISABLE_X_ANALYTICS}
          sentryDsn={process.env.NEXT_PUBLIC_SENTRY_DSN!}
          extensionId={process.env.EXTENSION_ID || ''}
          googleAdsId={process.env.NEXT_PUBLIC_GTM_ID}
          googleAdsTrialTracking={process.env.NEXT_PUBLIC_TRACKING_TRIAL}
          language={'en'}
          transloadit={[]}
        >
          <FetchWrapperComponent
            baseUrl={process.env.NEXT_PUBLIC_BACKEND_URL!}
          >
            {children}
          </FetchWrapperComponent>
        </VariableContextComponent>
      </body>
    </html>
  );
}
