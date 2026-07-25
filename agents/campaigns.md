# Campaigns (developer view)

Campaign Hub: an org-scoped grouping entity that tags posts, files, channels, configs and
designs; carries UTM auto-append, goals, a client-facing share report, draft approvals, and a
Jira-style internal discussion thread. Sibling docs: `agents/backend.md`,
`agents/database.md`, `agents/frontend.md`, `agents/jobs.md`, `agents/security.md`.

## Prisma models

`libraries/nestjs-libraries/src/database/prisma/schema.prisma` (lines ~1712–1820).

| Model | Purpose | Key fields |
|---|---|---|
| `Campaign` | The grouping entity. Soft-deleted. | `organizationId`, `name`, `color?`, `description?`, `startDate?`, `endDate?`, `archived`, `createdById?`, `client?`, `project?`, `tags Json?` (string[]), `goals Json?` (`[{metric, target}]`), `shareToken? @unique` (CSPRNG), `shareEnabled`, `utmEnabled`, `deletedAt?` |
| `CampaignItem` | Polymorphic tag of a campaign onto any of the 9 non-post entity types. **No FK to source tables** — orphans are skipped on read and reaped by cron. | `campaignId`, `organizationId`, `entityType CampaignEntityType`, `entityId`, `createdById?`; `@@unique([campaignId, entityType, entityId])` |
| `CampaignNote` | Internal discussion ("Discussion" tab), sanitized rich HTML, **one level** of threading (`parentId` must be top-level). Distinct from synced social `SocialComment`. Soft-deleted. | `campaignId`, `organizationId`, `createdById`, `parentId?`, `content`, `mentions Json?` (userIds), `pinned`, `resolvedAt?`, `resolvedById?`, `editedAt?`, `deletedAt?` |
| `CampaignNoteReaction` | Emoji reactions on notes. | `noteId`, `userId`, `emoji`; `@@unique([noteId, userId, emoji])` |
| `CampaignEntityType` (enum) | `POST`, `INTEGRATION`, `ORG_VPN_CONFIG`, `AI_ORG_PROVIDER_CONFIG`, `AI_BRAND_PROFILE`, `STORAGE_PROVIDER_CONFIG`, `FILE`, `SETS`, `SIGNATURES` (9 values) | — |

Linking exceptions: **posts** use `Post.campaignId` (direct column, not `CampaignItem`);
**designs** use `Design.campaignId`. `POST` in the enum exists for uniformity but the read
paths resolve posts via the column.

## Backend code

All under `libraries/nestjs-libraries/src/database/prisma/campaigns/`:

| File | Symbol | Role |
|---|---|---|
| `campaigns.service.ts` | `CampaignsService` | CRUD (`create`/`update`/`remove` → soft-delete), `listPaged` (offset paging), `getDashboard`, `getEngagement`, `getCampaignFiles`, `getSummaries` (dashboard widget), `copy`, `mintShareToken`/`disableShare`/`findByShareToken` |
| `campaigns.repository.ts` | `CampaignsRepository` | Sole Prisma access for `Campaign`; all reads filter `organizationId` + `deletedAt: null` |
| `campaign-item.service.ts` | `CampaignTagService` | `tagItem`/`untagItem`/`listItems`/`listCampaignsForItem`, `purgeExpiredItems(days)`. Validates the target entity exists **and belongs to the org** before tagging (foreign ids rejected, not stored as orphans) |
| `campaign-item.resolver.ts` | `CampaignItemResolverRepository` | Resolves `(entityType, entityId)` → real row per type; returns null for orphans (skipped on read) |
| `campaign-note.service.ts` (+ `.repository.ts`, `.sanitize.ts`) | `CampaignNoteService` | Discussion CRUD, pin/resolve/react, author-or-superadmin edit/delete; HTML sanitized in `campaign-note.sanitize.ts` |
| `campaign-report.service.ts` (+ `campaign-report.html.ts`) | `CampaignReportService` | `dispatchReport(id, orgId, format: json\|csv\|pdf)`, `resolveShareToken`, `computeAnalytics`, `toPublicJson`. **Strips `shareToken`/`shareEnabled`** and other internal fields from public payloads |
| `campaign-goal-progress.ts` | — | Goal progress computation for the dashboard (`goals` JSON vs. actuals) |
| `campaign-entity.types.ts` | — | Shared entity-type/slug types |

