# Data Model

89 Prisma models and 8 enums in a single schema at `libraries/nestjs-libraries/src/database/prisma/schema.prisma`. This page lists every model grouped by domain with a one-line purpose and key relationships.

> **v3.8.10 restructure:** the `User` god-table was split (profile fields moved to `UserProfile`), the flat `Role` enum was replaced by a full RBAC layer (`AppRole`/`Permission`/`AppRolePermission`), and the dead marketplace/GitHub-stars models were dropped. See [Dropped in v3.8.10](#dropped-in-v3-8-10) below.

---

## Core Identity, RBAC & Sessions (9)

| Model | Purpose | Key Relationships |
|---|---|---|
| `Organization` | Tenant — every resource belongs to an org | FK to `Subscription`; has many `Integration`, `UserOrganization`, `Post`, `Campaign` |
| `User` | Identity/auth only — email, password, `providerName`/`providerId`, `isSuperAdmin`, `activated`, last-online telemetry | Unique on `(email, providerName)`; has one `UserProfile`, many `Session`, `UserOrganization` |
| `UserProfile` | 1:1 profile split off from `User` — name, lastName, bio, `avatarUrl` (provider/Gravatar), `pictureId` (uploaded), IANA `timezone`, notification prefs | FK → `User` (unique, cascade), `File` (picture) |
| `Session` | Login session backing refresh-token rotation — `tokenHash` (sha256 of the refresh token, rotated on every use), `previousTokenHash` (last rotated-out hash; reusing it revokes the session), userAgent/ip, `expiresAt`, `revokedAt` | FK → `User` (cascade) |
| `UserOrganization` | Many-to-many join between users and orgs. The legacy `role` enum column was dropped in v3.8.10 — `roleId` → `AppRole` is the role pointer. | FK → `Organization`, `User`, `AppRole` (nullable `roleId`) |
| `AppRole` | RBAC role. Org-scoped when `organizationId` is set; NULL org = seeded system role (`owner`/`admin`/`editor`/`member`/`viewer`, `isSystem: true`) | FK → `Organization` (nullable); has many `AppRolePermission`, `UserOrganization` |
| `Permission` | Fine-grained `(resource, action)` capability — 16 resources × 5 actions seeded | Unique on `(resource, action)`; has many `AppRolePermission` |
| `AppRolePermission` | Join table linking roles to permissions | Composite PK `(roleId, permissionId)`; cascade on both |
| `AuthProviderConfig` | Platform-wide login provider config (managed by the separate administration app — this repo ships no `/admin` frontend and reads it DB-first) — client ID/secret encrypted, OIDC endpoints, enabled flag. Env vars remain the bootstrap fallback. | Unique on `(provider, version)` |

---

## Org Content Helpers (11)

| Model | Purpose | Key Relationships |
|---|---|---|
| `Tags` | Per-org color-coded tags for posts | FK → `Organization`; has many `TagsPosts` |
| `TagsPosts` | Many-to-many join between posts and tags | FK → `Post`, `Tags` |
| `Sets` | Named, reusable post templates (serialized composer payload) | FK → `Organization` |
| `Signatures` | Per-org post signatures — content, channel scope (`channels[]`), auto-add, usage count, optional logo/sticker | FK → `Organization`, FK → `File` (`pictureId`) |
| `Notifications` | Per-org notification feed entries | FK → `Organization` |
| `NotificationRead` | Per-user read state for notification feed entries | FK → `Notifications`, `User` |
| `NotificationPreference` | Per-user master channel toggles + category toggles for Notifications V2 | FK → `User` (unique) |
| `NotificationDigestQueue` | Queued digest entries waiting to be flushed | FK → `User`, `Organization` |
| `PushToken` | Mobile/push notification tokens per user | FK → `User` |
| `Errors` | Post-publish errors with platform and message | FK → `Organization`, `Post` |
| `Announcement` | System-wide announcements (info/warning/error) | Standalone |

---

## Media (12)

| Model | Purpose | Key Relationships |
|---|---|---|
| `File` | Uploaded media files (image/video/audio), with path, type, thumbnail, tags, and `metadata Json?` (dimensions, duration, model, provenance) | FK → `Organization`, `FileFolder` |
| `ContentPackConfig` | Per-org premium content-pack (stock) provider config — encrypted credentials + provider `extraConfig`; the active pack is pointed to by `Organization.activeContentPackIdentifier` | FK → `Organization` |
| `FileFolder` | Folder tree for organizing files, supports cloud-store mounting | FK → `Organization`, parent `FileFolder`, `StorageProviderConfig` |
| `StorageProviderConfig` | Per-org cloud storage config (S3, R2, B2, IDrive E2, LOCAL, and many S3-compatible backends). `accountFingerprint` enforces unique account per org. | FK → `Organization`; has many `FileFolder`, `MediaProviderConfig` |
| `MediaProviderConfig` | Per-org AI media-generation provider config — encrypted credentials, storage binding (`storageProviderId`, null = LOCAL; `storageRootFolderId`) | FK → `Organization`, `StorageProviderConfig` (nullable); unique on `(organizationId, identifier, version)` |
| `MultipartUpload` | Tracks ownership and state of multipart S3 uploads | FK → `Organization` |
| `Design` | Editable Designer (Konva) document — doc JSON, dimensions, preview | FK → `Organization`, `User`, `Campaign`; preview `File` |
| `DesignTemplate` | System-seeded or org-saved templates for the Designer Templates panel | FK → `Organization` (nullable); thumbnail `File` |
| `AiDesignerSession` | Persistent chat thread for the AI Designer (`/media/ai-designer`) | FK → `Organization`, `User`; has many `AiDesignerMessage` |
| `AiDesignerMessage` | Persisted chat/form/plan/media/progress payloads for an AI Designer session | FK → `AiDesignerSession` |
| `PopularPosts` | Curated popular post templates (category + topic + content + hook) | Standalone |
| `Mentions` | Cross-platform mention tracking | Standalone |

---

## Channel Integrations (5)

| Model | Purpose | Key Relationships |
|---|---|---|
| `Integration` | Connected social/chat channel with encrypted OAuth tokens | FK → `Organization`, `Customer`; has many `Post`, `Plugs`, `AnalyticsSnapshot` |
| `Plugs` | Installed plug functions (analytics, comments, etc.) per integration | FK → `Organization`, `Integration` |
| `Webhooks` | Per-org webhook URLs (outbound notifications) | FK → `Organization`; implicit many-to-many with `Integration` |
| `AutoPost` | RSS/feed-based auto-posting configuration | FK → `Organization` |
| `Customer` | Billing customer name per org | FK → `Organization` |

---

## Provider Configuration (4)

| Model | Purpose | Key Relationships |
|---|---|---|
| `OrgProviderConfiguration` | Per-org channel provider OAuth credentials (encrypted). **Many named sets per provider** — unique on `(organizationId, identifier, name, version)`; resolved by row `id`. Replaces `ProviderConfiguration`. | FK → `Organization`; back-ref → `Integration[]` |
| `OrgVpnConfig` | Per-org VPN/proxy provider config (Settings → VPN) — encrypted credentials, enabled `regions` JSON; SOCKS5/HTTP-CONNECT proxies power per-channel VPN egress | FK → `Organization` |
| `ProviderConfiguration` | **DEPRECATED v3.6.0** — global provider config; replaced by per-tenant `OrgProviderConfiguration` | Standalone |
| `FeaturedProvider` | Platform-wide curated featured-provider list surfaced at the top of each domain's provider configuration UI | Unique on `(domain, providerId)` |

A connected `Integration` carries a nullable `providerConfigId` FK (`onDelete: SetNull`) binding it to the named credential set it was connected through, so OAuth handshake, token refresh, and API calls use that set's own auth. When `providerConfigId` is `NULL` (legacy / unbound connections), credential resolution falls back to the org's primary set for the provider identifier (enabled-first).

---

## Posts & Content (3)

| Model | Purpose | Key Relationships |
|---|---|---|
| `Post` | Scheduled/social post — content, state (`QUEUE`/`PUBLISHED`/`ERROR`/`DRAFT`/`PUBLISHING`), publish date, media, settings, campaign, optional `brandId` (per-post brand voice) | FK → `Organization`, `Integration`, `Campaign`, `AIBrandProfile` (nullable `brandId`); self-referential `parentPost` for threads |
| `Comments` | Internal team comments on posts | FK → `Organization`, `Post`, `User` |
| `Mentions` | Cross-platform mention tracking | Composite PK `(name, username, platform, image)` |

---

## Analytics (7)

| Model | Purpose | Key Relationships |
|---|---|---|
| `AnalyticsSnapshot` | Daily per-integration metric snapshot (views, likes, followers, etc.) | FK → `Integration` |
| `PostAnalyticsSnapshot` | Daily per-post metric snapshot | FK → `Post`, `Integration` |
| `WatchedAccount` | Competitor/watchlist account being tracked | FK → `Organization`; has many `WatchedAccountMetric` |
| `WatchedAccountMetric` | Individual metric reading for a watched account | FK → `WatchedAccount` |
| `AnalyticsAnomaly` | Persisted metric anomaly (spike/drop) for idempotent Inngest retries and dashboard alerts | FK → `Integration` |
| `AnalyticsAlertRule` | User-defined alert rule evaluated by the daily sweep | FK → `Organization`, `Integration` (nullable) |
| `AnalyticsShare` | Org-level public share dashboard config + token | FK → `Organization` (unique) |

---

## Social Comments (2)

| Model | Purpose | Key Relationships |
|---|---|---|
| `SocialComment` | Synced platform comment — author, content, sentiment, status, assignment | FK → `Post`, `Integration`, `Organization`, `User` (assignee) |
| `PostCommentRead` | Per-user per-post last-read cursor for social comments | FK → `User`, `Post` |

---

## AI (11)

| Model | Purpose | Key Relationships |
|---|---|---|
| `AIOrgProviderConfig` | Per-org AI provider + encrypted credentials + `defaultModel` and `reasoningModel` | FK → `Organization` |
| `AISpendLog` | Cost ledger — input/output tokens, cost, provider, model, scope | FK → `Organization` (nullable), `User` (nullable) |
| `AIBrandProfile` | Brand voice instructions + language + brand kit (`palette`, `fontFamilies`, `logoFileIds`, `enforcement`, `assets[]`). Many per org since v3.8.10 (`name`, `isDefault`, `slug`); one default per org, selectable per-post via `Post.brandId`. | FK → `Organization`; has many `Post` |
| `AIPromptTemplate` | Editable prompt templates (org-scoped or global, with key) | FK → `Organization` (nullable) |
| `AISettingsAudit` | Append-only audit of AI-settings changes | FK → `User` (nullable) |
| `AIMediaJob` | Media pipeline job — operation, status, artifact URL, provenance, cost. Tracks async media generation (video/audio/avatar/stt) in the media-provider system. | FK → `Organization`, `User` (nullable) |
| `AIPromptLibraryItem` | User-created reusable prompt library entries | FK → `Organization` |
| `AIContentIndex` | RAG index — chunk metadata + BM25 text; embeddings in side table | FK → `Organization` |
| `AIProviderConfig` | **DEPRECATED v3.6.0** — replaced by `AIOrgProviderConfig`; carries `reasoningModel` for parity | Standalone |
| `AISystemSettings` | **DEPRECATED v3.6.0** — active provider moved to per-tenant; kept for scope models and governance | Standalone |
| `OrgDefaultModel` | Per-org per-domain/category default model/media settings (`domain`, `category`, `providerId`, `version`, `model`, `settings`) | Unique on `(organizationId, domain, category)` |

---

## Short-links (3)

| Model | Purpose | Key Relationships |
|---|---|---|
| `OrgShortLinkConfig` | Per-org short-link provider config — provider type, API credentials (encrypted), custom domain, active flag. Multi-account since v3.8.10: `name` + `accountFingerprint` with unique on `(organizationId, identifier, version, accountFingerprint)`. | FK → `Organization` |
| `ShortLink` | Ledger of generated short links — original URL, short URL, provider, post reference | FK → `Organization`, `Post` (nullable) |
| `ShortLinkSnapshot` | Daily click-count snapshot per short link, collected by the analytics sweep | FK → `ShortLink` |

---

## Campaigns (4)

| Model | Purpose | Key Relationships |
|---|---|---|
| `Campaign` | Grouping folder for posts — name, color, date range, archive state, goals, public-share token/settings, UTM toggle | FK → `Organization`; has many `Post`, `CampaignNote`, `CampaignItem`, `Design` |
| `CampaignItem` | Polymorphic tagged item (`entityType` + `entityId`) linking a campaign to one of 9 non-post entity types | FK → `Campaign` |
| `CampaignNote` | Internal **Discussion** thread note — sanitized rich HTML `content`, `parentId` (one-level threading), `mentions` (JSON userId[]), `pinned`, `resolvedAt`, `editedAt`, soft `deletedAt` | FK → `Campaign`; self-FK `parent`/`replies`; has many `CampaignNoteReaction` |
| `CampaignNoteReaction` | Emoji reaction on a note, toggled | FK → `CampaignNote`; unique `(noteId, userId, emoji)` |

`Post` carries `approvalStatus` / `approvedById` / `approvedAt` for the campaign draft-approval flow, and `Campaign.utmEnabled` drives automatic UTM append on publish.

---

## OAuth (2)

| Model | Purpose | Key Relationships |
|---|---|---|
| `OAuthApp` | OAuth 2.0 application registration (client credentials, redirect URL) | FK → `Organization`, `File` (picture) |
| `OAuthAuthorization` | OAuth authorization grant — PKCE, scopes, encrypted tokens, expiry, revocation | FK → `OAuthApp`, `User`, `Organization` |

---

## Billing (5)

| Model | Purpose | Key Relationships |
|---|---|---|
| `Subscription` | Billing subscription — tier, period, channel count, lifetime flag, add-on storage/video exports | FK → `Organization` (unique) |
| `StripeEvent` | Deduplication ledger for Stripe webhooks | Unique on `id` (the Stripe event id) |
| `Customer` | Billing customer name per org | FK → `Organization` |
| `Credits` | AI credit balance per org (type: `ai_images`/`ai_videos`) | FK → `Organization` |
| `UsedCodes` | Used promo/referral codes per org | FK → `Organization` |

---

## API Keys (1)

| Model | Purpose | Key Relationships |
|---|---|---|
| `ApiKey` | Per-user per-org hashed API keys (`pm_live_*`, sha256-stored, show-once) | FK → `User`, `Organization` |

---

## Mastra Telemetry (8)

All 8 models have `@@ignore` or are managed by the Mastra framework. They are **not** accessed through Prisma repositories — Mastra manages its own tables.

| Model | Purpose |
|---|---|
| `mastra_ai_spans` | AI span telemetry (ignored) |
| `mastra_evals` | Evaluation results (ignored) |
| `mastra_messages` | Agent messages |
| `mastra_resources` | Agent resources/working memory |
| `mastra_scorers` | Scoring/evaluation runs |
| `mastra_threads` | Conversation threads |
| `mastra_traces` | Trace data for observability |
| `mastra_workflow_snapshot` | Workflow state snapshots |

---

## Miscellaneous (4)

| Model | Purpose | Key Relationships |
|---|---|---|
| `AuditLog` | DB-backed audit log for credential and storage mutations | FK → `Organization` |
| `EmailLog` | Email send-log metadata (no body). Lifecycle: queued → sent → delivered/bounced/complained/opened/clicked | Indexed on `(provider, providerMessageId)`, `sentAt`, `status` |
| `MigrationLedger` | Internal migration bookkeeping | Unique on `key` |
| `InngestFunctionRun` | Latest run timing/status per Inngest cron function for `/health` | Unique on `functionId` |

---

## Enums

| Enum | Values |
|---|---|
| `State` | `QUEUE`, `PUBLISHED`, `ERROR`, `DRAFT`, `PUBLISHING` |
| `CampaignEntityType` | `POST`, `INTEGRATION`, `ORG_VPN_CONFIG`, `AI_ORG_PROVIDER_CONFIG`, `AI_BRAND_PROFILE`, `STORAGE_PROVIDER_CONFIG`, `FILE`, `SETS`, `SIGNATURES` |
| `SubscriptionTier` | `STARTER`, `PRO`, `TEAM`, `AGENCY` |
| `Provider` | `LOCAL`, `GITHUB`, `GOOGLE`, `FARCASTER`, `WALLET`, `GENERIC` |
| `ShortLinkPreference` | `ASK`, `YES`, `NO` |
| `CreationMethod` | `UNKNOWN`, `WEB`, `MCP`, `API`, `AUTOPOST`, `CLI` |
| `StorageProviderType` | `LOCAL`, `S3`, `CLOUDFLARE_R2`, `BACKBLAZE_B2`, `IDRIVE_E2`, `WASABI`, `DIGITALOCEAN_SPACES`, `HETZNER`, `STORJ`, `SCALEWAY`, `VULTR`, `LINODE`, `S3_COMPATIBLE`, `MEDIALOCKER` |
| `AnnouncementColor` | `INFO`, `WARNING`, `ERROR` |

`MEDIALOCKER` was added to `StorageProviderType` additively by migration
`20260714150606_add_medialocker_storage_type` (`ALTER TYPE ... ADD VALUE` — backward-compatible, no
data rewrite).

---

## Dropped in v3.8.10

The dead marketplace/GitHub-stars subsystems were removed in a single destructive push (preceded by a DB snapshot):

- **Models:** `SocialMediaAgency`, `SocialMediaAgencyNiche`, `MessagesGroup`, `Messages`, `Orders`, `OrderItems`, `PayoutProblems`, `ItemUser`, `GitHub`, `Star`, `Trending`, `TrendingLog`
- **Enums:** `Role` (`SUPERADMIN`/`ADMIN`/`USER` — superseded by `AppRole`-based RBAC), `OrderStatus`, `From`
- **Columns:** `User` profile/notification/marketplace columns (moved to `UserProfile` or dropped), `UserOrganization.role`, `Post` marketplace fields (`submittedForOrderId`, `submittedForOrganizationId`, `approvedSubmitForOrder`), `AIOrgProviderConfig.imageModel` / `AIProviderConfig.imageModel`, and the old `OrgShortLinkConfig` per-provider unique constraint

See [Upgrading → v3.8.9 → v3.8.10](../operations-guide/upgrading.md#v3-8-9-v3-8-10) for the operational procedure.

> Verified against v1.0.0
