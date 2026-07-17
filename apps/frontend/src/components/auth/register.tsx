'use client';

import { FormProvider, SubmitHandler, useForm } from 'react-hook-form';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import Link from 'next/link';
import { Button } from '@gitroom/react/form/button';
import { Input } from '@gitroom/react/form/input';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { classValidatorResolver } from '@hookform/resolvers/class-validator';
import { CreateOrgUserDto } from '@gitroom/nestjs-libraries/dtos/auth/create.org.user.dto';
import { useRouter, useSearchParams } from 'next/navigation';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import clsx from 'clsx';
import { useFireEvents } from '@gitroom/helpers/utils/use.fire.events';
import { useTrack } from '@gitroom/react/helpers/use.track';
import { TrackEnum } from '@gitroom/nestjs-libraries/user/track.enum';
import {
  providerComponents,
  useAuthProviders,
} from '@gitroom/frontend/components/auth/login';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import useCookie from 'react-use-cookie';
type Inputs = {
  email: string;
  password: string;
  name: string;
  company: string;
  providerToken: string;
  provider: string;
};
export function Register() {
  const getQuery = useSearchParams();
  const fetch = useFetch();
  const [provider] = useState(getQuery?.get('provider')?.toUpperCase());
  const [code, setCode] = useState(getQuery?.get('code') || '');
  const [show, setShow] = useState(false);
  const load = useCallback(() => {
    fetch(`/auth/oauth/${provider?.toUpperCase() || 'LOCAL'}/exists`, {
      method: 'POST',
      body: JSON.stringify({
        code,
      }),
    })
      .then((response) => response.json())
      .then(({ token }: { token: string }) => {
        if (token) {
          setCode(token);
          setShow(true);
        }
      });
  }, [provider, code, fetch]);
  // The oauth code exchange must run exactly once on mount (load() itself
  // replaces `code` with the returned token) — guard with a ref.
  const exchangedRef = useRef(false);
  useEffect(() => {
    if (exchangedRef.current) {
      return;
    }
    exchangedRef.current = true;
    if (provider && code) {
      load();
    }
  }, [provider, code, load]);
  if (!code && !provider) {
    return <RegisterAfter token="" provider="LOCAL" />;
  }
  if (!show) {
    return <LoadingComponent />;
  }
  return (
    <RegisterAfter token={code} provider={provider?.toUpperCase() || 'LOCAL'} />
  );
}
export function RegisterAfter({
  token,
  provider,
}: {
  token: string;
  provider: string;
}) {
  const t = useT();
  const { data: providersData, error: providersError } = useAuthProviders();
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const fireEvents = useFireEvents();
  const track = useTrack(undefined);
  const [datafast_visitor_id] = useCookie('datafast_visitor_id');
  const isAfterProvider = useMemo(() => {
    return !!token && !!provider;
  }, [token, provider]);
  const resolver = useMemo(() => {
    return classValidatorResolver(CreateOrgUserDto);
  }, []);
  const form = useForm<Inputs>({
    resolver,
    defaultValues: {
      providerToken: token,
      provider: provider,
    },
  });
  const fetchData = useFetch();
  const onSubmit: SubmitHandler<Inputs> = async (data) => {
    setLoading(true);
    await fetchData('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        ...data,
        datafast_visitor_id,
      }),
    })
      .then(async (response) => {
        setLoading(false);
        if (response.status === 200) {
          fireEvents('register');
          return track(TrackEnum.CompleteRegistration).then(() => {
            if (response.headers.get('activate') === 'true') {
              router.push('/auth/activate');
            } else {
              router.push('/auth/login');
            }
          });
        } else {
          form.setError('email', {
            message: await response.text(),
          });
        }
      })
      .catch((e) => {
        form.setError('email', {
          message: t(
            'registration_general_error',
            'General error: {{error}}. Please check your browser console.',
            { error: String(e) }
          ),
        });
      });
  };
  const renderProviders = () => {
    const fetchedProviders = providersData?.providers?.filter(
      (p) => p.provider !== 'LOCAL'
    );

    if (fetchedProviders && fetchedProviders.length > 0) {
      return (
        <div className="gap-[8px] flex flex-wrap">
          {fetchedProviders.map((p) => {
            const Component = providerComponents[p.provider];
            if (!Component) return null;
            return <Component key={p.provider} />;
          })}
        </div>
      );
    }

    if (providersError) {
      return (
        <div className="text-red-500 text-sm">
          {t('failed_to_fetch_auth_providers', 'Failed to fetch auth providers')}
        </div>
      );
    }

    // No configured OAuth providers (LOCAL maps to no social button) — the
    // email/password form below is the only registration method.
    return null;
  };
  return (
    <FormProvider {...form}>
      <form className="flex-1 flex" onSubmit={form.handleSubmit(onSubmit)}>
        <div className="flex flex-col flex-1">
          <div>
            <h1 className="text-[40px] font-[500] -tracking-[0.8px] text-start cursor-pointer">
              {t('sign_up', 'Sign Up')}
            </h1>
          </div>
          <div className="text-[14px] mt-[32px] mb-[12px]">
            {t('continue_with', 'Continue With')}
          </div>
          <div className="flex flex-col">
            {!isAfterProvider && renderProviders()}
            {!isAfterProvider && (
              <div className="h-[20px] mb-[24px] mt-[24px] relative">
                <div className="absolute w-full h-[1px] bg-newTableBorder top-[50%] -translate-y-[50%]" />
                <div
                  className={`absolute z-[1] justify-center items-center w-full start-0 -top-[4px] flex`}
                >
                  <div className="px-[16px]">{t('or', 'OR')}</div>
                </div>
              </div>
            )}
            <div className="flex flex-col gap-[12px]">
              <div className="text-textColor">
                {!isAfterProvider && (
                  <>
                    <Input
                      label="Email"
                      translationKey="label_email"
                      {...form.register('email')}
                      type="email"
                      placeholder={t('email_address', 'Email Address')}
                    />
                    <Input
                      label="Password"
                      translationKey="label_password"
                      {...form.register('password')}
                      autoComplete="off"
                      type="password"
                      placeholder={t('label_password', 'Password')}
                    />
                    <Input
                      label="Name"
                      translationKey="label_name"
                      {...form.register('name')}
                      autoComplete="name"
                      type="text"
                      placeholder={t('label_name', 'Name')}
                    />
                  </>
                )}
                <Input
                  label="Company"
                  translationKey="label_company"
                  {...form.register('company')}
                  autoComplete="off"
                  type="text"
                  placeholder={t('label_company', 'Company')}
                />
              </div>
              <div className={clsx('text-[12px]')}>
                {t(
                  'by_registering_you_agree_to_our',
                  'By registering you agree to our'
                )}
                &nbsp;
                <a
                  href={`https://postmill.com/terms`}
                  className="underline hover:font-bold"
                  rel="nofollow"
                >
                  {t('terms_of_service', 'Terms of Service')}
                </a>
                &nbsp;
                {t('and', 'and')}&nbsp;
                <a
                  href={`https://postmill.com/privacy`}
                  rel="nofollow"
                  className="underline hover:font-bold"
                >
                  {t('privacy_policy', 'Privacy Policy')}
                </a>
                &nbsp;
              </div>
              <div className="text-center mt-6">
                <div className="w-full flex">
                  <Button
                    type="submit"
                    className="flex-1 rounded-[10px] !h-[52px]"
                    loading={loading}
                  >
                    {t('create_account', 'Create Account')}
                  </Button>
                </div>
                <p className="mt-4 text-sm">
                  {t('already_have_an_account', 'Already Have An Account?')}
                  &nbsp;
                  <Link
                    href="/auth/login"
                    className="underline  cursor-pointer"
                  >
                    {t('sign_in', 'Sign In')}
                  </Link>
                </p>
              </div>
            </div>
          </div>
        </div>
      </form>
    </FormProvider>
  );
}
