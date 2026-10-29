# Settings

The Settings area is the control centre for your organisation and personal account. Reach it from
the avatar menu → **Settings**. The left rail is grouped into **Workspace**, **Automation**, and
**Developer** sections.

## Subscription tab

Shown when billing is enabled for the instance. Manage your organisation's plan, billing cycle,
and usage:

- **Plan selection** — choose between **Starter**, **Pro**, **Team**, and **Agency** tiers, billed
  monthly or yearly. Each plan lists its channel, video-export, and storage allotments.
- **Current plan badge** — the plan you are on is marked **Current**.
- **Usage bars** — visual gauges for posts, video exports, storage, channels, team members,
  competitors, webhooks, and brand kits used versus the plan limit. Bars turn amber at 80% and red
  at 100%.
- **Add-ons** — buy extra packs (storage, video exports, channels, team seats, posts, brand kits,
  webhooks, competitors) without changing tier.
- **Change plan** — upgrade or downgrade; the change is applied through the billing backend. A
  pending downgrade shows a banner with an **Undo** button.
- **Cancel / resume** — cancel the subscription at the end of the current period, or resume a
  cancelled subscription before it expires.
- **Payment method & invoices** — handled on the `/billing` page through your payment provider's
  customer portal.

Which of these controls appear depends on the payment provider your organisation is billed
through — for example PayPal has no add-ons and cannot resume a cancelled subscription, and a
subscription bought in the mobile app shows a **Manage subscription** link to the app store
instead. See [Subscription & Billing](./subscription-and-billing.md) for plans, metered caps, and
payment providers.

## Team tab

Available when your subscription tier includes team members. Manage who has access to your
organisation:

- **Invite Member** — send an email invitation (or copy the invitation link instead). Invited users
  receive a registration link valid for one hour.
- **Create User** — create an activated local account with a password and role directly (the
  button shows for members with `members:manage`; the API requires `settings:update`).