DTOs: `libraries/nestjs-libraries/src/dtos/campaigns/` (`create-campaign.dto.ts`,
`update-campaign.dto.ts`, `campaign-goals.dto.ts`, `campaign-item.dto.ts`,
`copy-campaign.dto.ts`, `promote-drafts.dto.ts`, `create/update-campaign-note.dto.ts`,
`note-pin.dto.ts`, `note-resolve.dto.ts`, `note-reaction.dto.ts`). The global validation
pipe rejects undeclared fields — extend the DTO, not the controller body type.

## API surface

`apps/backend/src/api/routes/campaigns.controller.ts` — `@Controller('/campaigns')`.
Every route carries `@CheckPolicies([action, Sections.X])` (billing gate → 402);
mutations additionally carry `@RequirePermission('posts', action)` (RBAC gate → 403).
Campaigns reuse the **`posts` RBAC resource** — there is no separate `campaigns` resource
in the permission catalog.

| Route | Gates | Notes |
|---|---|---|
| `GET /` | Read, `POSTS_PER_MONTH` | Offset paging: `?limit&cursor`, hard cap `CAMPAIGNS_MAX_LIMIT = 100` |
| `GET /for/:entityType/:entityId` | Read, `POSTS_PER_MONTH` | Reverse lookup for per-entity campaign selector; declared **before** `/:id` |
| `GET /:id` · `PUT /:id` · `DELETE /:id` | Read/Update/Delete | `PUT` requires `posts:update`; `DELETE` requires `posts:delete` |
| `POST /` | `posts:create` + Create, **`CAMPAIGNS`** | Only route gated on the `CAMPAIGNS` billing section (plan flag: STARTER has `campaigns: false`) |
| `GET /:id/engagement` · `/:id/dashboard` · `/:id/files` | Read | Dashboard aggregation in `CampaignsService.getDashboard` |
| `GET /:id/analytics` | Read | Composes `CampaignsService.get` (ownership) + `AnalyticsService.getOverview({campaignIds:[id]})`; default window = last 90 days; `validateDateRange`/`validateToGteFrom`/`validateWindowCap` from `analytics/date-range.validation.ts` |
| `GET /:id/report?format=json\|csv\|pdf` | Read | `CampaignReportService.dispatchReport` |
| `POST /:id/copy` | `posts:create` | Copies meta + `utmEnabled`/`client`/`project`/`tags`/`goals`, not share token |
| `GET /:id/drafts` · `POST /:id/drafts` | Read / `posts:create` | Drafts are `Post` rows with `type: 'draft'` + `campaignId`; create goes through `PostsService.validateAndCreatePost(..., 'WEB')` |
| `POST /:id/drafts/:postId/approve` · `/reject` · `POST /:id/promote` | `posts:update` | Approval workflow on `PostsService`; controller asserts `post.campaignId === id` (403 otherwise) |
| `POST /:id/share` · `DELETE /:id/share` | `posts:update` | Mint/revoke `shareToken` |
| `GET /:id/items` · `POST /:id/items` · `DELETE /:id/items/:entityType/:entityId` | Read / `posts:update` | Tagging |
| `GET /:id/notes` · `POST` · `PUT /:id/notes/:noteId` · `DELETE` · `/pin` · `/resolve` · `/reactions` | Read / `posts:update` | Discussion; edit/delete pass `user.isSuperAdmin` for the author-or-admin check |

Public share report (unauthenticated):
`apps/backend/src/public-api/routes/public.campaign.controller.ts` —
`GET /public/campaign-report/:token`, `@Throttle(30 req/60 s)`, 404 on unknown/disabled
token **before** any analytics work. Frontend consumes it at
`apps/frontend/src/app/share/campaign/[token]/page.tsx`.

## UTM handling

Two unrelated "utm" codepaths — do not conflate:

