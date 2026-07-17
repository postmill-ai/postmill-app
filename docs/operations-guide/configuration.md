# Configuration

Every environment variable Postmill recognises, sourced from `.env.example`. All variables are read at boot time. Most feature-specific provider credentials (channel OAuth apps, AI providers, storage, short links) are configured per-organization in-app; this page covers the deployment-level variables.

## Required

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | — | PostgreSQL connection string for the application database |
| `REDIS_URL` | — | Redis connection string. Use `redis://` for local Redis or `rediss://` for Upstash / TLS endpoints |
| `JWT_SECRET` | — | Secret key for signing JWT tokens; also used as the encryption key fallback |
| `FRONTEND_URL` | — | Public-facing URL of the application (e.g. `https://postmill.example.com`) |
| `NEXT_PUBLIC_BACKEND_URL` | — | Public URL of the backend API (e.g. `https://postmill.example.com/api`) |
| `BACKEND_INTERNAL_URL` | — | Internal URL for backend-to-backend calls (e.g. `http://localhost:3000`) |
| `MAIN_URL` | — | Alternative public URL, used in Docker Compose alongside `FRONTEND_URL` |
| `IS_GENERAL` | — | Must be `true` for standard self-hosted deployments |

## Storage

| Variable | Default | Purpose |
|----------|---------|---------|
| `UPLOAD_DIRECTORY` | — | Local path for file uploads (e.g. `/uploads`). Avatars and app-internal images always use LOCAL |
| `NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY` | — | Public URL path serving uploads (e.g. `/uploads`) |
| `MEDIA_UPLOAD_MAX_BYTES` | `1073741824` | Maximum upload file size for `/files/upload-server` (default 1 GB) |
| `LOCAL_STORAGE_QUOTA_GB` | `5` | Default soft quota for each org's local storage, in GB |

## Email

Pluggable provider system with 6 adapters: Resend, SendGrid, Mailgun, Postmark, Amazon SES, and SMTP. The active provider is selected globally via `EMAIL_PROVIDER`; unset/unknown → email is off (users activate automatically).

| Variable | Default | Purpose |
|----------|---------|---------|
| `EMAIL_PROVIDER` | — | `resend`, `sendgrid`, `mailgun`, `postmark`, `ses`, or `smtp` |
| `EMAIL_API_KEY` | — | API key for Resend, SendGrid, Mailgun, or Postmark |
| `EMAIL_FROM_ADDRESS` | — | Sender email address |
| `EMAIL_FROM_NAME` | — | Sender display name |
| `EMAIL_WEBHOOK_SECRET` | — | Signing secret / verification key for the active provider's webhook |
| `EMAIL_MAILGUN_DOMAIN` | — | Mailgun sending domain (required for `mailgun`) |
| `EMAIL_REGION` | `us` | API region for Mailgun (`us`/`eu`) and SES region |
| `EMAIL_SES_ACCESS_KEY_ID` | — | SES IAM access key (falls back to `AWS_*` env vars) |
| `EMAIL_SES_SECRET_ACCESS_KEY` | — | SES IAM secret key (falls back to `AWS_*` env vars) |
| `EMAIL_SMTP_HOST` | — | SMTP server hostname (required for `smtp`) |
| `EMAIL_SMTP_PORT` | `587` | SMTP server port |
| `EMAIL_SMTP_SECURE` | `false` | Use TLS for SMTP |
| `EMAIL_SMTP_USER` | — | SMTP authentication username (optional for open relays) |
| `EMAIL_SMTP_PASS` | — | SMTP authentication password |
| `EMAIL_LOG_RETENTION_DAYS` | `90` | Days to keep email log metadata before pruning |
| `DISABLE_REGISTRATION` | `false` | Set to `true` to disable self-registration. The first user of an empty instance can still register, and `GENERIC` OIDC sign-ins still provision |
| `DISALLOW_PLUS` | `false` | Set to `true` to reject email/password (`LOCAL`) registrations whose address contains a `+` |

The webhook endpoint is at `POST /webhooks/email`, signature-verified, and registered outside CSRF (same as Stripe). SES uses SNS topic verification; `EMAIL_WEBHOOK_SECRET` can optionally hold the expected SNS TopicArn.

