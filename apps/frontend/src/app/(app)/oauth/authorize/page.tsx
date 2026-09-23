'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { Logo } from '@postmill-ai/frontend/components/new-layout/logo';

// 3.3: hoisted to module scope. Human-readable description per granted scope so the
// user sees what they approve instead of a hardcoded, possibly-wrong capability list.
// `mcp:admin` is intentionally absent — no tool enforces it and it is no longer
// advertised in scopes_supported, so it must never be presented as a grantable scope.
const SCOPE_LABELS: Record<string, { key: string; text: string }> = {
  'mcp:read': {
    key: 'oauth_scope_mcp_read',
    text: 'Read your integrations, posts, and analytics',
  },
  'mcp:posts:write': {
    key: 'oauth_scope_mcp_posts_write',
    text: 'Create, schedule, and publish posts on your behalf',
  },
  profile: {
    key: 'oauth_scope_profile',
    text: 'Read your name and profile picture',
  },
  email: {
    key: 'oauth_scope_email',
    text: 'Read your email address',
  },
  org: {
    key: 'oauth_scope_org',
    text: 'Read the organization you are currently using and your role in it',
  },
};

// First-party federation clients pinned in the product (no OAuth app registration).
// The backend validates redirect_uri against its own allow-list; this is display
// metadata only.
const FEDERATION_CLIENTS: Record<string, { name: string; description: string }> = {
  federation: {
    name: 'Postmill Template Store',
    description: 'Sign in with your Postmill account',
  },
};

