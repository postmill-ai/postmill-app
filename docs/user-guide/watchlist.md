# Watchlist

The Watchlist feature lets you track public metrics for competitor or influencer accounts across
supported platforms. Watched account data integrates with the Analytics dashboard so you can compare
your own performance against external accounts.

## Supported Platforms

Watchlist probing is supported on five providers where public profile metrics can be extracted:

| Provider   | Identifier               | Profile URL Pattern                    |
|------------|--------------------------|----------------------------------------|
| X          | `x`                      | `https://x.com/{handle}`               |
| Instagram  | `instagram`              | `https://www.instagram.com/{handle}/`  |
| Instagram  | `instagram-standalone`   | `https://www.instagram.com/{handle}/`  |
| YouTube    | `youtube`                | `https://www.youtube.com/@{handle}`    |
| TikTok     | `tiktok`                 | `https://www.tiktok.com/@{handle}`     |

All other providers have `watchlist: false` in the capability matrix and are not available for
watchlist tracking.

## Adding a Watched Account

1. Navigate to the **Analytics** dashboard (`/analytics`).
2. Open the **Watchlist** section (accessible from the Analytics page or via the
   `/analytics/v2/watchlist` API).
3. Click **Add Account** and provide:
   - **Provider**: Select from the five supported platforms.
   - **Handle**: Enter the account's public handle (with or without the `@` prefix).
   - **Display Name** (optional): A friendly label for the account in your dashboard.

The handle is validated to contain only alphanumeric characters, dots, underscores, and hyphens
(1–100 characters). Handles are sanitized: the `@` prefix is stripped, and whitespace is trimmed.

## Metrics Collected

Postmill probes the public profile page of each watched account and extracts follower/subscriber
counts. The metric recorded depends on what the profile page exposes:

- **followers_count** or **followerCount**: Follower count from JSON metadata.
- **subscriberCount**: Subscriber count (YouTube).
- **Text pattern matching**: Falls back to parsing visible follower/subscriber counts from the
  page HTML.

Metrics are stored as `WatchedAccountMetric` records and displayed as time-series data alongside
your own channel metrics in the Analytics dashboard.

## Probe Schedule

Watched account probes run as part of the standard analytics collection sweep
(`analyticsCollection`). Each enabled watched account is probed once per sweep (daily cycle).
The backend must have `USE_INNGEST=true` and valid Inngest Cloud credentials (or `INNGEST_DEV=1`
for local development).

## Auto-Disable on Failure

Probes are designed to be graceful and non-disruptive:

- If a probe receives a **403 Forbidden**, the account is automatically disabled and the `lastError`
  field records the failure reason.
- If the platform returns an **unsupported response** or the profile page cannot be parsed, the
  account is disabled with the error message.
- A **failed probe never crashes** the analytics sweep — the error is logged and the sweep
  continues with the next account.
- Disabled accounts remain in your watchlist but are skipped in future sweeps until you manually
  re-enable them.

The probe uses `safeFetch` for all outbound HTTP requests, with SSRF protection and per-hop
redirect validation.

## Viewing Watchlist Data

Watched account metrics appear in the Analytics dashboard:

- **Overview tab**: Total followed accounts and aggregate external metrics.
- **Channels tab**: Watched accounts listed alongside your own channels, with time-series charts
  for follower growth.
- **Recommendations tab**: Watched-account metrics feed into the Analytics Recommendations tab
  alongside channel data, providing competitive insights for underperforming channels, top
  patterns, and best-time opportunities.
- **Posts tab**: Not applicable (watched accounts do not have post-level data).

You can manage your watched accounts (edit display name, enable/disable, delete) through the
watchlist section of the Analytics page or via the watchlist API endpoints under
`/analytics/v2/watchlist`.

> Verified against v1.0.0