### Provider credential setup

| Provider | API key source | Webhook signing secret |
|----------|---------------|------------------------|
| **Resend** | Create an API key at resend.com | In webhook settings on the Resend dashboard |
| **SendGrid** | Create a "Full Access" API key at sendgrid.com/settings/api_keys | Enable Event Webhook and copy the Verification Key |
| **Mailgun** | Use SMTP credentials or create a Mailgun API key | Sent via the Mailgun webhook setup page. Also set `EMAIL_MAILGUN_DOMAIN` and `EMAIL_REGION` |
| **Postmark** | Create a server API token at postmarkapp.com | Generated when creating a webhook in the server settings |
| **Amazon SES** | IAM credentials, or fall back to `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` | SES uses SNS. Subscribe `POST /webhooks/email` to the SNS topic; `EMAIL_WEBHOOK_SECRET` can pin the TopicArn |
| **SMTP** | No API key — set host/port/secure/user/pass | Webhooks are not supported |

## Newsletter signups

New registrants can be subscribed to a marketing newsletter list. Beehiiv is used when `BEEHIIVE_API_KEY` is set, otherwise Listmonk when `LISTMONK_API_KEY` is set; with neither set, no signup is sent.

| Variable | Default | Purpose |
|----------|---------|---------|
| `BEEHIIVE_API_KEY` | — | Beehiiv API key |
| `BEEHIIVE_PUBLICATION_ID` | — | Beehiiv publication ID the subscriber is added to |
| `LISTMONK_API_KEY` | — | Listmonk API key (HTTP Basic password, paired with `LISTMONK_USER`) |
| `LISTMONK_USER` | — | Listmonk API username (HTTP Basic user) |
| `LISTMONK_DOMAIN` | — | Base URL of the Listmonk instance. A self-hosted Listmonk on a private network must be allowlisted via `SSRF_ALLOWED_PRIVATE_CIDRS` |
| `LISTMONK_LIST_ID` | — | Numeric list ID to subscribe new registrants to |
| `LISTMONK_WELCOME_TEMPLATE_ID` | — | Numeric transactional template ID for the welcome email |

## Campaign Hub

| Variable | Default | Purpose |
|----------|---------|---------|
| `CAMPAIGN_PURGE_DAYS` | `30` | Days after a campaign's `endDate` before its `CampaignItem` tags are purged |

## Push notifications

Browser and mobile push notifications are sent via Firebase Cloud Messaging (FCM) v1. Push is globally disabled when any of these is unset.

| Variable | Default | Purpose |
|----------|---------|---------|
| `FCM_PROJECT_ID` | — | Firebase project ID |
| `FCM_CLIENT_EMAIL` | — | Firebase service account client email |
| `FCM_PRIVATE_KEY` | — | Firebase service account private key (PEM) |

## Analytics & background jobs

| Variable | Default | Purpose |
|----------|---------|---------|
| `USE_INNGEST` | — | Set to `true` to enable Inngest-driven background jobs |
| `INNGEST_EVENT_KEY` | — | Inngest Cloud event key (required unless `INNGEST_DEV=1`) |
| `INNGEST_SIGNING_KEY` | — | Inngest Cloud signing key (required unless `INNGEST_DEV=1`) |
| `INNGEST_SIGNING_KEY_FALLBACK` | — | Optional fallback signing key for rotation |
| `INNGEST_ENV` | — | Optional branch environment name |
| `INNGEST_DEV` | — | Set to `1` to use the local Inngest dev server |
| `INNGEST_BASE_URL` | `http://localhost:8288` | Local dev server URL (only used with `INNGEST_DEV=1`) |
| `INNGEST_SERVE_ORIGIN` | — | Public backend origin served to Inngest |
| `INNGEST_SERVE_PATH` | `/api/inngest` | Path where the backend serves the Inngest handler |
| `ANALYTICS_DAILY_RETENTION_DAYS` | `548` | Days to keep daily channel snapshots before rolling up to weekly |
| `ANALYTICS_POST_RETENTION_DAYS` | `90` | Days to keep per-post snapshots before pruning |
| `ANALYTICS_ANOMALY_Z` | `3` | Z-score threshold for anomaly (spike/drop) detection in the daily sweep |
| `ANALYTICS_ANOMALY_COOLDOWN_DAYS` | `3` | Suppress repeat anomaly notifications for the same (channel, metric) for this many days |
| `COMMENTS_SWEEP_INTERVAL_MINUTES` | `30` | Minutes between comment collection sweeps |
| `POST_DAYS_BACK` | `30` | Days back to look for posts when fetching comments |
| `SOCIAL_COMMENT_RETENTION_DAYS` | `90` | Days before social comments are soft-deleted |
| `AGENT_DIGEST_ENABLED` | — | Set to `true` to enable the Monday 07:00 ET headless AI digest |

