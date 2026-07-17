# @gitroom/provider-medium

Medium social provider (`social/medium@v1`).

## SSRF / VPN egress posture

All outbound HTTP to the fixed Medium API host (`https://api.medium.com`) now routes
through `SocialAbstract.fetch()` (`authenticate` → `/v1/me`, the `publications` tool →
`/v1/users/:id/publications`, and `post` → `/v1/...posts`). That picks up the
`ssrfSafeDispatcher` (connect-time private-IP blocking, incl. redirect hops) **and**
per-channel VPN egress when a VPN selection is active for the channel.

### Known proxy gap

None. There are no remaining bare `fetch`/`axios`/SDK calls in this package — every
network call is a `MediumProvider` method going through `this.fetch()`.
