import { internalFetch } from '@postmill-ai/helpers/utils/internal.fetch';
export const dynamic = 'force-dynamic';
import { Register } from '@postmill-ai/frontend/components/auth/register';
import { Metadata } from 'next';
import Link from 'next/link';
import { getT } from '@postmill-ai/react/translation/get.translation.service.backend';
import { LoginWithOidc } from '@postmill-ai/frontend/components/auth/login.with.oidc';
export const metadata: Metadata = {
  title: `Postmill Register`,
  description: '',
};
export default async function Auth(params: {searchParams: Promise<{provider: string}>}) {
  const t = await getT();
  if (process.env.DISABLE_REGISTRATION === 'true') {
    const canRegister = (
      await (await internalFetch('/auth/can-register')).json()
    ).register;
    if (!canRegister && !(await params?.searchParams)?.provider) {
      return (
        <>
          <LoginWithOidc />
          <div className="text-center">
            {t('registration_is_disabled', 'Registration is disabled')}
            <br />
            <Link className="underline hover:font-bold" href="/auth/login">
              {t('login_instead', 'Login instead')}
            </Link>
          </div>
        </>
      );
    }
  }
  return <Register />;
}