## AI Model Defaults

Model defaults re-point AI model resolution from the legacy scope/model chain to category-driven defaults (`low-reasoning`, `high-reasoning`, `vision`, `workflow`) and the corresponding Media Defaults categories.

| Variable | Default | Purpose |
|----------|---------|---------|
| `AI_MODEL_DEFAULTS_ENABLED` | `true` (unset = on) | Kill switch for the model-category re-point and Model/Media Defaults feature. Set to `false` to revert AI model resolution to the legacy chain |

## API

| Variable | Default | Purpose |
|----------|---------|---------|
| `API_LIMIT` | `600` | Public API rate limit per hour |
| `AGENT_API_KEY` | — | API key for legacy `/public/agent` endpoint |
| `OPENAI_APP_CHALLENGE` | — | Challenge string for OpenAI apps, served at `/.well-known/openai-apps-challenge` |
| `MOBILE_APP_SCHEME` | `postiz://auth/callback` | Deep-link scheme the mobile OAuth callback (`GET /auth/oauth-mobile-callback`) redirects to |
| `NEXT_PUBLIC_OVERRIDE_BACKEND_URL` | — | Overrides the token endpoint advertised in the MCP OAuth discovery document (`/.well-known/oauth-authorization-server`); falls back to the backend URL |
| `AGENT_MEDIA_SSO_KEY` | — | JWT signing key for the optional agent-media.ai SSO integration. Unset = `GET /user/agent-media-sso` returns `{ url: null }` |

## Security

| Variable | Default | Purpose |
|----------|---------|---------|
| `ENCRYPTION_KEY` | (derived from `JWT_SECRET`) | 32-byte base64 or hex key for AES-256-GCM encryption at rest. Falls back to SHA-256 of `JWT_SECRET` if unset. See [Security](./security.md). **Warning:** introducing `ENCRYPTION_KEY` on a deployment that previously derived the key from `JWT_SECRET` makes all existing `v2:`-prefixed secrets undecryptable (single-key model) — set it from the first deploy, or plan a re-encryption of stored secrets |
| `INTEGRATION_RETURN_URL_ALLOWLIST` | — | Comma-separated allowed partner origins for integration/enterprise return URLs |
| `SSRF_ALLOWED_PRIVATE_CIDRS` | — | Comma-separated private CIDRs to allow for self-hosted provider instances (opt-in SSRF exception) |
| `RESTRICT_UPLOAD_DOMAINS` | — | When set, media attached to a post must contain this domain in its path; saving a post with externally-hosted media is rejected (HTTP 400). Use the domain of your own upload endpoint |
| `NOT_SECURED` | — | Dev-only toggle. Skips Helmet, HSTS, CSRF enforcement, and CopilotKit policy gating. Never set in production |

## Payments (Stripe)

| Variable | Default | Purpose |
|----------|---------|---------|
| `STRIPE_PUBLISHABLE_KEY` | — | Stripe publishable key |
| `STRIPE_SECRET_KEY` | — | Stripe secret key |
| `STRIPE_SIGNING_KEY` | — | Stripe webhook signing secret |
| `STRIPE_DISCOUNT_ID` | — | Stripe coupon ID. When set, eligible existing paying customers on a monthly plan (no yearly plan, no existing discount) can have the coupon applied to their subscription |
| `ADDON_STORAGE_GB_PER_PACK` | `25` | Gigabytes added by one storage add-on pack |
| `ADDON_VIDEO_EXPORTS_PER_PACK` | `50` | Video exports added by one video-exports add-on pack |
| `NEXT_PUBLIC_ADDON_STORAGE_GB_PER_PACK` | `25` | Browser-visible mirror of `ADDON_STORAGE_GB_PER_PACK` |
| `NEXT_PUBLIC_ADDON_VIDEO_EXPORTS_PER_PACK` | `50` | Browser-visible mirror of `ADDON_VIDEO_EXPORTS_PER_PACK` |

