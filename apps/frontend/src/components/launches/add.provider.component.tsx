'use client';

import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { usePermissions } from '@gitroom/frontend/components/layout/use-permissions';
import React, { FC, useCallback, useMemo } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { Input } from '@gitroom/react/form/input';
import { FieldValues, FormProvider, useForm } from 'react-hook-form';
import { Button } from '@gitroom/react/form/button';
import { useRouter } from 'next/navigation';
import { TopTitle } from '@gitroom/frontend/components/launches/helpers/top.title.component';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { object, string } from 'yup';
import { yupResolver } from '@hookform/resolvers/yup';
import { web3List } from '@gitroom/frontend/components/launches/web3/web3.list';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import clsx from 'clsx';
import Image from 'next/image';
import copy from 'copy-to-clipboard';
import { capitalize } from 'lodash';
export const useAddProvider = (
  update?: () => void,
  invite?: boolean,
  campaignId?: string
) => {
  const modal = useModals();
  const fetch = useFetch();
  const t = useT();
  return useCallback(async () => {
    const data = await (await fetch('/integrations')).json();
    modal.openModal({
      title: t('add_channel', 'Add Channel'),
      withCloseButton: true,
      children: (
        <AddProviderComponent
          invite={!!invite}
          update={update}
          campaignId={campaignId}
          {...data}
        />
      ),
    });
  }, [update, invite, campaignId, fetch, modal]);
};
export const AddProviderButton: FC<{
  update?: () => void;
}> = (props) => {
  const { update } = props;
  const add = useAddProvider(update);
  const invite = useAddProvider(update, true);
  const t = useT();
  const permissions = usePermissions();
  // Connecting/inviting a channel hits endpoints gated by
  // @RequirePermission('channels','create'); hide the trigger for members who
  // lack it (backend still 403s — UI gating only).
  if (!permissions.hasPermission('channels', 'create')) {
    return null;
  }

  return (
    <div className="flex group-[.sidebar]:block gap-[8px]">
      <button
        className="flex-1 group-[.sidebar]:w-[100%] group-[.sidebar]:flex-none text-btnText bg-btnSimple h-[44px] pt-[12px] pb-[14px] ps-[16px] pe-[20px] justify-center items-center flex rounded-[8px] gap-[8px]"
        onClick={add}
      >
        <div>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
          >
            <path
              d="M1.66675 10.0417C3.35907 10.2299 4.93698 10.9884 6.14101 12.1924C7.34504 13.3964 8.10353 14.9743 8.29175 16.6667M1.66675 13.4167C2.46749 13.58 3.20253 13.9751 3.7804 14.553C4.35827 15.1309 4.75344 15.8659 4.91675 16.6667M1.66675 16.6667H1.67508M11.6667 17.5H14.3334C15.7335 17.5 16.4336 17.5 16.9684 17.2275C17.4388 16.9878 17.8212 16.6054 18.0609 16.135C18.3334 15.6002 18.3334 14.9001 18.3334 13.5V6.5C18.3334 5.09987 18.3334 4.3998 18.0609 3.86502C17.8212 3.39462 17.4388 3.01217 16.9684 2.77248C16.4336 2.5 15.7335 2.5 14.3334 2.5H5.66675C4.26662 2.5 3.56655 2.5 3.03177 2.77248C2.56137 3.01217 2.17892 3.39462 1.93923 3.86502C1.66675 4.3998 1.66675 5.09987 1.66675 6.5V6.66667"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div className="text-start text-[14px] group-[.sidebar]:hidden">
          {t('add_channel', 'Add Channel')}
        </div>
      </button>
      <button
        onClick={invite}
        data-tooltip-id="tooltip"
        data-tooltip-content={t(
          'invite_link',
          'Send Invite Link to a customer to add channel'
        )}
        className="group-[.sidebar]:hidden min-h-[44px] min-w-[44px] bg-btnSimple justify-center items-center flex rounded-[8px] cursor-pointer"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 16 16"
          fill="none"
        >
          <g clipPath="url(#clip0_2452_193804)">
            <path
              d="M6.6668 8.66599C6.9531 9.04875 7.31837 9.36545 7.73783 9.59462C8.1573 9.82379 8.62114 9.96007 9.0979 9.99422C9.57466 10.0284 10.0532 9.95957 10.501 9.79251C10.9489 9.62546 11.3555 9.36404 11.6935 9.02599L13.6935 7.02599C14.3007 6.39732 14.6366 5.55531 14.629 4.68132C14.6215 3.80733 14.2709 2.97129 13.6529 2.35326C13.0348 1.73524 12.1988 1.38467 11.3248 1.37708C10.4508 1.36948 9.60881 1.70547 8.98013 2.31266L7.83347 3.45266M9.33347 7.33266C9.04716 6.94991 8.68189 6.6332 8.26243 6.40403C7.84297 6.17486 7.37913 6.03858 6.90237 6.00444C6.4256 5.97029 5.94708 6.03908 5.49924 6.20614C5.0514 6.3732 4.64472 6.63461 4.3068 6.97266L2.3068 8.97266C1.69961 9.60133 1.36363 10.4433 1.37122 11.3173C1.37881 12.1913 1.72938 13.0274 2.3474 13.6454C2.96543 14.2634 3.80147 14.614 4.67546 14.6216C5.54945 14.6292 6.39146 14.2932 7.02013 13.686L8.16013 12.546"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            ></path>
          </g>
          <defs>
            <clipPath id="clip0_2452_193804">
              <rect width="16" height="16" fill="textColor"></rect>
            </clipPath>
          </defs>
        </svg>
      </button>
    </div>
  );
};

