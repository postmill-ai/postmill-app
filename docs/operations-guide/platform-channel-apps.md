# Platform Channel Apps

Postmill resolves channel (social posting) credentials at **two scopes**:

1. **Platform channel apps (this page)** — the operator sets one OAuth app per
   provider in the deployment environment (`.env` / Docker Compose). Every
   organization then connects that channel with one click — no per-org key entry.
2. **Per-org BYO credentials** — an organization adds its own app via
   **Settings → Channels** (advanced). A per-org config always **wins** over the
   platform env app, so a tenant can bring its own app even when a platform app
   exists.

When neither exists, the connect dialog falls back to the per-org key form
("alternatively use keys"). Env values are resolved live, per request, and
never persisted to a tenant row.

`GET /integrations` exposes `platformConfigured: true` for providers with a
working env app. Tenants see those providers as one-click **Connect** with the
note *"Uses the Postmill app — no setup needed"*; providers without a platform
app require the tenant's own app via Settings → Channels.

## Callback URLs and restarts

The OAuth callback URL for channel connections is always:

```
https://<your-postmill-domain>/integrations/social/<identifier>
```

(e.g. `https://postmill.example.com/integrations/social/facebook`). Register
exactly this URL in the provider's developer portal. Telegram (bot token) and
Wrapcast (client-side Neynar sign-in) are the exceptions — no callback is
registered.

Channel env vars enter `process.env` when the **backend boots** — restart the
backend after editing `.env`. The frontend needs no rebuild for these
variables.