Plan and add-on prices are created dynamically from `pricing.ts`; no `STRIPE_PRICE_*` IDs are read from the environment. See [Subscriptions & Stripe](./subscriptions.md).

## SSO / OIDC login

Since v3.8.10, login providers are managed by the **separate administration app** (a distinct repository) and stored encrypted in `AuthProviderConfig`. This repo reads that config DB-first and ships no `/admin` frontend or login-provider write API. The variables below remain supported as the bootstrap fallback when no enabled DB config exists for that provider. Email/password (`LOCAL`) login is always available regardless of provider config.

See [OAuth / SSO](./oauth-sso.md) for a complete setup walkthrough.

| Variable | Default | Purpose |
|----------|---------|---------|
| `POSTMILL_GENERIC_OAUTH` | `false` | Set to `true` to enable generic OIDC login |
| `POSTMILL_OAUTH_AUTH_URL` | — | OIDC provider authorization endpoint |
| `POSTMILL_OAUTH_TOKEN_URL` | — | OIDC provider token endpoint |
| `POSTMILL_OAUTH_USERINFO_URL` | — | OIDC provider userinfo endpoint |
| `POSTMILL_OAUTH_CLIENT_ID` | — | OIDC client ID |
| `POSTMILL_OAUTH_CLIENT_SECRET` | — | OIDC client secret |
| `POSTMILL_OAUTH_SCOPE` | `openid profile email` | OIDC scopes to request |
| `NEXT_PUBLIC_POSTMILL_OAUTH_DISPLAY_NAME` | — | Name shown on the login button |
| `NEXT_PUBLIC_POSTMILL_OAUTH_LOGO_URL` | — | Logo URL shown on the login button |

## Social login bootstrap

These env vars are used only when no enabled DB config exists for the provider.

| Variable | Default | Purpose |
|----------|---------|---------|
| `GITHUB_CLIENT_ID` | — | GitHub OAuth app client ID |
| `GITHUB_CLIENT_SECRET` | — | GitHub OAuth app client secret |
| `YOUTUBE_CLIENT_ID` | — | Google OAuth login client ID (channel credentials are configured in Settings → Channels) |
| `YOUTUBE_CLIENT_SECRET` | — | Google OAuth login client secret |
| `NEYNAR_SECRET_KEY` | — | Farcaster (Neynar) login only |

## Channel OAuth apps (platform click-connect)

Setting a provider's platform OAuth app credentials here gives every organization one-click **Connect** without per-org key entry. Leaving a provider unset requires each org to add its own app via Settings → Channels. A per-org config always takes precedence.

| Variable | Provider |
|----------|----------|
| `X_API_KEY` / `X_API_SECRET` | X |
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` | LinkedIn (also LinkedIn Page) |
| `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` | Facebook (also Instagram via Facebook login) |
| `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` | Instagram standalone |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | Discord |
| `SLACK_ID` / `SLACK_SECRET` | Slack |
| `TIKTOK_CLIENT_ID` / `TIKTOK_CLIENT_SECRET` | TikTok |
| `PINTEREST_CLIENT_ID` / `PINTEREST_CLIENT_SECRET` | Pinterest |
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` | Reddit |
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | Twitch |
| `THREADS_APP_ID` / `THREADS_APP_SECRET` | Threads |
| `DRIBBBLE_CLIENT_ID` / `DRIBBBLE_CLIENT_SECRET` | Dribbble |
| `MASTODON_CLIENT_ID` / `MASTODON_CLIENT_SECRET` | Mastodon |
| `MEWE_APP_ID` / `MEWE_API_KEY` | Mewe |
| `KICK_CLIENT_ID` / `KICK_SECRET` | Kick |
| `GOOGLE_GMB_CLIENT_ID` / `GOOGLE_GMB_CLIENT_SECRET` | Google Business Profile |
| `NEYNAR_CLIENT_ID` | Farcaster (Wrapcast) channel posting |
| `VK_ID` | VK |
| `WHOP_CLIENT_ID` | Whop |
| `TELEGRAM_TOKEN` | Telegram bot token |
| `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` | YouTube channel posting |