export const UrlModal: FC<{
  gotoUrl(url: string): void;
}> = (props) => {
  const { gotoUrl } = props;
  const methods = useForm({
    mode: 'onChange',
  });

  const t = useT();

  const submit = useCallback(async (data: FieldValues) => {
    gotoUrl(data.url);
  }, [gotoUrl]);
  return (
    <div className="rounded-[4px] border border-newTableBorder bg-newBgColorInner px-[16px] pb-[16px] relative">
      <TopTitle title={t('top_title_instance_url', 'Instance URL')} />
      <FormProvider {...methods}>
        <form
          className="gap-[8px] flex flex-col"
          onSubmit={methods.handleSubmit(submit)}
        >
          <div className="pt-[10px]">
            <Input label={t('url', 'URL')} name="url" />
          </div>
          <div>
            <Button type="submit">{t('connect', 'Connect')}</Button>
          </div>
        </form>
      </FormProvider>
    </div>
  );
};
export const CustomVariables: FC<{
  variables: Array<{
    key: string;
    label: string;
    defaultValue?: string;
    validation: string;
    type: 'text' | 'password';
  }>;
  close?: () => void;
  identifier: string;
  gotoUrl(url: string): void;
  onboarding?: boolean;
  config?: string;
  campaign?: string;
}> = (props) => {
  const { close, gotoUrl, identifier, variables, onboarding, config, campaign } = props;
  const fetch = useFetch();
  const modals = useModals();
  const toaster = useToaster();
  const t = useT();
  const schema = useMemo(() => {
    return object({
      ...variables.reduce((aIcc, item) => {
        const splitter = item.validation.split('/');
        const regex = new RegExp(
          splitter.slice(1, -1).join('/'),
          splitter.pop()
        );
        return {
          ...aIcc,
          [item.key]: string()
            .matches(regex, `${item.label} is invalid`)
            .required(),
        };
      }, {}),
    });
  }, [variables]);
  const methods = useForm({
    mode: 'onChange',
    resolver: yupResolver(schema),
    values: variables.reduce(
      (acc, item) => ({
        ...acc,
        ...(item.defaultValue
          ? {
              [item.key]: item.defaultValue,
            }
          : {}),
      }),
      {}
    ),
  });
  const submit = useCallback(
    async (data: FieldValues) => {
      try {
        const query = [
          onboarding ? 'onboarding=true' : '',
          config ? `config=${config}` : '',
          campaign ? `campaign=${campaign}` : '',
        ]
          .filter(Boolean)
          .join('&');
        const { url } = await (
          await fetch(
            `/integrations/social/${identifier}${query ? `?${query}` : ''}`
          )
        ).json();
        modals.closeAll();
        gotoUrl(
          `/integrations/social/${identifier}?state=${url}&code=${btoa(
            JSON.stringify(data)
          )}${onboarding ? '&onboarding=true' : ''}`
        );
      } catch {
        toaster.show(
          t('failed_to_connect_to_provider', 'Failed to connect to provider'),
          'warning'
        );
      }
    },
    [variables, onboarding, config, campaign, gotoUrl, identifier, fetch, modals, toaster]
  );

  return (
    <div className="rounded-[4px] relative">
      <FormProvider {...methods}>
        <form
          className="gap-[8px] flex flex-col pt-[10px]"
          onSubmit={methods.handleSubmit(submit)}
        >
          {variables.map((variable) => (
            <div key={variable.key}>
              <Input
                label={variable.label}
                name={variable.key}
                type={variable.type == 'text' ? 'text' : 'password'}
              />
            </div>
          ))}
          <div>
            <Button type="submit">{t('connect', 'Connect')}</Button>
          </div>
        </form>
      </FormProvider>
    </div>
  );
};
const ExtensionNotFound: FC = () => {
  const modals = useModals();
  const t = useT();
  return (
    <div className="flex flex-col gap-[16px] pt-[8px]">
      <p className="text-[14px] text-textColor/80">
        {t(
          'extension_not_available',
          'The Postmill browser extension is not installed. You need to install it before connecting this channel.'
        )}
      </p>
      <div className="flex gap-[10px]">
        <Button
          type="button"
          className="flex-1"
          onClick={() => {
            window.open(
              'https://chromewebstore.google.com/detail/postiz/cidhffagahknaeodkplfbcpfeielnkjl?hl=en',
              '_blank'
            );
            modals.closeCurrent();
          }}
        >
          {t('install_extension', 'Install Extension')}
        </Button>
        <Button
          type="button"
          className="flex-1 !bg-transparent border border-newTableBorder text-textColor"
          onClick={() => modals.closeCurrent()}
        >
          {t('cancel', 'Cancel')}
        </Button>
      </div>
    </div>
  );
};

