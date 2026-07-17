# @gitroom/provider-google

Google OAuth auth provider (`auth/google@v1`) used for login.

## SSRF / VPN egress posture

This adapter uses the official `googleapis` SDK (`google.auth.OAuth2`) for OAuth
link generation, token exchange, and userinfo retrieval. The SDK creates its own
Gaxios HTTP client and does not expose a hook that accepts a custom undici
`Dispatcher`. Therefore these calls cannot ride `SocialAbstract.fetch()` and the
per-channel VPN dispatcher (`getVpnDispatcher()`) is not applied.

### Known proxy gap

- `makeClient()` → `google.auth.OAuth2` (`generateAuthUrl`, `getToken`).
- `google.oauth2({ version: 'v2', auth: client }).userinfo.get`.

The hosts are fixed first-party Google endpoints, so SSRF risk is low; the gap
is specifically per-channel VPN egress. Closing it would require a custom Gaxios
adapter/fetchImplementation that translates `GaxiosOptions` into undici requests
with the active dispatcher.