Custom OAuth channels reuse `POSTMILL_OAUTH_CLIENT_ID` / `POSTMILL_OAUTH_CLIENT_SECRET`.

## X channel behaviour

| Variable | Default | Purpose |
|----------|---------|---------|
| `DISABLE_X_ANALYTICS` | — | Set to skip X (Twitter) analytics collection |
| `X_ANALYTICS_MAX_PAGE_DEPTH` | `10` | Maximum timeline pages fetched per X analytics sync |
| `STRIP_LINKS_FROM_X_POSTS` | — | Set to strip links from X posts before publishing |

## Browser extension

| Variable | Default | Purpose |
|----------|---------|---------|
| `EXTENSION_ID` | — | Chrome extension ID for cookie-based platform integrations (Skool) |

## Monitoring

| Variable | Default | Purpose |
|----------|---------|---------|
| `NEXT_PUBLIC_SENTRY_DSN` | — | Sentry DSN for error tracking (frontend) |
| `SENTRY_SPOTLIGHT` | — | Set to `1` to enable Spotlight debug proxy |
| `DATAFAST_API_KEY` | — | Datafast API key. Posts a `register` goal to datafa.st when a new user signs up carrying a `datafast_visitor_id` |
| `FACEBOOK_PIXEL_ACCESS_TOKEN` | — | Meta Conversions API access token for server-side pixel events |
| `NEXT_PUBLIC_FACEBOOK_PIXEL` | — | Meta pixel ID (browser-visible). Server-side pixel events fire only when both this and `FACEBOOK_PIXEL_ACCESS_TOKEN` are set |

## AI Designer chatbot

| Variable | Default | Purpose |
|----------|---------|---------|
| `AI_DESIGNER_MESH_STORE` | `redis` | Agent-mesh session/breaker store: `redis` (default) or `postgres` (opt-in, runs its own DDL) |
| `AI_DESIGNER_MESH_DATABASE_URL` | — | Dedicated Postgres URL for the opt-in mesh Postgres store. Never the Prisma `DATABASE_URL` |
| `AI_DESIGNER_MESH_CONNECTION_LIMIT` | `10` | Connection pool size for the opt-in mesh Postgres store |
| `AI_DESIGNER_AGENT_REGISTRY` | — | Directory of per-agent YAML files overriding the bundled registry |
| `AI_DESIGNER_AGENT_TIMEOUT_MS` | `120000` | Per-agent LLM dispatch deadline |
| `AI_DESIGNER_ASSET_TIMEOUT_MS` | `90000` | Asset (image generation/stock) step deadline |
| `AI_DESIGNER_STUCK_SESSION_MINUTES` | `15` | Planning/executing sessions untouched longer than this roll back to awaiting_plan |
| `TRUST_PROXY_HOPS` | (disabled) | Number of XFF-appending reverse proxies in front of the backend. Unset/invalid = key on the socket peer address (safe default, not spoofable). When set, per-IP rate buckets key on the Nth-from-right `x-forwarded-for` entry. Applies to the `/ai-designer` connect-rate bucket **and** the HTTP throttler's per-IP buckets (login/register/enterprise/public-report) and the MCP rate limits. Operators behind a proxy **must** set it to the exact number of appending proxies — overestimating lands in attacker-controlled left-most XFF entries and makes the limits spoofable |
| `SESSION_TTL_MINUTES` | — | agent-mesh package env var — no Postmill effect (see caveat below) |
| `ENABLE_CIRCUIT_BREAKER` | — | agent-mesh package env var — forced off (see caveat below) |
| `MCP_MAX_RETRIES` | — | agent-mesh package env var — no Postmill effect (see caveat below) |

