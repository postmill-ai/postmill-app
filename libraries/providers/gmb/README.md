# @gitroom/provider-gmb

Google My Business (Business Profile) social provider (`social/gmb@v1`).

## SSRF / VPN egress posture

OAuth token calls use the official `googleapis` SDK (`google.auth.OAuth2`). The
SDK creates its own Gaxios HTTP client and does not expose a hook that accepts a
custom undici `Dispatcher`. Therefore these calls cannot ride
`SocialAbstract.fetch()` and the per-channel VPN dispatcher (`getVpnDispatcher()`)
is not applied. The posting/analytics paths in this adapter already use
`SocialAbstract.fetch()` directly for the GMB REST endpoints and **do** pick up
the SSRF dispatcher and per-channel VPN egress.

### Known proxy gap

- `clientAndGmb()` → `google.auth.OAuth2` token exchange (`getToken`,
  `refreshAccessToken`, `getTokenInfo`).
- `oauth2.userinfo.get`.

SSRF protection for the fixed `*.googleapis.com` endpoints is still provided by
normal TCP routing and the public nature of the hosts. The gap is specifically
per-channel VPN egress on the OAuth leg. Closing it would require a custom
Gaxios adapter/fetchImplementation that translates `GaxiosOptions` into undici
requests with the active dispatcher.