const ChromeExtensionWarning: FC<{
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ onConfirm, onCancel }) => {
  const modals = useModals();
  const t = useT();
  return (
    <div className="flex flex-col gap-[16px] pt-[8px]">
      <p className="text-[14px] text-textColor/80">
        {t(
          'chrome_extension_warning_intro',
          'This channel connects via the browser extension. Please be aware of the following:'
        )}
      </p>
      <ul className="flex flex-col gap-[8px] list-disc ps-[20px] text-[14px] text-textColor/80">
        <li>
          {t(
            'chrome_extension_warning_tos',
            'Using a browser extension to interact with a platform may violate its terms of service and could result in your account being suspended or banned.'
          )}
        </li>
        <li>
          {t(
            'chrome_extension_warning_unstable',
            'This method is not as reliable as native integrations and may experience random disconnections.'
          )}
        </li>
        <li>
          {t(
            'chrome_extension_warning_reconnect',
            'You may need to reconnect periodically if the session expires.'
          )}
        </li>
        <li>
          {t(
            'chrome_extension_warning_cookies',
            'We will store your cookies securely to facilitate the connection.'
          )}
        </li>
        <li>
          {t(
            'chrome_extension_warning_liability',
            'Postmill does not take responsibility for any issues arising or account termination due to the use of this method.'
          )}
        </li>
      </ul>
      <div className="flex gap-[10px] mt-[8px]">
        <Button
          type="button"
          className="flex-1"
          onClick={() => {
            modals.closeCurrent();
            onConfirm();
          }}
        >
          {t('i_understand_continue', 'I understand, continue')}
        </Button>
        <Button
          type="button"
          className="flex-1 !bg-transparent border border-newTableBorder text-textColor"
          onClick={() => {
            modals.closeCurrent();
            onCancel();
          }}
        >
          {t('cancel', 'Cancel')}
        </Button>
      </div>
    </div>
  );
};

// When a provider has more than one configured credential set, let the user choose
// which one to connect through (each set has its own OAuth app credentials).
const ConfigPicker: FC<{
  sets: Array<{ id: string; name: string }>;
  onResolve: (id?: string) => void;
}> = ({ sets, onResolve }) => {
  const modals = useModals();
  const t = useT();
  return (
    <div className="flex flex-col gap-[10px] pt-[8px]">
      <p className="text-[14px] text-textColor/80">
        {t(
          'choose_config_desc',
          'This provider has multiple credential sets. Choose which one to connect with:'
        )}
      </p>
      <div className="flex flex-col gap-[6px]">
        {sets.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => {
              modals.closeCurrent();
              onResolve(s.id);
            }}
            className="text-start p-[10px] rounded-[8px] border border-newTableBorder hover:bg-boxHover text-[14px] text-textColor"
          >
            {s.name}
          </button>
        ))}
      </div>
      <Button
        type="button"
        className="!bg-transparent border border-newTableBorder text-textColor"
        onClick={() => {
          modals.closeCurrent();
          onResolve(undefined);
        }}
      >
        {t('cancel', 'Cancel')}
      </Button>
    </div>
  );
};