`SESSION_TTL_MINUTES`, `ENABLE_CIRCUIT_BREAKER`, and `MCP_MAX_RETRIES` belong to the bundled `@reaatech/agent-mesh` package's env schema, not to Postmill itself. `agent-mesh-env.stash.ts` reads, neutralizes, and restores them around the package's import-time env parse: out-of-range values are stashed aside so they cannot crash the boot, and `ENABLE_CIRCUIT_BREAKER` is forced off because the package's global breaker is keyed by agent id only — Postmill uses the conductor's per-`(org, agent)` breaker instead. Setting these vars does not configure Postmill behaviour.

## Local development feature flags

Set any of these to `true` or `1` to disable the corresponding subsystem during local development. All features remain enabled by default.

| Variable | Purpose |
|----------|---------|
| `DEV_DISABLE_AI` | Skip AI adapter registration |
| `DEV_DISABLE_MCP` | Skip Mastra/MCP/A2A server startup |
| `DEV_DISABLE_MEDIA` | Skip media-generation adapter registration |
| `DEV_DISABLE_SHORTLINKS` | Skip short-link adapter registration |
| `DEV_DISABLE_EMAIL` | Skip email-provider adapter registration |
| `DEV_DISABLE_VIDEO` | Skip video-generation adapter registration |
| `DEV_DISABLE_AGENT` | Skip agent-graph services |
| `DEV_DISABLE_CRON` | Skip `ScheduleModule.forRoot()` |
| `DEV_DISABLE_SENTRY` | Skip Sentry initialization |
| `DEV_DISABLE_OPENTELEMETRY` | Skip OpenTelemetry exporter setup |
| `AGENT_SUPERVISOR_ENABLED` | `true` (default) uses the supervisor + specialists agent model |
| `CONTENT_PIPELINE_TOTAL_TIMEOUT_MS` | `300000` | Wall-clock deadline for a `runContentPipeline` run |
| `CONTENT_PIPELINE_AGENT_TIMEOUT_MS` | `120000` | Per-agent LLM dispatch deadline inside a `runContentPipeline` run |
| `BACKEND_URL` | Server-side backend URL used by the MCP surface. Falls back to `NEXT_PUBLIC_BACKEND_URL` |
| `MEDIA_MCP_AUDIT_LOG_PATH` | `/tmp/media-mcp-audit.log` | File path for the media-MCP audit logger |
| `SENTRY_PROFILING` | Set to `1` to enable browser profiling in dev |
| `FRONTEND_PROFILING` | Set to `1` to enable `Document-Policy: js-profiling` in dev |
| `DEV_SEED_DEMO` | Populate the target org with placeholder demo data at backend boot (dev only) |
| `DEV_SEED_DEMO_RESET` | Wipe and reseed demo data (dev only) |
| `DEV_SEED_DEMO_EMAIL` | Demo seeder account email |
| `DEV_SEED_DEMO_PASSWORD` | Demo seeder account password |

## Production, scaling & observability

| Variable | Default | Purpose |
|----------|---------|---------|
| `CONFIG_CHECK_STRICT` | — | Fail fast on fatal-missing secrets even in dev |
| `BACKEND_LISTEN_HOST` | (Node default) | Explicit bind host for the backend HTTP server (e.g. `0.0.0.0` to force IPv4 in CI/containers). Unset = Node's default bind address |
| `COLLAB_SINGLE_INSTANCE` | `true` | Collaboration websocket keeps Yjs state in memory; must be `true` unless `COLLAB_REDIS_ADAPTER` is set |
| `COLLAB_REDIS_ADAPTER` | — | Reserved for the future Yjs-over-Redis adapter |
| `OUTBOUND_HTTP_TIMEOUT_MS` | `30000` | Bound provider and webhook calls |
| `WEBHOOK_TIMEOUT_MS` | `10000` | Outbound webhook delivery timeout |
| `WEBHOOK_SIGNING_SECRET` | — | HMAC secret for `X-Postmill-Signature`. When unset, derives from `JWT_SECRET` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | OTLP/HTTP tracing endpoint. Off unless set |
| `OTEL_SERVICE_NAME` | `postmill-backend` | OpenTelemetry service name |
| `DATABASE_CONNECTION_LIMIT` | — | Prisma connection pool size appended to `DATABASE_URL` |
| `DATABASE_POOL_TIMEOUT` | — | Prisma pool timeout appended to `DATABASE_URL` |
| `ALLOW_DESTRUCTIVE_SCHEMA` | `false` | Allow `prisma db push` to perform destructive diffs |
| `ERRORS_RETENTION_DAYS` | `90` | Retention for `Errors` rows |
| `NOTIFICATIONS_RETENTION_DAYS` | `180` | Retention for Notifications (+ `NotificationRead`) |
| `MULTIPART_UPLOAD_RETENTION_DAYS` | `7` | Retention for abandoned multipart uploads |
| `MASTRA_TRACE_RETENTION_DAYS` | `30` | Retention for Mastra traces/scorers |
| `SOFT_DELETE_RETENTION_DAYS` | `30` | Hard-purge window for soft-deleted posts/files |
| `IP_RETENTION_DAYS` | `90` | Null `User`/`Session` IP and agent after this window |
| `AI_DESIGNER_SESSION_RETENTION_DAYS` | `90` | Retention for AI Designer chat sessions |

