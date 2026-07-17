# @gitroom/provider-bluesky

Bluesky social provider (`social/bluesky@v1`).

## SSRF / VPN egress posture

Most Bluesky traffic goes through the official `@atproto/api` agent
(`BskyAgent` / `AtpAgent`), which owns its own HTTP client and **cannot accept a
custom undici dispatcher**. As a result it cannot ride `SocialAbstract.fetch()`
(`ssrfSafeDispatcher` + per-channel VPN egress). Rather than fake a passthrough,
these calls are left as-is and documented here.

### Known proxy gap

The following outbound calls bypass `ssrfSafeDispatcher` and per-channel VPN egress.
They are annotated at the call site with `// Known proxy gap:` comments.

1. **`@atproto/api` agent traffic** — `new BskyAgent(...)` / `new AtpAgent(...)` in
   `authenticate`, `getAgent` (the shared chokepoint for every posting path),
   `comment`/`repost`/etc., and the video-job `getJobStatus` polling. The SDK has no
   custom-dispatcher hook, so **all** of its requests (login, getProfile, post,
   comments, video status) are unproxied. This is the primary gap — most posting
   traffic flows here.
2. **`uploadVideo` → bare `fetch()` to `https://video.bsky.app/...`** — the video
   upload runs in a module-scope helper (no `this`), so it cannot use
   `SocialAbstract.fetch()`. Fixed first-party host (low SSRF risk), but VPN egress
   does not apply.
3. **`reduceImageBySize` → `axios.get(url)`** — downloads a post image in a
   module-scope helper (no `this`). Gets neither SSRF re-validation nor VPN egress.
   Target is a post media URL, not a provider API host.
4. **`downloadVideo` → `safeFetch(url)`** — VPN egress only. SSRF **is** covered
   (uses `safeFetch`: `isSafePublicHttpsUrl` + per-hop re-validation); only the
   per-channel VPN dispatcher is skipped. Target is a post media (video) URL.

VPN egress for Bluesky is therefore best-effort: a VPN selection on a Bluesky channel
will not route the above traffic. Closing the agent gaps would require a custom
HTTP transport in `@atproto/api`.