The canonical env-var mapping is `CHANNEL_ENV_MAPPINGS` in
`libraries/nestjs-libraries/src/integrations/channel-env-credentials.ts`; the
table on the [Configuration](./configuration.md#channel-oauth-apps-platform-click-connect)
page mirrors it.

## Meta — Facebook Pages

One Meta app covers **Facebook Pages** (`facebook`) and **Instagram Business
accounts connected via Facebook login** (`instagram`) — both identifiers read
`FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET`.

1. Open [Meta for Developers](https://developers.facebook.com/apps) and create
   an app (type **Other → Business**), or pick an existing one.
2. Add the **Facebook Login** product — on new apps the only option is
   **Facebook Login for Business** (FBfB).
3. Under **App settings → Basic**, add your Postmill domain to **App Domains**.
4. Under **Facebook Login → Settings**, add
   `https://<your-domain>/integrations/social/facebook` **and**
   `https://<your-domain>/integrations/social/instagram` to
   **Valid OAuth Redirect URIs**.
5. Copy the **App ID** and **App Secret** from App settings → Basic:

```yaml
FACEBOOK_APP_ID: '1234567890123456'
FACEBOOK_APP_SECRET: '<your-app-secret>'
```

6. Restart the backend.

**Scopes vs. Configuration ID.** Postmill supports both Meta login modes:

- *Classic Facebook Login* — Postmill requests these scopes:
  `pages_show_list`, `business_management`, `pages_manage_posts`,
  `pages_manage_engagement`, `pages_read_engagement`, `read_insights`.
  Instagram-via-Facebook requests its own set: `instagram_basic`,
  `pages_show_list`, `pages_read_engagement`, `business_management`,
  `instagram_content_publish`, `instagram_manage_comments`,
  `instagram_manage_insights`.
- *Facebook Login for Business* — Meta rejects the `scope` parameter on
  FBfB-only apps. Instead, create a **Configuration** under Facebook Login for
  Business → Configurations (it bundles the token type, assets, and
  permissions) and paste its **Configuration ID** into the org's channel form
  (`additionalConfig.configId` in Settings → Channels; the connect flow offers
  the field). When a Configuration ID is present it **replaces** the scope list
  in the OAuth URL.

**App Review / going Live.** While the app is in development mode only its
admins/developers/testers can connect. For production use the app must pass
Meta App Review for the permissions above, and Meta requires **Deauthorize** and
**Data Deletion** callback URLs before an app can go Live — Postmill ships no
built-in endpoints for these, so point them at your own privacy/data-deletion
pages; check Meta's current docs for the exact requirements.

## Instagram Standalone

`instagram-standalone` uses Instagram's own login (not Facebook login) with a
separate credential pair:

1. In [Meta for Developers](https://developers.facebook.com/apps), open (or
   create) your app and add the **Instagram** product.
2. Choose **API setup with Instagram login** — *not* "API setup with Facebook
   login".
3. Under **Business login settings**, add
   `https://<your-domain>/integrations/social/instagram-standalone` to the
   OAuth redirect URIs list.
4. Copy the **Instagram App ID** and **Instagram App Secret** from the same
   page:

```yaml
INSTAGRAM_APP_ID: '1234567890123456'
INSTAGRAM_APP_SECRET: '<your-instagram-app-secret>'
```

5. Restart the backend.

Postmill requests the scopes `instagram_business_basic`,
`instagram_business_content_publish`, `instagram_business_manage_comments`, and
`instagram_business_manage_insights`. The connected Instagram account must be a
professional (Business or Creator) account.

While the app is in development mode, each Instagram account that will connect
must be added as an **Instagram tester** in the Meta app **and must accept the
invite** (Instagram → Settings → Apps and Websites → Tester invites) —
otherwise OAuth fails with "Invalid platform app".

Note: this adapter enforces that `FRONTEND_URL` is a public HTTPS origin —
private/loopback origins are rejected for OAuth redirects.

## X (Twitter)

1. Open the [X Developer Portal](https://developer.x.com/en/portal/dashboard)
   and create a project + app (or pick an existing one).
2. Under **User authentication settings**, set **Type of App** to
   *Web App, Automated App or Bot* and enable **OAuth 1.0a** with
   **Read and write** permissions. The channel flow is OAuth 1.0a with write
   access (no granular scopes).
3. Add `https://<your-domain>/integrations/social/x` to the allowed
   **Callback URIs**.
4. Copy the **API Key** and **API Secret** from Keys and tokens → Consumer Keys:

```yaml
X_API_KEY: '<your-api-key>'
X_API_SECRET: '<your-api-secret>'
```

5. Restart the backend.

Posting requires an X access tier with write access — check X's current tier
docs for Free-tier limits. (The adapter throttles itself to one concurrent
posting job, citing X's ~300-posts-per-3-hours rate ceiling.)

**SSO caveat:** X login uses a separate OAuth 2.0 + PKCE flow with only the
`users.read` scope, which returns **no email address**. X SSO accounts get a
synthetic address (`x_<id>@x.login.postmill.local`) and are skipped by
newsletter/welcome email — see [SSO dual-use](#sso-dual-use-login-with-the-same-app).

## LinkedIn

One LinkedIn app covers both the **LinkedIn** (`linkedin`) and **LinkedIn Page**
(`linkedin-page`) channels — both read `LINKEDIN_CLIENT_ID` /
`LINKEDIN_CLIENT_SECRET`.

1. Open the [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps)
   and create an app, linked to a LinkedIn Page you admin.
2. On the **Products** tab, request access to **Share on LinkedIn** and
   **Sign In with LinkedIn using OpenID Connect**. Neither product requires an
   app review.
3. On the **Auth** tab, under OAuth 2.0 settings, add
   `https://<your-domain>/integrations/social/linkedin` **and**
   `https://<your-domain>/integrations/social/linkedin-page` to
   **Authorized redirect URLs for your app**.
4. Copy the **Client ID** and **Primary Client Secret** from the Auth tab:

```yaml
LINKEDIN_CLIENT_ID: '77a1b2c3d4e5f6g7'
LINKEDIN_CLIENT_SECRET: '<your-client-secret>'
```

5. Restart the backend.

The adapter requests `openid`, `profile`, `w_member_social`, `r_basicprofile`,
`rw_organization_admin`, `w_organization_social`, and `r_organization_social`.

## Telegram

Telegram is token-only: the platform's bot token is the entire credential.

1. In Telegram, start a chat with [@BotFather](https://t.me/botfather).
2. Send `/newbot` and follow the prompts (or reuse an existing bot via
   `/mybots`).
3. Copy the API token BotFather gives you:

```yaml
TELEGRAM_TOKEN: '123456789:AAEhBOweik6ad9r_QXMENQjcrGbqCr4K-4rI'
```

4. Restart the backend.

**Tenant flow:** the tenant opens the Telegram connect dialog, adds your bot to
their channel or group (as an admin so it can post), then posts the
`/connect <code>` message the dialog shows, addressed to the bot
(e.g. `/connect a1b2c3d4` as a message to `@YourPostmillBot`). Postmill picks
the message up from the bot's updates, links that chat to the tenant's channel,
and — when the bot has admin rights with message-delete permission — deletes
the `/connect` message and its own confirmation.

## LINE

LINE is token-only (same pattern as Telegram): the platform's Messaging API
channel access token is the entire credential.

1. Open the [LINE Developers console](https://developers.line.biz/console/) and
   create a provider (or pick an existing one).
2. Create a **Messaging API** channel on it — this also creates the LINE
   Official Account users will connect to.
3. On the channel's **Messaging API** tab, issue a **channel access token
   (long-lived)**:

```yaml
LINE_CHANNEL_ACCESS_TOKEN: '<your-long-lived-channel-access-token>'
```

4. Restart the backend.

**Tenant flow:** the tenant pastes no keys — they add your LINE Official
Account as a friend (or to a group) and connect with one click. Posts are sent
as bot **broadcast** messages to every friend of the account. Note that LINE
broadcast responses carry no message id, so post permalinks point at the LINE
Official Account Manager.

## Google — YouTube

1. Open the [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
   and create a project (or pick an existing one).
2. Under **APIs & Services → Library**, enable the **YouTube Data API v3** and
   the **YouTube Analytics API**.
3. Configure the **OAuth consent screen** (external) and add the scopes
   Postmill requests:
   `userinfo.profile`, `userinfo.email`, `youtube`, `youtube.force-ssl`,
   `youtube.readonly`, `youtube.upload`, `youtubepartner`, and
   `yt-analytics.readonly`. While the consent screen is in "Testing" mode, add
   each connecting Google account as a test user.
4. Create an **OAuth 2.0 Client ID** of type **Web application** and add
   `https://<your-domain>/integrations/social/youtube` to
   **Authorized redirect URIs**.
5. Copy the Client ID and Client Secret:

```yaml
YOUTUBE_CLIENT_ID: '1234567890-abcd1234.apps.googleusercontent.com'
YOUTUBE_CLIENT_SECRET: '<your-client-secret>'
```

6. Restart the backend.

These same variables **dual-use as Google SSO login** — setting them puts a
"Sign in with Google" button on the login page (see
[OAuth / SSO](./oauth-sso.md#google-login)). Because several of the YouTube
scopes are sensitive/restricted, Google requires app verification before the
consent screen can serve the general public in production — check Google's
current verification requirements.

**Google Business Profile (GMB)** is a separate credential pair and callback;
enable the Google Business Profile APIs on a project and register
`https://<your-domain>/integrations/social/gmb` (scopes: `userinfo.profile`,
`userinfo.email`, `business.manage`):

```yaml
GOOGLE_GMB_CLIENT_ID: '<your-gmb-client-id>'
GOOGLE_GMB_CLIENT_SECRET: '<your-gmb-client-secret>'
```

## Other env-mapped providers

Index of every env-mapped provider — each has a full setup section further
down this page (same format as Meta / X / LinkedIn / Google above). Portal
URLs, callback paths, and the scopes each section lists are taken from the
provider's adapter; env vars from `CHANNEL_ENV_MAPPINGS`.

One rule covers all of them: each provider's section lists the **exact scopes
Postmill requests at connect time** — request precisely these in the app review.
Postmill validates the granted scope set when a tenant connects and **refuses the
connection if any scope is missing** (e.g. TikTok's `scope_not_authorized`), so an app
approved for fewer scopes than its section lists will connect for no one.

| Identifier | Developer portal | Env vars | Callback path |
|------------|------------------|----------|---------------|
| TikTok (`tiktok`) | [developers.tiktok.com/apps](https://developers.tiktok.com/apps) | `TIKTOK_CLIENT_ID` / `TIKTOK_CLIENT_SECRET` | `/integrations/social/tiktok` |
| Pinterest (`pinterest`) | [developers.pinterest.com/apps](https://developers.pinterest.com/apps) | `PINTEREST_CLIENT_ID` / `PINTEREST_CLIENT_SECRET` | `/integrations/social/pinterest` |
| Reddit (`reddit`) | [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps) | `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` | `/integrations/social/reddit` |
| Twitch (`twitch`) | [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) | `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | `/integrations/social/twitch` |
| Threads (`threads`) | [developers.facebook.com/apps](https://developers.facebook.com/apps) | `THREADS_APP_ID` / `THREADS_APP_SECRET` | `/integrations/social/threads` |
| Discord (`discord`) | [discord.com/developers/applications](https://discord.com/developers/applications) | `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | `/integrations/social/discord` |
| Slack (`slack`) | [api.slack.com/apps](https://api.slack.com/apps) | `SLACK_ID` / `SLACK_SECRET` | `/integrations/social/slack` |
| Dribbble (`dribbble`) | [dribbble.com/account/applications/new](https://dribbble.com/account/applications/new) | `DRIBBBLE_CLIENT_ID` / `DRIBBBLE_CLIENT_SECRET` | `/integrations/social/dribbble` |
| Kick (`kick`) | [kick.com/settings/developer](https://kick.com/settings/developer) | `KICK_CLIENT_ID` / `KICK_SECRET` | `/integrations/social/kick` |
| VK (`vk`) | [id.vk.com/about/business/go](https://id.vk.com/about/business/go) | `VK_ID` (id only, no secret) | `/integrations/social/vk` |
| Whop (`whop`) | [whop.com/dashboard/developer](https://whop.com/dashboard/developer) | `WHOP_CLIENT_ID` (id only, PKCE) | `/integrations/social/whop` |
| MeWe (`mewe`) | [dev.mewe.com](https://dev.mewe.com) | `MEWE_APP_ID` / `MEWE_API_KEY` | `/integrations/social/mewe` |
| Mastodon (`mastodon`) | per-instance (see below) | `MASTODON_CLIENT_ID` / `MASTODON_CLIENT_SECRET` | `/integrations/social/mastodon` |
| Wrapcast / Farcaster (`wrapcast`) | [dev.neynar.com](https://dev.neynar.com) | `NEYNAR_CLIENT_ID` / `NEYNAR_SECRET_KEY` | none — client-side "Sign in with Farcaster" (Neynar) |
| LINE (`line`) | [developers.line.biz/console](https://developers.line.biz/console/) | `LINE_CHANNEL_ACCESS_TOKEN` (token only) | none — token-only (see the LINE section above) |
| Custom OAuth (`oauth_custom`) | your own OIDC provider | `POSTMILL_OAUTH_CLIENT_ID` / `POSTMILL_OAUTH_CLIENT_SECRET` | see note below |

## TikTok

TikTok needs two products added to the app, and the connect flow requests a
six-scope set that must be approved in full — Postmill validates the granted
scopes when a tenant connects and refuses the connection if any is missing
(`scope_not_authorized`).

1. Open [TikTok for Developers → My Apps](https://developers.tiktok.com/apps)
   and click **Create an app**.
2. On the app's page, add the products **Login Kit** and
   **Content Posting API**.
3. Under **Login Kit** settings, add the redirect URI
   `https://<your-domain>/integrations/social/tiktok`.
4. In the app review, request all six scopes: `video.list`,
   `user.info.basic`, `video.publish`, `video.upload`, `user.info.profile`,
   `user.info.stats`. `video.upload` / `video.publish` are the
   scheduled-posting flows (upload-to-drafts and direct publish);
   `user.info.basic` identifies the connected account; `user.info.profile` /
   `user.info.stats` feed channel analytics; `video.list` feeds post
   analytics.
5. Copy the Client Key and Client Secret:

```yaml
TIKTOK_CLIENT_ID: '<your-client-key>'
TIKTOK_CLIENT_SECRET: '<your-client-secret>'
```

6. Restart the backend.

**Before the app passes review** it runs in development mode — every TikTok
account that will connect must be listed as a tester in the app's sandbox
settings, or their authorization is rejected.

## Discord

Discord OAuth identifies the user; **posting runs on a bot token**, so both
pieces live on the same Discord application.

1. Open the [Discord Developer Portal](https://discord.com/developers/applications)
   and click **New Application**.
2. Under **OAuth2 → General**, add the redirect URL
   `https://<your-domain>/integrations/social/discord` and copy the Client ID and Client
   Secret:

```yaml
DISCORD_CLIENT_ID: '<your-client-id>'
DISCORD_CLIENT_SECRET: '<your-client-secret>'
```

3. Under **Bot**, create the bot user. Tenants copy their own bot token from
   here when they connect (org credential `discord.token`).
4. Restart the backend.

**Tenant flow:** the tenant invites the bot to their guild (OAuth2 → URL
Generator, `bot` scope + Send Messages) with write access to the target
channel, then pastes the bot token in the channel's settings in Postmill.

## Dribbble

1. Open [Dribbble Applications](https://dribbble.com/account/applications/new)
   and register a new application with the callback URL
   `https://<your-domain>/integrations/social/dribbble`. The app requests the
   `public` and `upload` scopes.
2. Copy the Client ID and Client Secret:

```yaml
DRIBBBLE_CLIENT_ID: '<your-client-id>'
DRIBBBLE_CLIENT_SECRET: '<your-client-secret>'
```

3. Restart the backend.

## Kick

1. Open [Kick Developer Settings](https://kick.com/settings/developer) and
   create a new application.
2. Add the redirect URL `https://<your-domain>/integrations/social/kick`.
   The app requests the scopes `chat:write`, `user:read`, `channel:read`.
3. Copy the Client ID and Client Secret:

```yaml
KICK_CLIENT_ID: '<your-client-id>'
KICK_SECRET: '<your-client-secret>'
```

4. Restart the backend.

## Mastodon

Mastodon normally needs **no app at all**: tenants type their instance
hostname in the connect dialog and Postmill registers itself on that server
automatically (dynamic client registration). The same per-instance flow
powers the **GoToSocial**, **Akkoma**, and **Friendica** channels
(Mastodon-API servers) and, with Misskey's MiAuth instead of client
registration, the **Misskey** and **Sharkey** channels — none of them need
env vars.

Operators who prefer a fixed pre-registered app can set:

```yaml
MASTODON_CLIENT_ID: '<your-client-id>'
MASTODON_CLIENT_SECRET: '<your-client-secret>'
```

## MeWe

MeWe hands out API access per developer application (App ID + API Key); the
connect flow redirects to the MeWe login with the registered `redirect_uri`.

1. Open [MeWe Developers](https://dev.mewe.com) and create an application.
2. Register the redirect URL
   `https://<your-domain>/integrations/social/mewe`.
3. Copy the App ID and API Key:

```yaml
MEWE_APP_ID: '<your-app-id>'
MEWE_API_KEY: '<your-api-key>'
```

4. Restart the backend.

## Pinterest

1. Open [Pinterest Developers → My Apps](https://developers.pinterest.com/apps)
   and **Create app**.
2. Add the redirect URI
   `https://<your-domain>/integrations/social/pinterest`. The app requests
   the scopes `boards:read`, `boards:write`, `pins:read`, `pins:write`,
   `user_accounts:read`.
3. Trial access covers development; apply for standard access before serving
   the general public.
4. Copy the App ID and App Secret:

```yaml
PINTEREST_CLIENT_ID: '<your-app-id>'
PINTEREST_CLIENT_SECRET: '<your-app-secret>'
```

5. Restart the backend.

## Reddit

1. Open [Reddit Apps](https://www.reddit.com/prefs/apps) and click
   **create app** — choose type **web app**.
2. Set the redirect URI to
   `https://<your-domain>/integrations/social/reddit`. The app requests the
   scopes `read`, `identity`, `submit`, `flair`.
3. Copy the client ID (shown under the app name) and the secret:

```yaml
REDDIT_CLIENT_ID: '<your-client-id>'
REDDIT_CLIENT_SECRET: '<your-client-secret>'
```

4. Restart the backend.

## Slack

1. Open [Slack API: Your Apps](https://api.slack.com/apps) and **Create New
   App → From scratch**.
2. Under **OAuth & Permissions**, add the redirect URL
   `https://<your-domain>/integrations/social/slack` and the bot token
   scopes `channels:read`, `chat:write`, `users:read`, `groups:read`,
   `channels:join`, `chat:write.customize`.
3. Under **Basic Information**, copy the Client ID and Client Secret:

```yaml
SLACK_ID: '<your-client-id>'
SLACK_SECRET: '<your-client-secret>'
```

4. Restart the backend.

**Tenant flow:** the tenant installs the app into their workspace from the
connect button. For workspaces other than the app's own, enable **Manage
Distribution → Activate Public Distribution** in the Slack app, or installs
are limited to the creating workspace.

## Threads

Threads lives on a Meta app with the Threads use case — separate env vars
from the Facebook Pages credentials.

1. Open [Meta for Developers → My Apps](https://developers.facebook.com/apps)
   and create an app (or reuse an existing one).
2. Add the **Threads API** use case and the permissions `threads_basic`,
   `threads_content_publish`, `threads_manage_replies`,
   `threads_manage_insights`.
3. Add the OAuth redirect URI
   `https://<your-domain>/integrations/social/threads`.
4. Copy the Threads App ID and App Secret:

```yaml
THREADS_APP_ID: '<your-threads-app-id>'
THREADS_APP_SECRET: '<your-threads-app-secret>'
```

5. Restart the backend. Advanced access (beyond tester accounts) requires
   Meta App Review like the other Meta products.

## Twitch

1. Open the [Twitch Developer Console](https://dev.twitch.tv/console/apps)
   and **Register Your Application**.
2. Add the OAuth redirect URL
   `https://<your-domain>/integrations/social/twitch`. The app requests the
   scopes `user:write:chat`, `user:read:chat`,
   `moderator:manage:announcements`.
3. Copy the Client ID and Client Secret (under **Manage**):

```yaml
TWITCH_CLIENT_ID: '<your-client-id>'
TWITCH_CLIENT_SECRET: '<your-client-secret>'
```

4. Restart the backend.

## VK

VK uses a VK ID application with PKCE — only the Client ID, no secret.

1. Open the [VK ID Console](https://id.vk.com/about/business/go) and create
   an application (Web).
2. Add the authorized redirect URI
   `https://<your-domain>/integrations/social/vk`. The app requests the
   scopes `vkid.personal_info`, `email`, `wall`, `status`, `docs`, `photos`,
   `video`.
3. Copy the Application ID:

```yaml
VK_ID: '<your-app-id>'
```

4. Restart the backend.

## Whop

Whop OAuth uses PKCE with only the Client ID (no client secret).

1. Open the [Whop Developer Dashboard](https://whop.com/dashboard/developer)
   and create an app.
2. Add the redirect URI `https://<your-domain>/integrations/social/whop`.
   The app requests the scopes `openid`, `profile`, `email`,
   `forum:post:create`, `forum:read`, `company:basic:read`.
3. Copy the Client ID:

```yaml
WHOP_CLIENT_ID: '<your-client-id>'
```

4. Restart the backend.

## Wrapcast (Farcaster)

Wrapcast uses a Neynar app: sign-in happens client-side in the composer
("Sign in with Farcaster") — no callback to register.

1. Open [Neynar](https://dev.neynar.com) and create an app.
2. Copy the Client ID and API Key:

```yaml
NEYNAR_CLIENT_ID: '<your-neynar-client-id>'
NEYNAR_SECRET_KEY: '<your-neynar-api-key>'
```

3. Restart the backend.

**Tenant flow:** the tenant clicks "Sign in with Farcaster" in the composer
connect flow; publishing uses the app's API key server-side.

## Custom OAuth

Custom OAuth channels reuse the generic-OIDC variables; there is no
dedicated provider adapter in this repo — check the provider's current docs
for the callback to register.

```yaml
POSTMILL_OAUTH_CLIENT_ID: '<your-oidc-client-id>'
POSTMILL_OAUTH_CLIENT_SECRET: '<your-oidc-client-secret>'
```

## SSO dual-use (login with the same app)

Three channel apps can double as **login providers** on the auth page. The gate
is an opt-in flag **plus** the matching channel credential vars — the login
page never advertises a provider whose channel app is unconfigured:

| Flag | Requires | Login flow |
|------|----------|------------|
| `FACEBOOK_SSO_ENABLED: 'true'` | `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` | Facebook OAuth (`public_profile,email`) |
| `X_SSO_ENABLED: 'true'` | `X_API_KEY` / `X_API_SECRET` | X OAuth 2.0 + PKCE (`users.read`) |
| `LINKEDIN_SSO_ENABLED: 'true'` | `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` | LinkedIn OIDC (`openid profile email`) |

Provider-specific prerequisites:

- **Facebook SSO** additionally needs the consumer **Facebook Login** product
  on the Meta app — the FBfB Configuration-ID flow is Pages-only and cannot log
  users in. If the user denies the email permission, Postmill mints
  `fb_<id>@facebook.login.postmill.local`.
- **X SSO** accounts always get a synthetic address
  (`x_<id>@x.login.postmill.local`) — X returns no email.
- **LinkedIn SSO** needs the **Sign In with LinkedIn using OpenID Connect**
  product enabled (same product the channel flow already requires).

Synthetic `.login.postmill.local` addresses are skipped by newsletter
enrollment and welcome emails.

**No account linking:** each SSO login matches users by
(provider, provider-user-id) only. If someone signs in with Facebook and later
with Google under the same real email, Postmill provisions **separate User +
Org accounts** — identities are never merged.

Full walkthrough: [OAuth / SSO](./oauth-sso.md).

## Direct-auth providers (no platform app needed)

These channels need no developer app at either scope — tenants enter account
credentials (or an instance hostname) directly in the connect dialog:
**Bluesky** (app password), **Mastodon** (instance hostname), **GoToSocial**,
**Akkoma**, **Friendica**, **Misskey**, **Sharkey** (instance hostname),
**Matrix** (homeserver + access token + room ID), **Discourse** (API key),
**Odysee** (self-hosted lbrynet daemon — advanced, see the channel's setup
steps), **PeerTube**, **Skool**, **Hashnode**, **Medium**, **WordPress**,
**Nostr**, **Lemmy**, **Pixelfed**, **dev.to**, **Listmonk**, and **Moltbook**.

## Related

- [Configuration](./configuration.md#channel-oauth-apps-platform-click-connect) — the full env var table
- [OAuth / SSO](./oauth-sso.md) — login providers, callback routing, registration policy

> Verified against v1.0.0