## Stock media

| Variable | Default | Purpose |
|----------|---------|---------|
| `UNSPLASH_ACCESS_KEY` | — | Unsplash API access key for stock photos |
| `PEXELS_API_KEY` | — | Pexels API key for stock videos |
| `PIXABAY_API_KEY` | — | Pixabay API key for vectors/illustrations |
| `GIPHY_API_KEY` | — | GIPHY API key for stickers |
| `JAMENDO_CLIENT_ID` | — | Jamendo API client ID for stock audio |
| `JAMENDO_CLIENT_SECRET` | — | Jamendo API client secret |

Iconify (SVG icons) does not require an API key.

### Content Packs

Premium stock sources are configured per-organization in-app via **Settings → Content Packs**. BYOK packs take precedence over the free catalogs above for the capabilities they support. See [Storage](./storage.md) and the user-facing settings docs.

## Video rendering

See [Video Rendering](./video-rendering.md) for the full list of `VIDEO_RENDER_*` variables.

## Headless Chromium (Puppeteer)

| Variable | Default | Purpose |
|----------|---------|---------|
| `PUPPETEER_EXECUTABLE_PATH` | (bundled Chromium) | Path to a system/distro Chromium binary for design frame capture (used by the render-worker container). Unset = Puppeteer's bundled Chromium |
| `PUPPETEER_DISABLE_SANDBOX` | `false` | Set to `true` to launch the campaign-report PDF Chromium with `--no-sandbox` (for CI/containers without user namespaces; also disabled automatically when `CI=true`). Production defaults to sandboxed mode |

## Variables no longer read

The following patterns are no longer supported as environment variables. Configure them in-app instead:

- Channel provider `*_CLIENT_ID` / `*_CLIENT_SECRET` / `*_APP_ID` / `*_APP_SECRET` / `TELEGRAM_TOKEN`
- `OPENAI_API_KEY` and other AI provider keys
- Short-link provider vars (`DUB_TOKEN`, `SHORT_IO_SECRET_KEY`, `KUTT_API_KEY`, etc.)
- Storage env vars (`STORAGE_PROVIDER`, `CLOUDFLARE_*`, etc.)
- Legacy email vars (`RESEND_API_KEY`, `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_SECURE`, `EMAIL_USER`, `EMAIL_PASS`)
- `KIEAI_API_KEY` (legacy Veo3 provider deleted)
- `TRANSLOADIT_AUTH` / `TRANSLOADIT_SECRET` (legacy video assembly deleted)
- `ELEVENLABS_API_KEY` / `ELEVENLABS_*` (legacy direct ElevenLabs calls deleted; configure ElevenLabs as an AI Media provider instead)

The **login** provider env vars (`GITHUB_CLIENT_*`, `YOUTUBE_CLIENT_*`, `POSTMILL_OAUTH_*`) remain readable as the bootstrap fallback for auth providers managed by the separate administration app and must never be used for channel or AI credentials.

> Verified against v1.0.0
