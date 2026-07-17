# @gitroom/provider-youtube

YouTube social provider (`social/youtube@v1`) and analytics.

## SSRF / VPN egress posture

Posting, analytics, and OAuth token calls use the official `googleapis` SDK.
The SDK creates its own `google.auth.OAuth2` and `google.youtube` clients backed
by Gaxios, and it does not expose a hook that accepts a custom undici
`Dispatcher`. Therefore these calls cannot ride `SocialAbstract.fetch()` and the
per-channel VPN dispatcher (`getVpnDispatcher()`) is not applied.

### Known proxy gap

- `clientAndYoutube()` → `google.auth.OAuth2` token exchange (`getToken`,
  `refreshAccessToken`, `getTokenInfo`).
- `youtubeClient.videos.insert` / `.thumbnails.set` / `.channels.list` /
  `.commentThreads.list` / `.comments.insert`.
- `youtubeAnalyticsClient.reports.query`.
- `oauth2.userinfo.get`.

SSRF protection for the fixed `*.googleapis.com` endpoints is still provided by
normal TCP routing and the public nature of the hosts. The gap is specifically
per-channel VPN egress. Closing it would require a custom Gaxios
adapter/fetchImplementation that translates `GaxiosOptions` into undici requests
with the active dispatcher.
