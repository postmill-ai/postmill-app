# @gitroom/provider-linkedin

LinkedIn social provider (`social/linkedin@v1`).

## SSRF / VPN egress posture

This package is a thin wrapper: it instantiates and re-exports the `LinkedinProvider`
family base, whose implementation lives in
`@gitroom/provider-kernel` (`src/domains/social-families/linkedin-base.ts`). There are
**no outbound HTTP calls in this package's own `src/`** — `grep "axios\|fetch("` over
`libraries/providers/linkedin/src` is clean.

The provider's network code lives in the kernel base. **All of it now routes through
`SocialAbstract.fetch()`** — there is no remaining proxy gap:

- **Post / publish / comment-post / analytics paths** use `this.fetch()`
  (`https://api.linkedin.com/rest/posts`, media upload, etc.).
- **OAuth token exchange** (`.../oauth/v2/accessToken`, auth + refresh), **identity
  lookups** (`/v2/me`, `/v2/userinfo`), the **company/org** lookups, and the
  **comment-auth** path were converted from bare `fetch()` to `this.fetch()`
  (ENHANCEMENTS_3 B3 follow-up), so they ride `ssrfSafeDispatcher` + per-channel VPN egress.

`grep "await fetch(" linkedin-base.ts` is now `0`. Success paths are byte-identical
(`this.fetch()` returns the `Response` on 2xx); error responses now throw earlier rather
than returning a non-ok `Response`.