- **Campaign UTM (this subsystem):** when `Campaign.utmEnabled`, publish-time code appends
  `utm_campaign=<slugified name>&utm_source=<providerIdentifier>&utm_medium=social` to
  links in the post content, skipping URLs that already contain `utm_campaign`. Two
  implementations that must stay in lockstep:
  `libraries/nestjs-libraries/src/inngest/activities/post.activity.ts`
  (`_maybeAppendUtm`, ~line 397) and
  `libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts` (~line 1088).
  `post.activity.ts` reads `CampaignsRepository` directly — a
  `// layering: sanctioned leaf-read` (routing through `CampaignsService` would create a
  DI cycle since it depends on `PostsService`).
- **Signup-attribution UTM (unrelated):** `libraries/helpers/src/utils/utm.saver.tsx`
  persists landing `utm_source`/`ref` to localStorage for trial tracking. Not campaigns.

## Jobs, analytics, agent touchpoints

- **Purge cron:** `apps/backend/src/inngest/functions/campaign-tag-purge.ts`
  (`campaign-tag-purge`, `TZ=UTC 0 3 * * *`) → `CampaignActivity.purgeExpiredItems` →
  `CampaignTagService.purgeExpiredItems`. Window: `CAMPAIGN_PURGE_DAYS` env (default 30).
  Reaps `CampaignItem` rows whose source entity was deleted/expired.
- **Analytics v2:** `apps/backend/src/api/routes/analytics.v2.controller.ts` accepts a
  `?campaigns=` comma-separated uuid list (`parseCampaigns` — invalid uuids → 400) and
  passes `campaignIds` into `AnalyticsService` scopes.
- **Dashboard widget:** `apps/frontend/src/components/dashboard/widgets/campaigns.widget.tsx`
  + `hooks/useDashboardCampaigns.ts` ← `CampaignsService.getSummaries(orgId, 6)`.
- **Agent tools:** `libraries/nestjs-libraries/src/chat/tools/campaign.create.tool.ts`,
  `campaign.update.tool.ts`, `campaign.tag.tool.ts`, `campaign.dashboard.tool.ts` — the
  chat agent's campaign surface; they call the same services, not Prisma directly.

## Frontend surface

- Pages: `apps/frontend/src/app/(app)/(site)/campaigns/page.tsx` (index),
  `.../campaigns/[id]/` (hub), `apps/frontend/src/app/share/campaign/[token]/page.tsx`
  (public report).
- Components: `apps/frontend/src/components/campaigns/` —
  `campaigns.page.tsx`, `index/` (card, filter bar, create/edit + copy modals,
  tags-input), `dashboard/` (`campaign-dashboard.page.tsx` + sections: analytics, posts,
  drafts, files, discussion, comments, channels, templates, KPIs, planning-workspace),
  `report/campaign-report-view.tsx`, `selector/campaign-selector.tsx`,
  `hooks/campaign.hooks.ts` (one SWR hook per endpoint, via `useFetch`),
  `campaign-types.ts`, `metric-labels.ts`.
- Calendar/composer integration: `components/launches/campaign-filter-select.tsx`,
  `calendar.context.tsx`; dashboard widget under `components/dashboard/widgets/`.

## Key rules

- Campaign logic belongs in `libraries/nestjs-libraries/src/database/prisma/campaigns/`;
  the controller composes services (`PostsService`, `AnalyticsService`,
  `CampaignReportService`) and stays thin. Repositories are the only Prisma touchpoints.
- New campaign routes need **both** gates: `@CheckPolicies` (billing; use
  `Sections.CAMPAIGNS` only for plan-flag-gated features, `POSTS_PER_MONTH` for ordinary
  access) and `@RequirePermission('posts', ...)` for mutations.
- Every query path must filter `organizationId` (and `deletedAt: null` where applicable);
  the public share controller must never expose `shareToken`/`shareEnabled` or org
  internals — extend `CampaignReportService.toPublicJson`, not a new serializer.
- `CampaignItem` has no FKs: never join it; resolve through
  `CampaignItemResolverRepository`, skip orphans, let the purge cron reap them.
- Changing the UTM format requires editing both `post.activity.ts` and
  `posts.service.ts` implementations plus their specs.
- Schema changes to campaign models follow the migration workflow in
  `agents/database.md`; new DTO fields must be declared or the global pipe 400s.