export default function OAuthAuthorizePage() {
  const t = useT();
  const searchParams = useSearchParams();
  const fetch = useFetch();
  const clientId = searchParams.get('client_id');
  const federationClient = searchParams.get('client');
  const isFederation = !!federationClient && !!FEDERATION_CLIENTS[federationClient];
  const responseType = searchParams.get('response_type');
  const state = searchParams.get('state');
  // These were previously read from the URL but never forwarded, so the consented
  // authorization code carried no scope/PKCE binding: scope silently defaulted and
  // the code_challenge was dropped (PKCE not bound at the step the user approved).
  const redirectUri = searchParams.get('redirect_uri');
  const codeChallenge = searchParams.get('code_challenge');
  const codeChallengeMethod = searchParams.get('code_challenge_method');
  const scope = searchParams.get('scope');
  const nonce = searchParams.get('nonce');

  const [appInfo, setAppInfo] = useState<any>(null);
  const [error, setError] = useState(() => {
    if (isFederation ? !redirectUri : !clientId || !responseType) {
      return t(
        'oauth_missing_required_params',
        'Missing required parameters (client_id, response_type)'
      );
    }
    if (!isFederation && responseType !== 'code') {
      return t(
        'oauth_only_code_supported',
        'Only response_type=code is supported'
      );
    }
    return '';
  });
  const [loading, setLoading] = useState(() => {
    return isFederation ? !!redirectUri : !!clientId && responseType === 'code';
  });
  const [submitting, setSubmitting] = useState(false);

  const requestedScopes = useMemo(
    () =>
      // 3.3: dedupe so `?scope=mcp:read+mcp:read` doesn't render duplicate React keys.
      [
        ...new Set(
          (scope || (isFederation ? 'profile email org' : 'mcp:read'))
            .split(/[\s,]+/)
            .map((s) => s.trim())
            .filter(Boolean)
        ),
      ],
    [scope, isFederation]
  );

  useEffect(() => {
    if (!loading) {
      return;
    }

    if (isFederation) {
      // Federation mode: no client_id lookup — the client is pinned in the
      // product. The backend re-validates redirect_uri against its allow-list.
      const params = new URLSearchParams({
        response_type: 'code',
        redirect_uri: redirectUri!,
        ...(state ? { state } : {}),
        ...(scope ? { scope } : {}),
      });

      fetch(`/federation/authorize?${params}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.statusCode && data.statusCode >= 400) {
            setError(
              data.message || t('oauth_invalid_request', 'Invalid OAuth request')
            );
          } else {
            setAppInfo({
              app: {
                name: FEDERATION_CLIENTS[federationClient!].name,
                description: FEDERATION_CLIENTS[federationClient!].description,
                picture: null,
              },
            });
          }
          setLoading(false);
        })
        .catch(() => {
          setError(
            t('oauth_failed_validate_request', 'Failed to validate OAuth request')
          );
          setLoading(false);
        });
      return;
    }

    const params = new URLSearchParams({
      client_id: clientId!,
      response_type: responseType!,
      ...(state ? { state } : {}),
      // 3.3: include redirect_uri (and scope) so a redirect_uri mismatch errors
      // here — before the user ever sees an Authorize button — instead of only at
      // POST time. AuthorizeOAuthQueryDto already declares these.
      ...(redirectUri ? { redirect_uri: redirectUri } : {}),
      ...(scope ? { scope } : {}),
    });

    fetch(`/oauth/authorize?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.statusCode && data.statusCode >= 400) {
          setError(
            data.message || t('oauth_invalid_request', 'Invalid OAuth request')
          );
        } else {
          setAppInfo(data);
        }
        setLoading(false);
      })
      .catch(() => {
        setError(
          t('oauth_failed_validate_request', 'Failed to validate OAuth request')
        );
        setLoading(false);
      });
  }, [clientId, responseType, state, redirectUri, scope, fetch, loading, t, isFederation, federationClient]);

  const handleAction = useCallback(
    async (action: 'approve' | 'deny') => {
      setSubmitting(true);
      try {
        const result = await (
          await fetch(isFederation ? '/federation/authorize' : '/oauth/authorize', {
            method: 'POST',
            body: JSON.stringify({
              ...(isFederation ? {} : { client_id: clientId }),
              state,
              action,
              // Forward what the user actually consented to so the authorization
              // code binds the requested scope + PKCE challenge (backend prefers
              // this over any scope re-requested at token exchange).
              ...(redirectUri ? { redirect_uri: redirectUri } : {}),
              ...(codeChallenge ? { code_challenge: codeChallenge } : {}),
              ...(codeChallengeMethod
                ? { code_challenge_method: codeChallengeMethod }
                : {}),
              ...(nonce ? { nonce } : {}),
              // Always bind exactly the scopes the user saw (defaulting to
              // mcp:read), so a client cannot re-request write/admin unbound at the
              // token-exchange step for something the user never approved here.
              scope: requestedScopes.join(' '),
            }),
          })
        ).json();

        // 3.3: the deny path already redirects with error=access_denied, so a
        // missing redirect means the POST failed (e.g. a 400 for a redirect_uri
        // mismatch or non-S256 challenge). Surface the message and re-enable the
        // buttons instead of dead-ending with both permanently disabled.
        if (!result.redirect) {
          setError(
            result.message ||
              t('oauth_authorization_failed', 'Authorization failed')
          );
          setSubmitting(false);
          return;
        }
        window.location.href = result.redirect;
      } catch {
        setError(
          t(
            'oauth_failed_process_authorization',
            'Failed to process authorization'
          )
        );
        setSubmitting(false);
      }
    },
    [
      fetch,
      clientId,
      state,
      redirectUri,
      codeChallenge,
      codeChallengeMethod,
      nonce,
      requestedScopes,
      isFederation,
      t,
    ]
  );

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-[20%] left-[10%] w-[300px] h-[300px] bg-[#2B5CD3] rounded-full blur-[120px]" />
          <div className="absolute bottom-[20%] right-[10%] w-[250px] h-[250px] bg-[#1d9bf0] rounded-full blur-[120px]" />
        </div>
        <div className="relative z-10 text-center">
          <div className="flex justify-center mb-[24px]">
            <Logo />
          </div>
          <div className="text-[16px] text-gray-400">
            {t('please_wait_ellipsis', 'Please wait...')}
          </div>
          <div className="mt-[32px] flex justify-center">
            <div className="w-[48px] h-[48px] border-[3px] border-[#2B5CD3] border-t-transparent rounded-full animate-spin" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-[20%] left-[10%] w-[300px] h-[300px] bg-[#2B5CD3] rounded-full blur-[120px]" />
          <div className="absolute bottom-[20%] right-[10%] w-[250px] h-[250px] bg-[#1d9bf0] rounded-full blur-[120px]" />
        </div>
        <div className="relative z-10 text-center">
          <div className="flex justify-center mb-[24px]">
            <Logo />
          </div>
          <div className="w-[80px] h-[80px] mx-auto mb-[24px] rounded-full bg-red-500/20 flex items-center justify-center">
            <svg
              className="w-[40px] h-[40px] text-red-500"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="text-[28px] font-semibold mb-[12px]">
            {t('oauth_authorization_error', 'Authorization Error')}
          </div>
          <div className="text-[16px] text-gray-400 max-w-[400px]">
            {error}
          </div>
        </div>
      </div>
    );
  }

  if (!appInfo) {
    return null;
  }

  return (
    <div className="flex flex-1 items-center justify-center text-white relative overflow-hidden">
      <div className="absolute inset-0 opacity-30">
        <div className="absolute top-[20%] left-[10%] w-[300px] h-[300px] bg-[#2B5CD3] rounded-full blur-[120px]" />
        <div className="absolute bottom-[20%] right-[10%] w-[250px] h-[250px] bg-[#1d9bf0] rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 w-full max-w-[500px] mx-auto px-[20px]">
        <div className="flex justify-center mb-[32px]">
          <Logo />
        </div>

        <div className="bg-[#1A1919] rounded-[16px] p-[32px] flex flex-col gap-[24px]">
          <div className="flex flex-col items-center gap-[16px]">
            {appInfo.app.picture?.path ? (
              // eslint-disable-next-line @next/next/no-img-element -- external OAuth app logo
              <img
                src={appInfo.app.picture.path}
                alt={appInfo.app.name}
                className="w-[64px] h-[64px] rounded-full object-cover"
              />
            ) : (
              <div className="w-[64px] h-[64px] rounded-full bg-[#2A2929] flex items-center justify-center text-[24px] text-gray-400">
                {appInfo.app.name?.[0]?.toUpperCase() || '?'}
              </div>
            )}
            <h2 className="text-[24px] font-semibold text-center">
              {appInfo.app.name}
            </h2>
            {appInfo.app.description && (
              <div className="text-gray-400 text-center text-[14px]">
                {appInfo.app.description}
              </div>
            )}
          </div>

          <div className="border-t border-[#2A2929] pt-[16px]">
            <div className="text-[14px] text-gray-400 mb-[12px]">
              {t(
                'oauth_requesting_access',
                'This application is requesting access to your Postmill account. It will be able to:'
              )}
            </div>
            <ul className="text-[14px] list-disc list-inside space-y-[4px]">
              {requestedScopes.map((s) =>
                SCOPE_LABELS[s] ? (
                  <li key={s}>{t(SCOPE_LABELS[s].key, SCOPE_LABELS[s].text)}</li>
                ) : (
                  // 3.3: never render a client-authored scope string as prose (it
                  // could be a reassuring sentence that diverges from the actual
                  // floored grant). Show the raw id in monospace, muted, with an
                  // explicit "Unrecognized scope" prefix.
                  <li key={s} className="text-gray-500">
                    {t('oauth_unrecognized_scope', 'Unrecognized scope:')}{' '}
                    <code className="font-mono text-gray-400">{s}</code>
                  </li>
                )
              )}
            </ul>
          </div>

          <div className="flex gap-[12px]">
            <button
              onClick={() => handleAction('approve')}
              disabled={submitting}
              className="flex-1 bg-[#2B5CD3] hover:bg-[#7B3FF2] disabled:opacity-50 text-white rounded-[8px] py-[10px] px-[16px] text-[14px] font-semibold transition-colors"
            >
              {t('authorize', 'Authorize')}
            </button>
            <button
              onClick={() => handleAction('deny')}
              disabled={submitting}
              className="flex-1 bg-[#2A2929] hover:bg-[#3A3939] disabled:opacity-50 text-white rounded-[8px] py-[10px] px-[16px] text-[14px] font-semibold transition-colors"
            >
              {t('deny', 'Deny')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