- **Roles** — membership is governed by a full role-based access control (RBAC) system.
  Five system roles are seeded for every organisation:

  | Role | What it can do |
  |------|----------------|
  | **Owner** | Everything in the org, including billing and member management. The user who created the org is the owner. |
  | **Admin** | Everything except billing management and deleting the organisation. |
  | **Editor** | Full control of posts, media, channels, and comments; read access to analytics and brands. |
  | **Member** | Create, read, and update posts; create, view, edit, and delete media; read analytics, comments, and brands. |
  | **Viewer** | Read-only access to all resources. |

  The team screen's role selector lists every role in the org — the five system roles plus any
  custom roles. A member who lacks a permission receives **HTTP 403** on the gated action
  (distinct from a 402, which means your plan doesn't include the feature).
- **Custom roles** — the **Manage roles** button on the Team page (visible to members with
  `members:manage` or `settings:update`) opens a modal that lets an admin clone a system role, toggle individual permissions grouped by
  resource, create/edit/delete custom roles (system roles can't be deleted), and assign a role to
  a team member.
- **Datatable** — the team list shows each member's name, role, and status (Active / Pending), and
  can be searched by name or email, filtered by role, and sorted by name or join date. Role
  changes and member removal are available from the per-row controls to members holding
  `members:manage`; only the owner can change or remove another owner.

See [Team & Roles](./team-and-roles.md) for the full RBAC model.

## Broadcast tab

Visible to members with the `notifications:manage` permission. Send an in-app announcement or
message to everyone in the organisation. Broadcasts use the `announcements` notification category
with `override: true`, so they reach recipients even if they have disabled announcements.

## Channels tab

Connect and manage social media and chat channels.

### Named credential sets

A **channel** here is a named OAuth-app credential set. Click **Add Channel**, pick a provider,
then fill in the configuration dialog:

- **Channel name** (required) — a label that identifies this credential set (e.g. "Marketing
  LinkedIn").
- **Connect with &lt;provider&gt;** — when the operator has configured the platform app for that
  provider, the dialog says **Uses the Postmill app — no setup needed** and connecting is one click;
  your own app's credentials move under **Advanced**.
- **Client ID / API Key** and **Client Secret / API Secret** — your own app credentials. The
  dialog shows the **Callback URL** to register (with a copy button), the permissions that will be
  requested, and setup instructions.
- **Enabled** — a set must have a Client ID / API Key before it can be enabled.

You can add **many credential sets for the same provider**, each with a different name — useful when
an org juggles several OAuth apps for one platform. Each named set has its **own auth**: a social
account connected through a set uses that set's credentials for the OAuth handshake, token refresh,
and API calls. The **Add Channel** picker shows each provider's capability tags and offers a
**search** box and a **Capabilities** filter dropdown (checkboxes) to find the right provider; the
configured-channel list itself is searchable by name and shows each set's enabled state and the
accounts connected through it ("Connected as …").

### Channel configuration

Credential sets are stored per-organisation in `OrgProviderConfiguration` records and encrypted at
rest (AES-256-GCM). From a set's dialog you can:

- **Save** — update the name and credentials (leave a secret blank to keep the stored value).
- **Connect another account** — connect a further social account through this set.
- **Test** — validate the credentials.
- **Remove** — delete this credential set. Accounts that were connected through it become
  unbound: they keep working only if the platform env OAuth app is configured for that
  provider, otherwise reconnect them through another set.

### Provider capabilities

The **Add Channel** picker shows capability badges on each provider — analytics, comments, first
comment, polls, video, carousel, alt text, link preview, refresh token, and watchlist support — and
its **Capabilities** filter dropdown narrows the provider list to those supporting the selected
features, so you can judge feature availability before configuring a provider.

See [Supported Channels](./supported-channels.md) for the full capability matrix.

### Per-channel VPN egress

Each channel configuration can opt into routing all of its outbound posting requests through a VPN
region's proxy. The channel's edit dialog has a **VPN connection** switch and a **Provider &
region** selector populated from the organisation's enabled VPN providers and their enabled
regions. Only SOCKS5 / HTTP-CONNECT VPN
providers can be applied per-request; tunnel providers (WireGuard/OpenVPN) are not selectable here.
Routing is resolved at publish time through a pooled dispatcher and is invalidated automatically
when the VPN config changes. See [VPN tab](#vpn-tab) for configuring VPN providers.

## Comms tab

Connect your team's chat apps (Slack, Telegram, Discord, Matrix, LINE) so members can chat with
the Postmill agent and receive notifications there. Click **Add Comms Channel**, pick a provider,
and connect it — with the instance's platform app when the operator has set one up, or with your
own bot/app under **Advanced**. Each configured channel shows whether it is enabled and which team
members are linked to it. See
[Platform Comms Apps](../operations-guide/platform-comms-apps.md) for the operator setup.

## AI tab

Configure AI providers, models, spending, and prompt management.

### LLM Providers sub-tab

- **Organization budget** — the card at the top of **LLM Providers**: a hard ceiling on your
  organisation's total AI spend across every provider (monthly cap, daily cap, both in USD, plus an
  alert threshold). Once it is reached, every AI call is refused with HTTP 429 regardless of
  per-provider caps — including surfaces that don't pick a single provider (AI Designer, content
  pipeline, the daily brief). Turning the switch off clears the ceiling. A saved cap is enforced
  immediately on the instance that saved it and within a minute everywhere else.
- **Provider list** — every available AI provider (direct providers plus hub/gateway providers,
  which carry a **Hub** chip), with its brand icon and capability chips (text, image, vision,
  embeddings, speech, tools). A search box and capability filter chips narrow the list. If no
  provider is enabled, AI features are disabled across all surfaces.
- **Configure** — click a provider's row to open its configuration modal, which shows the
  provider's description and, once set up, a **Configured** status with the last-updated time.
  Enter the API credentials (encrypted at rest). Providers that support an endpoint override —
  OpenAI, OpenRouter, Vercel AI Gateway, and the OpenAI-compatible family (Qwen Cloud, MiniMax,
  DeepInfra, SiliconFlow, Kimi, NVIDIA, …) — also show an optional **Base URL** (required only for
  the generic OpenAI-compatible provider); it must be a public HTTPS URL. When you reopen a
  configured provider, non-secret values such as the Base URL are prefilled; secrets are never
  returned and must be re-entered to change them. Image models are not part of AI provider
  configuration — image/video/audio generation is configured in the [Content tab](#content-tab).
  Popular providers show a **Where do I get my API key?** link to their keys page. Saving tests
  the connection first: if the test fails, nothing is saved and the provider's error is shown,
  with a **Save anyway** option.
- **Provider budget** — opt-in via the **Budget limits** switch in the provider's configure form
  (off by default). When enabled, each provider can carry its own monthly cap, daily cap (both
  numeric, in USD), and alert threshold (a percentage slider). When a cap is exceeded, calls against
  that provider return HTTP 429 while other configured providers remain usable. Activating a new
  provider version copies the budget from the previously active row when the target row has no
  budget set.
- **On / Off and Make Primary** — you can enable as many configured providers as you like with
  their **On/Off** switch; **Make Primary** marks one enabled provider as the organisation's
  primary.
- **Test / Remove** — validate that the stored credentials can reach the provider's API, or delete
  the configuration.

### Model Defaults sub-tab

Pick the default model for each category from your enabled providers, or leave it on **Auto**
(Postmill picks a model from your enabled providers; **Reset to Auto** reverts a saved choice):

- **Low Reasoning** — utility text, prompts, slide breakdowns, and embeddings.
- **High Reasoning** — generation, agents, MCP, and any reasoning-heavy task.
- **Vision** — image understanding and focal-point detection.
- **Workflow** — reserved for future agentic workflow steps.

A category with no provider able to serve it is shown disabled.

AI spend (monthly and daily totals with the remaining budget, and spend by provider) is shown in
the **Usage & budget** card on the [Dashboard](./dashboard.md); spend by scope is on
**Analytics → Usage**.

### Prompt Templates sub-tab

Manage `AIPromptTemplate` records — reusable templates that define the system prompt for AI
operations:

- Create templates with a unique `key` and `content`.
- Templates can be org-scoped (visible only to your organisation) or global (available to all
  organisations on the instance — requires admin privileges).
- Edit or delete existing templates.

### Prompt Library sub-tab

Manage `AIPromptLibraryItem` records — user-created reusable prompts:

- Create items with a `title` and `content`.
- Browse, edit, and delete your library items.
- Use library items as starting points when composing AI prompts in the text editor.

## Brands tab

An organisation can manage **multiple brands** instead of a single brand profile. The tab shows a
brand list with create, edit, and delete, plus a **Default** badge:

- **Create / delete brands** — add as many brands as you need, each with a name. Deleting the
  default brand reassigns the default to another brand.
- **Default brand** — one brand is the default; it behaves like the old single brand profile
  (applied to all AI generations unless a post selects a different brand).
- **Per-post brand selection** — the composer includes a brand picker; the selected brand's voice
  is used when generating content for that post.
- Brand management requires the `brands:manage` permission (owner/admin by default); all members
  can read brands so the composer picker works.

### Brand Voice (per brand, per language)

- **Enable/disable** — toggle whether the brand profile is applied to AI generations.
- **Language** — at the top of the editor; it selects which language's dataset you are editing. The
  active language is the one used for AI generation. Switching the language shows a fresh dataset
  (its own instructions and channel overrides) for that brand/language — so a brand can carry a
  distinct voice per language.
- **Instructions** — freeform text defining the brand's writing style, tone, and voice **for the
  selected language**. This is injected into AI-generated content.
- **Channel overrides** — optional, per language: override the instructions for a specific connected
  channel (pick a channel from the dropdown to add one). Channels without an override use the
  language's instructions above.

### Brand Assets (per brand)

Each brand carries a brand kit, surfaced both in Settings → Brands and in the Designer:

- **Colour palette** — define the brand's colours; the Designer uses these and (when enforcement is
  on) warns on off-palette exports.
- **Attached assets** — attach logos and reference imagery (picked from your Files or the stock
  library; stock picks are imported into Files so they persist), each with an optional caption.
- **Brand enforcement** — toggle whether the Designer warns when an export uses off-palette colours
  or non-brand fonts.

### Knowledge Base

- **Index content** — trigger indexing of your top-performing posts into the RAG vector store.
  The system selects the posts with the highest engagement metrics.
- **Search brand memory** — semantic search across your indexed top-performing content. Use this
  to find past posts that performed well for a given topic.
- **RAG status** — shows whether the vector store is enabled, which backend is in use, and index
  statistics.
- **Vector database** — choose where embeddings are stored:
  - **Postmill (Default)** — the built-in PostgreSQL + pgvector store; no configuration.
  - **PG Vector (Remote)** — an external Postgres + pgvector (connection string + table).
  - **Qdrant (Remote)** — a Qdrant cluster (URL, API key, collection, distance).
  - **Pinecone (Remote)** — a Pinecone serverless index (API key, index name, optional host).

  The three remote options require connection settings and offer a **Test Connection** button.
  Secrets are encrypted at rest in `AISystemSettings.secretSettings` and never returned to the
  client. When a remote store is unreachable, indexing/search fall back to the built-in pgvector/text
  path.
- **Manual index** — index custom content items (text, URLs, files) into the RAG store.
- **Backfill** — trigger a full re-index of all historical content.

## Shortlinks tab

Configure and manage short-link providers per organisation. Short links are used to shorten URLs
in published posts.

- **Provider list** — provider cards with real brand icons and a **Primary** badge; click a row to
  configure it, with per-row **Make Primary / Test / Remove** actions. 20 supported providers: Bitly, TinyURL, T.LY, Short.io,
  Rebrandly, Dub.co, Cutt.ly, Tiny.cc, is.gd, v.gd, BL.INK, T2M, Linkly, Lnkify, Replug, Switchy,
  PixelMe, Sniply, Ow.ly, CleanURI.
- **Multiple accounts per provider** — you can add several accounts of the same provider (e.g. two
  Bitly accounts), each with its own display **name**. Adding the *same* account twice is rejected
  (accounts are fingerprinted from their credentials).
- **One primary at a time** — only one short-link account is the primary per organisation. Making
  another account primary replaces the previous one.
- **Single-step configuration** — OAuth where the provider offers it (e.g. Bitly), otherwise API
  keys. No second step.
- **Custom domains** — if your selected provider supports custom (branded) domains, enter the domain
  in the configuration panel.
- **Credentials** — API keys or tokens are stored encrypted at rest in `OrgShortLinkConfig` and
  never sent to the browser.
- **Test connection** — validate that the configured credentials and domain are working before
  publishing.
- **Shortlink preference** — the ASK / YES / NO preference card was removed from Settings; the
  shorten-links choice is applied in the composer flow when you post.
- **Link ledger** — every generated short link is recorded in the `ShortLink` table for analytics
  tracking and deduplication.

### Per-provider credential fields

| Provider | Auth Type | Credential Fields | Where to get them |
|----------|-----------|-------------------|-------------------|
| Bitly | OAuth2 / API Key | Access Token (paste) — or Client ID + Client Secret (OAuth flow) | [bitly.com/a/oauth_apps](https://bitly.com/a/oauth_apps) — register an OAuth app, or generate a Generic Access Token from your Bitly settings |
| TinyURL | API Key | API Token | [tinyurl.com/app/settings/api](https://tinyurl.com/app/settings/api) |
| T.LY | API Key | API Token | [t.ly/settings/api](https://t.ly/settings/api) |
| Short.io | API Key | Secret Key, Short Domain | [short.io/settings/api](https://short.io/settings/api) |
| Rebrandly | API Key | API Key, Workspace ID (optional) | [rebrandly.com/settings/api](https://rebrandly.com/settings/api) |
| Dub.co | API Key | API Token (`dub_...`), API Endpoint (optional) | [dub.co/settings/tokens](https://dub.co/settings/tokens) |
| Cutt.ly | API Key | API Key | [cutt.ly/api](https://cutt.ly/api) |
| Tiny.cc | API Key | Login / Username, API Key | [tiny.cc/api](https://tiny.cc/api) |
| is.gd | None | — | No credentials required |
| v.gd | None | — | No credentials required |
| BL.INK | API Key | API Key | [bl.ink/settings/api](https://bl.ink/settings/api) |
| T2M | API Key | API Token | [t2m.io/settings/api](https://t2m.io/settings/api) |
| Linkly | API Key | API Key, Workspace ID | [linklyhq.com/settings/api](https://linklyhq.com/settings/api) |
| Lnkify | API Key | API Key (`lf_live_...`), Base URL (optional — self-hosted instances) | [docs.lnkify.io](https://docs.lnkify.io) — hosted default `https://lnkify.io` |
| Replug | API Key | API Key | [replug.link/settings/api](https://replug.link/settings/api) |
| Switchy | API Key | API Key | [switchy.io/settings/api](https://switchy.io/settings/api) |
| PixelMe | API Key | API Key | [pixelme.me/settings/api](https://pixelme.me/settings/api) |
| Sniply | API Key | API Token | [snip.ly/settings/api](https://snip.ly/settings/api) |
| Ow.ly | API Key | Hootsuite Token | Create/stats not supported via public API — requires Hootsuite dashboard |
| CleanURI | None | — | No credentials required |

**Bitly OAuth setup (alternative to pasting an access token):**
1. Register a new OAuth app at [bitly.com/a/oauth_apps](https://bitly.com/a/oauth_apps).
2. Enter the redirect URI as `<FRONTEND_URL>/settings?tab=shortlinks` (this must also be on the
   `INTEGRATION_RETURN_URL_ALLOWLIST` env var — see [Configuration](../operations-guide/configuration.md#security)).
3. Copy the generated Client ID and Client Secret into the Bitly provider panel.
4. Postmill handles the authorization redirect and token exchange via the built-in OAuth flow.

## Content tab

The **Content** page groups the content-authoring surfaces into one tabbed view:

- **AI Media** — the AI media-generation providers (see [AI Media sub-tab](#ai-media-sub-tab) below).
- **Media Defaults** — the default provider/model per media task (see below).
- **Content Packs** — premium stock-media packs (shown to members who can manage media
  configuration).
- **Post Templates** (sets) and **Signatures** — reusable post templates and signatures.

### Content Packs sub-tab

A content pack is the stock media library that powers searches for photos, videos, vectors,
stickers, icons, and audio across the app. Postmill ships with a free default pack; connect a
premium provider for higher-quality, licensed content.

- **Free default** — `Postmill (Default)` is active when no premium pack is Primary. It covers all
  capabilities and falls back to the free stock providers.
- **Premium packs** — provider cards with brand icons, configured/active badges, and **Configure /
  Make Primary / Remove / Test** actions. Only one pack is enabled at a time; anything it does not
  declare falls back to the free default.
- **Supported premium packs** — Magnific, Vecteezy, Adobe Stock, and Envato Elements.
- **Credentials** — encrypted at rest and never returned to the browser.

See [Media Library → Content Packs](./media-library.md#content-packs) and the individual stock
browser pages under [Media Studios](./media/index.md) for how packs affect search results.

### AI Media sub-tab

A pluggable per-organisation media-provider page that mirrors the AI tab: provider cards with brand
icons and capability chips, a search box and capability filter chips, an **On/Off** switch and
**Make Primary** per configured provider, and **Test / Remove** actions. Click a provider's row to
enter its API credentials (encrypted at rest); the same modal shows the provider's description
and, once set up, its **Configured** / last-updated status.

**Test** calls the provider's own lightweight auth check and is free for most providers (OpenAI,
Replicate, Stability, Runway, Leonardo, Recraft, fal.ai, Kling AI, Black Forest Labs, Ideogram,
Together AI, SiliconFlow, Vercel AI Gateway, Azure OpenAI, MiniMax, ElevenLabs, HeyGen, …); a
provider without a probe falls back to rendering a small test image when it can. Testing a
provider that has no saved configuration returns **404**.

It lists every AI media provider — fal.ai, direct Kling AI, OpenAI, ElevenLabs, HeyGen, Runway,
Black Forest Labs, Google, Replicate, Stability AI, MiniMax, Luma, and more; see
[Media Studios](./media/index.md) for the full list. The fal.ai card opens `/media/fal`, and the
Kling AI card opens `/media/kling-ai`. Pika uses the configured fal.ai connection and deliberately
has no separate provider card.

Image generation returns immediately; video, audio, and avatar generation run as background jobs
and the finished artifact is saved into your storage when the provider completes.

**Auto-config:** entering OpenAI or MiniMax credentials in the AI tab also configures them as a
media provider (and vice versa) — the key is shared, you don't re-enter it.

### Media Defaults sub-tab

Pick the default provider and model for each media task — text-to-speech, text-to-music,
text-to-image, text-to-video, image-to-image, image-to-video, upscale, background removal,
inpainting, outpainting, focal point, slides, video avatar, and so on — from your enabled media providers.

#### C2PA provenance

When enabled, generated media files are signed with C2PA Content Authenticity Initiative
metadata, embedding cryptographically verifiable provenance into output files.

### Post Templates (Sets) sub-tab

Create named, reusable post templates:

- A **Set** captures a full composer payload — the selected channels, per-channel settings, post
  content, and any attached media — so you can reload it into the composer in one click.
- The Sets list shows a rich preview of each set: the channels it targets (as avatars), how many
  posts it contains, and thumbnails of its media.
- Edit and delete existing sets.

Managing sets requires the `posts` permission (RBAC).

### Signatures sub-tab

Manage reusable, channel-aware signatures:

- **Content** — a reusable text block appended to a post (hashtag blocks, legal disclosures,
  "Follow us" CTAs).
- **Logo / sticker** — optionally attach an image (from your Files or the stock library) to a
  signature. When the signature is applied, the image is added to the post's media.
- **Channel scope** — apply a signature to all channels, or restrict it to specific channels.
- **Auto-add** — mark one or more signatures to be appended automatically to new posts (text **and**
  logo), respecting each signature's channel scope. Several scoped auto-add signatures can coexist.
- **Usage** — each signature tracks how many times it has been applied.
- Insert a signature manually from the composer's signature toolbar button (its logo is attached
  too).

## VPN tab

Configure VPN provider credentials for your organisation and enable regions that can then be
assigned to individual channels in the [Channels tab](#channels-tab).

- **Provider list** — provider cards with real brand icons, configured/enabled badges, and a
  **Configure / Remove** action per row. Supported providers include **NordVPN**, **ExpressVPN**,
  **Surfshark**, **Proton VPN**, **Mullvad**, and others.
- **Credential fields** — each provider exposes its required manual-setup credentials (for example,
  service credentials, activation code, or account number) and an optional config-file URL.
- **Region enablement** — providers that expose a static region catalog let you tick which regions
  are available for channel routing. Dynamic-region providers derive their region from your stored
  config and do not show a checklist.
- **Enable toggle** — a configured provider can be enabled or disabled.
- **Test connection** — validates that the stored configuration can authenticate.
- **Credentials** — encrypted at rest in `OrgVpnConfig` and never returned to the browser.

Only SOCKS5 / HTTP-CONNECT providers can be used for per-request channel routing. Tunnel providers
(WireGuard/OpenVPN) are configured here but are not selectable in the per-channel VPN egress picker.

## File Storage tab

Configure where uploaded media files are stored. See [Storage Setup](../operations-guide/storage.md)
for the operations perspective.

### Providers sub-tab

Provider cards with real brand icons, configured/mounted badges, and quota/usage chips.

- **Add provider** — configure a new storage backend: AWS S3, Cloudflare R2 (an endpoint is
  required), Backblaze B2, IDrive e2, Wasabi, DigitalOcean Spaces, Hetzner, Storj, Scaleway, Vultr,
  Linode / Akamai, any S3-compatible service, or MediaLocker. You can add as many storages as you want per provider type, each with
  its own name — but **each must be a unique account**: adding the same account twice is rejected
  (accounts are fingerprinted from their credentials). A new provider is mounted automatically
  once its connection test passes, so it appears as a root folder in the media library right away.
- **Provider cards** — each configured provider shows its name, type, mount status, and usage.
  Actions per card:
  - **Mount/Unmount** — make the provider available or unavailable as a root folder in the media
    library. **Unmount disables, it does not delete** — the configuration and data references are
    retained, and the provider can be re-mounted.
  - **Edit** — update credentials, bucket, region, endpoint.
  - **Test** — verify connectivity and permissions.
  - **Delete** — remove the provider configuration. Blocked while the provider is mounted
    (unmount first); LOCAL can never be deleted.
  - **Migrate** — move files from this provider to another.
- **LOCAL is the always-on base storage** — it cannot be deleted or unmounted. All app-internal
  writes (avatars, AI-generated media, uploads) go to LOCAL. Additional providers (S3, R2, B2,
  and the other cloud buckets) mount onto LOCAL and appear as root folders in the media library;
  there is no "default" provider concept. Local files are stored in a per-organisation partition
  with a soft quota (5 GB by default; see [Storage Setup](../operations-guide/storage.md)).

### Quota display

There is no separate quota sub-tab. Each provider card shows used versus allocated storage with a
percentage bar (amber from 80%, red from 90%), and a warning banner appears at the top of the
storage pages when you approach your quota.

### Usage Breakdown sub-tab

- **By Folder** — storage used by each media library folder.
- **By Provider** — storage used by each configured provider.

### Audit Log sub-tab

A timestamped log of all storage operations: provider mounts/unmounts, configuration changes,
migrations initiated, and quota events.

## Webhooks tab

Available when your subscription tier includes webhooks.

- **Add webhook** — define a name and endpoint URL, select event types to subscribe to, and choose all
  or specific integrations. Payload signing uses the deployment-wide `WEBHOOK_SIGNING_SECRET`, not a per-webhook key.
- **Manage** — edit or delete existing webhook endpoints.
- **Test Webhook** — send a test payload to verify your endpoint receives and processes webhooks
  correctly.
- **Event types** — `post.published`, `post.failed`, `comment.new`, `comment.reply`,
  `analytics.snapshot_complete`, and `analytics.anomaly_detected`.

See [Webhooks](../developer-docs/webhooks.md) for the developer reference on payload format and
HMAC verification.

## Auto Post tab

Available on every tier. Create **Auto Post Rules** that turn an RSS feed into posts:

- **RSS URL** — provide a title and an RSS feed URL (**Validate RSS** checks it). Postmill
  periodically checks the feed for new items (the rule also has a **Sync from last post?** option).
- **AI content** — optionally **Autogenerate content** (and **Generate picture?**) with AI, or
  write a fixed post template.
- **When to post?** — post immediately or on the next available slot, to all or specific
  integrations.

## Campaigns tab

A shortcut to the Campaigns hub at `/campaigns`. Organize posts, channels, files, and planning
notes into campaigns; use Discussion threads, UTM tagging, goals, and public share reports. See
[Campaigns](./campaigns.md).

## Developers tab

Available when the public API is enabled for your tier. Manage developer access to your
organisation:

### OAuth Apps

Create and manage OAuth 2.0 applications for third-party integrations:

- **Register an app** — generate a Client ID and Client Secret.
- **Redirect URIs** — configure allowed callback URLs for the OAuth flow.
- **Scopes** — define what data and actions the app can access on behalf of users.
- **Revoke** — disable or delete an OAuth app.

See [OAuth Apps](../developer-docs/oauth-apps.md) for the developer integration guide.

### API Keys

Manage public API access keys for programmatic use of Postmill endpoints:

- Generate new API keys.
- View existing keys (masked display).
- Revoke keys.

See [Public API v1](../developer-docs/public-api.md) for the full API reference.

### MCP

The Developers tab also surfaces the MCP client configuration (for CLI clients such as Claude Code
/ Codex, or remote servers such as ChatGPT and Claude) and a **CLI & AI Skills** panel, both keyed
to an API key. See [MCP Server](../developer-docs/mcp.md).

## Approved Apps tab

Lists all OAuth applications that you have granted access to your account:

- Each entry shows the application's logo, name, description, and authorisation date.
- **Revoke** — remove an application's access to your account. After revocation, the
  application's tokens are invalidated and it can no longer act on your behalf.
- **Postmill ID sign-ins** — a second section (shown once you have used one) lists first-party apps,
  such as the template store, that you signed in to with **Sign in with Postmill**, together with
  the organisation you consented for. **Revoke** removes that sign-in grant.

## Profile, sessions, and notifications

These live outside the Settings page, in the avatar menu:

- **Profile** (`/user/me`) — name, last name, bio, profile picture, and timezone (IANA zone, used
  to display schedule dates and the composer's time picker). Your avatar resolves in this order:
  external avatar (OAuth login provider's picture, or a Gravatar generated from your email) →
  uploaded profile picture → your initials.
- **Security** (`/user/me/security`) — change your password, and an **Active Sessions** device list (browser,
  IP, last used). Revoke any session individually, or log out all other sessions at once. Logging
  out revokes all of your sessions.
- **Notifications** (`/user/me/notifications`) — per-category notification preferences across
  email, push, and in-app channels for all ten categories (post published, post failed, channel
  issues, replies, AI budget, media jobs, announcements, streak reminders, agent briefs, analytics
  alerts).
  See [Notifications](./notifications.md).

## Who can see Settings

Settings access is permission-gated: reading and changing the org-level settings tabs requires the
`settings` permission, which the seeded **Owner** and **Admin** roles carry. The provider surfaces
(AI, Media, Storage, Shortlinks, VPN) and brand management are likewise gated on their own
permissions. A member whose role lacks the grant receives **HTTP 403**; an org can grant these
permissions to a custom role. Billing management is owner-only.

> Verified against v1.4.0