export const AddProviderComponent: FC<{
  social: Array<{
    identifier: string;
    name: string;
    toolTip?: string;
    isExternal: boolean;
    isWeb3: boolean;
    isChromeExtension?: boolean;
    extensionCookies?: Array<{
      name: string;
      domain: string;
    }>;
    customFields?: Array<{
      key: string;
      label: string;
      validation: string;
      type: 'text' | 'password';
    }>;
    setupInstructions?: string;
  }>;
  article: Array<{
    identifier: string;
    name: string;
  }>;
  invite: boolean;
  update?: () => void;
  onboarding?: boolean;
  isMobile?: boolean;
  campaignId?: string;
}> = (props) => {
  const { update, social, onboarding, isMobile, campaignId } = props;
  const t = useT();
  const { isGeneral, extensionId } = useVariables();
  const toaster = useToaster();
  const router = useRouter();
  const fetch = useFetch();
  const modal = useModals();

  // The org's configured credential sets, grouped by provider. Used to bind a new
  // connection to a specific named set when a provider has more than one. Requires
  // channel-admin rights; non-admins get an empty map and the legacy (primary) flow.
  const { data: channelConfigs } = useSWR<
    Array<{ id: string; identifier: string; name: string; enabled: boolean; isConfigured: boolean }>
  >('/channels/config', (url: string) =>
    fetch(url)
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => [])
  );
  const configsByIdentifier = useMemo(() => {
    const map: Record<string, Array<{ id: string; name: string }>> = {};
    for (const c of channelConfigs || []) {
      if (c.enabled && c.isConfigured) {
        (map[c.identifier] ||= []).push({ id: c.id, name: c.name });
      }
    }
    return map;
  }, [channelConfigs]);

  const getSocialLink = useCallback(
    (
        invite: boolean,
        identifier: string,
        isExternal: boolean,
        isWeb3: boolean,
        isChromeExtension?: boolean,
        customFields?: Array<{
          key: string;
          label: string;
          validation: string;
          defaultValue?: string;
          type: 'text' | 'password';
        }>
      ) =>
      async () => {
        // Resolve which named credential set to connect through. >1 set ⇒ prompt;
        // exactly one ⇒ bind it automatically; none ⇒ legacy primary-config flow.
        const sets = configsByIdentifier[identifier] || [];
        let configId: string | undefined;
        if (!invite && sets.length > 1) {
          configId = await new Promise<string | undefined>((resolve) => {
            let settled = false;
            const done = (id?: string) => {
              if (!settled) {
                settled = true;
                resolve(id);
              }
            };
            modal.openModal({
              title: t('choose_channel_config', 'Choose a configuration'),
              withCloseButton: true,
              onClose: () => done(undefined),
              children: <ConfigPicker sets={sets} onResolve={done} />,
            });
          });
          if (!configId) return;
        } else if (sets.length === 1) {
          configId = sets[0].id;
        }
        const configParam = configId ? `config=${configId}` : '';
        // Campaign-scoped connect/invite: bind the campaign so the OAuth callback
        // auto-tags the new channel onto it (covers both direct connect and invite).
        const campaignParam = campaignId ? `campaign=${campaignId}` : '';
        const socialUrl = () => {
          const q = [onboarding ? 'onboarding=true' : '', configParam, campaignParam]
            .filter(Boolean)
            .join('&');
          return `/integrations/social/${identifier}${q ? `?${q}` : ''}`;
        };
        const onboardingParam = onboarding ? 'onboarding=true' : '';
        const openWeb3 = async () => {
          const found = web3List.find(
            (item) => item.identifier === identifier
          );
          if (!found) {
            toaster.show(
              t('web3_provider_not_found', 'Web3 provider not found'),
              'warning'
            );
            return;
          }
          const { component: Web3Providers } = found;
          let url: string;
          try {
            const response = await fetch(socialUrl());
            const data = await response.json();
            url = data.url;
          } catch {
            toaster.show(
              t('failed_to_connect_to_provider', 'Failed to connect to provider'),
              'warning'
            );
            return;
          }
          modal.openModal({
            title: t('add_provider_modal_title', 'Add {{provider}}', {
              provider: capitalize(identifier),
            }),
            withCloseButton: true,
            ...(isMobile ? { removeLayout: true, fullScreen: true } : {}),
            classNames: {
              modal: 'bg-transparent text-textColor',
            },
            children: (
              <div
                {...(isMobile ? { className: 'h-full bg-black p-[20px]' } : {})}
              >
                <Web3Providers
                  onComplete={(code, newState) => {
                    window.location.href = `/integrations/social/${identifier}?code=${code}&state=${newState}${
                      onboarding ? '&onboarding=true' : ''
                    }`;
                  }}
                  nonce={url}
                />
              </div>
            ),
          });
          return;
        };
        const gotoIntegration = async (externalUrl?: string) => {
          // Mobile WebView: reuse the existing `externalUrl` param to
          // carry the `postmill://` deep link so the backend redirects
          // back to the iOS/Android app after OAuth completes, instead
          // of the default web redirect.
          const params = [
            ...(externalUrl ? [`externalUrl=${encodeURIComponent(externalUrl)}`] : []),
            onboardingParam,
            configParam,
            campaignParam,
            isMobile
              ? `redirectUrl=${encodeURIComponent('postmill://integrations')}`
              : '',
          ]
            .filter(Boolean)
            .join('&');
          let url: string;
          let err: string;
          try {
            const response = await fetch(
              `/integrations/social/${identifier}${params ? `?${params}` : ''}`
            );
            const data = await response.json();
            url = data.url;
            err = data.err;
          } catch {
            toaster.show(
              t(
                'could_not_connect_to_platform',
                'Could not connect to the platform'
              ),
              'warning'
            );
            return;
          }
          if (err) {
            toaster.show(
              t(
                'could_not_connect_to_platform',
                'Could not connect to the platform'
              ),
              'warning'
            );
            return;
          }

          if (invite) {
            toaster.show(
              t(
                'invite_link_copied',
                'Invite link copied to clipboard, link will be available for 1 hour'
              ),
              'success'
            );
            modal.closeAll();
            copy(url);
            return;
          }

          if (isMobile) {
            // In the mobile WebView the OAuth provider (Google, Facebook,
            // etc.) typically refuses in-WebView sign-in. Post the URL
            // out to React Native so it can open the system browser;
            // `window.open`/`location.href` aren't reliable here because
            // RN WebView doesn't always route them through the native
            // navigation intercept. The backend redirects back to the
            // app via `postmill://` once OAuth completes.
            const rn = (window as any).ReactNativeWebView;
            if (rn && typeof rn.postMessage === 'function') {
              rn.postMessage(JSON.stringify({ type: 'open-external', url }));
              return;
            }
            window.open(url, '_blank');
            return;
          }

          window.location.href = url;
        };
        if (isWeb3) {
          openWeb3();
          return;
        }
        if (isChromeExtension) {
          const confirmed = await new Promise<boolean>((resolve) => {
            modal.openModal({
              title: t('chrome_extension_notice', 'Browser Extension Notice'),
              withCloseButton: true,
              onClose: () => resolve(false),
              children: (
                <ChromeExtensionWarning
                  onConfirm={() => {
                    resolve(true);
                  }}
                  onCancel={() => {
                    resolve(false);
                  }}
                />
              ),
            });
          });
          if (!confirmed) {
            return;
          }
          if (!extensionId || !chrome?.runtime?.sendMessage) {
            modal.openModal({
              title: t('extension_not_available_title', 'Extension Not Found'),
              withCloseButton: true,
              children: <ExtensionNotFound />,
            });
            return;
          }
          try {
            await new Promise<void>((resolve, reject) => {
              chrome.runtime.sendMessage(
                extensionId,
                { type: 'PING' },
                (response: any) => {
                  if (chrome.runtime.lastError || !response?.status) {
                    reject(new Error('Extension not reachable'));
                  } else {
                    resolve();
                  }
                }
              );
            });
          } catch {
            toaster.show(
              t(
                'extension_not_installed',
                'Postmill browser extension is not installed or not reachable.'
              ),
              'warning'
            );
            return;
          }
          try {
            const cookieResponse = await new Promise<any>((resolve, reject) => {
              chrome.runtime.sendMessage(
                extensionId,
                { type: 'GET_COOKIES', provider: identifier },
                (response: any) => {
                  if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                  } else {
                    resolve(response);
                  }
                }
              );
            });
            if (!cookieResponse.success) {
              toaster.show(
                cookieResponse.error ||
                  t(
                    'extension_cookies_missing',
                    'Could not get cookies. Please log in to the platform first.'
                  ),
                'warning'
              );
              return;
            }
            let url: string;
            try {
              const response = await fetch(socialUrl());
              const data = await response.json();
              url = data.url;
            } catch {
              toaster.show(
                t('failed_to_connect_to_provider', 'Failed to connect to provider'),
                'warning'
              );
              return;
            }
            modal.closeAll();
            window.location.href = `/integrations/social/${identifier}?state=${url}&code=${btoa(
              JSON.stringify(cookieResponse.cookies)
            )}${onboarding ? '&onboarding=true' : ''}`;
          } catch {
            toaster.show(
              t(
                'extension_communication_error',
                'Failed to communicate with the browser extension.'
              ),
              'warning'
            );
          }
          return;
        }
        if (isExternal) {
          modal.openModal({
            title: t('url', 'URL'),
            withCloseButton: true,
            ...(isMobile ? { removeLayout: true, fullScreen: true } : {}),
            classNames: {
              modal: 'bg-transparent text-textColor',
            },
            children: <UrlModal gotoUrl={gotoIntegration} />,
          });
          return;
        }
        if (customFields) {
          modal.openModal({
            title: t('add_provider_title', 'Add Provider'),
            withCloseButton: true,
            ...(isMobile ? { removeLayout: true, fullScreen: true } : {}),
            classNames: {
              modal: 'bg-transparent text-textColor',
            },
            children: (
              <div
                {...(isMobile ? { className: 'h-full bg-black p-[20px]' } : {})}
              >
                <CustomVariables
                  identifier={identifier}
                  gotoUrl={(url: string) => router.push(url)}
                  variables={customFields}
                  onboarding={onboarding}
                  config={configId}
                  campaign={campaignId}
                />
              </div>
            ),
          });
          return;
        }
        await gotoIntegration();
      },
    [onboarding, t, isMobile, fetch, toaster, modal, router, extensionId, configsByIdentifier, campaignId]
  );

  const showSetupInstructions = useCallback(
    (name: string, identifier: string, instructions: string) =>
      (e: React.MouseEvent) => {
        e.stopPropagation();
        modal.openModal({
          title: t('setup_instructions_title', 'Setup: {{name}}', { name }),
          withCloseButton: true,
          children: (
            <div className="p-[16px] max-h-[60vh] overflow-y-auto">
              <div className="whitespace-pre-wrap text-[14px] text-textColor break-words">{instructions}</div>
              {!instructions && (
                <div className="text-textColor/50 text-[14px]">
                  {t(
                    'no_setup_instructions',
                    'No setup instructions available. This channel uses OAuth authentication. Click the channel icon to connect.'
                  )}
                </div>
              )}
            </div>
          ),
        });
      },
    [modal, t]
  );

  return (
    <div className="w-full flex flex-col gap-[20px] rounded-[4px] relative">
      <div className="flex flex-col">
        <div
          className={clsx(
            isMobile && 'gap-[20px] flex flex-col',
            !isMobile &&
              'grid grid-cols-5 gap-[10px] justify-items-center justify-center',
            isMobile ? {} : onboarding ? 'grid-cols-9' : 'grid-cols-5'
          )}
        >
          {social
            .filter((item) => {
              if (!props.invite) {
                return true;
              }

              return (
                !item.isExternal &&
                !item.isWeb3 &&
                !item.isChromeExtension &&
                !item.customFields
              );
            })
            .map((item) => (
              <div
                key={item.identifier}
                onClick={getSocialLink(
                  props.invite,
                  item.identifier,
                  item.isExternal,
                  item.isWeb3,
                  item.isChromeExtension,
                  item.customFields
                )}
                {...(!!item.toolTip
                  ? {
                      'data-tooltip-id': 'tooltip',
                      'data-tooltip-content': item.toolTip,
                    }
                  : {})}
                className={clsx(
                  isMobile
                    ? 'flex-row h-[72px] p-[16px]'
                    : 'flex-col p-[10px] h-[100px] justify-center',
                  'w-full text-[14px] rounded-[8px] bg-newTableHeader text-textColor relative items-center flex gap-[10px] cursor-pointer'
                )}
              >
                <div>
                  {item.identifier === 'youtube' ? (
                    <Image
                      alt="YouTube"
                      src="/icons/platforms/youtube.svg"
                      width={32}
                      height={32}
                      unoptimized
                    />
                  ) : (
                    <Image
                      alt=""
                      className={clsx(
                        'w-[32px] h-[32px]',
                        item.identifier !== 'google_my_business' &&
                          'rounded-full'
                      )}
                      src={`/icons/platforms/${item.identifier}.png`}
                      width={32}
                      height={32}
                    />
                  )}
                </div>
                <div
                  className={clsx(
                    isMobile ? '' : 'whitespace-pre-wrap',
                    'text-center'
                  )}
                >
                  {item.name}
                  {(!!item.setupInstructions || !!item.toolTip) && !isMobile && (
                    <div
                      className="absolute top-[6px] end-[6px] w-[22px] h-[22px] flex items-center justify-center rounded-full hover:bg-tableBorder cursor-help z-10"
                      onClick={showSetupInstructions(
                        item.name,
                        item.identifier,
                        item.setupInstructions || item.toolTip || ''
                      )}
                      title={
                        item.setupInstructions
                          ? t('view_setup_instructions', 'View setup instructions')
                          : item.toolTip
                      }
                    >
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 26 26"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M13 0C10.4288 0 7.91543 0.762437 5.77759 2.1909C3.63975 3.61935 1.97351 5.64968 0.989572 8.02512C0.0056327 10.4006 -0.251811 13.0144 0.249797 15.5362C0.751405 18.0579 1.98953 20.3743 3.80762 22.1924C5.6257 24.0105 7.94208 25.2486 10.4638 25.7502C12.9856 26.2518 15.5995 25.9944 17.9749 25.0104C20.3503 24.0265 22.3807 22.3603 23.8091 20.2224C25.2376 18.0846 26 15.5712 26 13C25.9964 9.5533 24.6256 6.24882 22.1884 3.81163C19.7512 1.37445 16.4467 0.00363977 13 0ZM13 21C12.7033 21 12.4133 20.912 12.1667 20.7472C11.92 20.5824 11.7277 20.3481 11.6142 20.074C11.5007 19.7999 11.471 19.4983 11.5288 19.2074C11.5867 18.9164 11.7296 18.6491 11.9393 18.4393C12.1491 18.2296 12.4164 18.0867 12.7074 18.0288C12.9983 17.9709 13.2999 18.0007 13.574 18.1142C13.8481 18.2277 14.0824 18.42 14.2472 18.6666C14.412 18.9133 14.5 19.2033 14.5 19.5C14.5 19.8978 14.342 20.2794 14.0607 20.5607C13.7794 20.842 13.3978 21 13 21ZM14 14.91V15C14 15.2652 13.8946 15.5196 13.7071 15.7071C13.5196 15.8946 13.2652 16 13 16C12.7348 16 12.4804 15.8946 12.2929 15.7071C12.1054 15.5196 12 15.2652 12 15V14C12 13.7348 12.1054 13.4804 12.2929 13.2929C12.4804 13.1054 12.7348 13 13 13C14.6538 13 16 11.875 16 10.5C16 9.125 14.6538 8 13 8C11.3463 8 10 9.125 10 10.5V11C10 11.2652 9.89465 11.5196 9.70711 11.7071C9.51958 11.8946 9.26522 12 9.00001 12C8.73479 12 8.48044 11.8946 8.2929 11.7071C8.10536 11.5196 8.00001 11.2652 8.00001 11V10.5C8.00001 8.01875 10.2425 6 13 6C15.7575 6 18 8.01875 18 10.5C18 12.6725 16.28 14.4913 14 14.91Z"
                          fill="currentColor"
                        />
                      </svg>
                    </div>
                  )}
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
};
