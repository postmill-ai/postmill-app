# Backend conventions & how-to recipes (NestJS)

The rulebook for any server-side change. Audience: AI coding agents. Every path/symbol below
was verified against the code.

Scope: `apps/backend` (NestJS REST API) + `libraries/nestjs-libraries` (all real logic).
Siblings: `agents/libraries.md`, `agents/database.md`, `agents/security.md`, `agents/jobs.md`,
`agents/notifications.md`, `agents/testing.md`, `agents/providers/overview.md`.

---

## 1. Layering — the iron rule

```
Controller → Service → Repository
Controller → Manager → Service → Repository   (when a manager is involved)
```

- **Only repositories touch Prisma.** A repository is `*.repository.ts` under
  `libraries/nestjs-libraries/src/database/prisma/<domain>/`. Controllers and services must
  never import `PrismaService` or `@prisma/client` for queries.
- A repository and its companion service live in the **same domain directory** and both are
  registered in `libraries/nestjs-libraries/src/database/prisma/database.module.ts`. Filenames key
  on the **model**, not the directory — e.g. `organizations/organization.repository.ts` +
  `organization.service.ts`, but `users/users.repository.ts` + `users.service.ts`; match the
  neighbours in the domain you touch.
- **`apps/backend` stays thin**: controllers (`src/api/routes/*.controller.ts`) + module wiring
  (`src/api/api.module.ts`) + backend-only services (`src/services/**`). All business logic
  lives in `libraries/nestjs-libraries`.
- **Cross-domain access goes through the other domain's service, never its repository.**
  Reaching into another domain's repository is forbidden except the sanctioned cases below.

### Sanctioned exceptions (do not "fix" these)

**(a) Seeders / migration steps** under `libraries/nestjs-libraries/src/database/seeds/**`
(`BackfillService`, `RbacSeeder`) intentionally use `PrismaService` + `$transaction` directly
for cross-table backfills/seeds. Exempt by design.

**(b) Cross-domain leaf-reads** marked `// layering: sanctioned leaf-read`. Each exists because
routing up through the owning service would close a Nest DI cycle. **Keep them; never refactor
them into service calls.** New cross-domain reads go through the owning service.

Verified sites (grep `layering: sanctioned leaf-read`):

| Caller (file) | Repository read | Why (owning service back-edge) |
|---|---|---|
| `PostsService` — `database/prisma/posts/posts.service.ts` | `AnalyticsRepository`, `CampaignsRepository` | `AnalyticsService` / `CampaignsService` → `PostsService` |
| `PostActivity` — `inngest/activities/post.activity.ts` | `CampaignsRepository` (UTM flag), `PostsRepository` (atomic publish claim) | `CampaignsService` → `PostsService` |
| `WebhooksService` — `database/prisma/webhooks/webhooks.service.ts` | `IntegrationRepository` (id-only ownership check) | id-only read, no token decrypt |
| `PermissionsService` — `apps/backend/src/services/auth/permissions/permissions.service.ts` | `AiSettingsRepository` (F4 video-export in-flight `AIMediaJob` count) | repo has no service back-edge; a service hop adds nothing |
| `StorageService` — `database/prisma/storage/storage.service.ts` | `SubscriptionRepository` | cycle: `IntegrationService → StorageService → SubscriptionService → IntegrationService` |
| `NotificationService` — `database/prisma/notifications/notification.service.ts` | `OrganizationRepository` (`getTeam`) | `OrganizationService` → `NotificationService` |
| `OrgMediaProviderSettingsService` — `database/prisma/media-providers/org-media-provider-settings.service.ts` | `@Optional() OrgAiSettingsRepository` | `OrgAiSettingsService` imports `ProviderCredentialLinkService` from media-providers |
| `MediaService` (AI governance) — `ai/governance/media.service.ts` | `@Optional() OrgAiSettingsRepository` (universal-credential fallback) | same DI-cycle rationale as above |
| `OrgVpnConfigService` — `vpn/org-vpn-config.service.ts` | `OrgProviderConfigRepository` (clear orphaned channel `vpnSelection` rows) | `OrgProviderConfigService` → `OrgVpnConfigService` |
| `StripeService` — `services/stripe.service.ts` | `StripeEventRepository` (webhook idempotency/grace reads) | narrow leaf reads, no cycle |

---

## 2. Recipe: add a controller / route

1. Create `apps/backend/src/api/routes/<name>.controller.ts`; put the spec alongside
   (`<name>.controller.spec.ts` — the directory already has 49 `*.spec.ts` files; see
   `agents/testing.md`).
2. Register in `apps/backend/src/api/api.module.ts`:
   - **Cookie-authed controller** → add to the `authenticatedController` array
     (`api.module.ts:102`). Membership auto-applies `AuthMiddleware` **and** `CsrfMiddleware`
     (`ApiModule.configure`, `api.module.ts:211-214`).
   - **Public / webhook / OAuth-callback controller** → add to the module's `controllers`
     array directly (e.g. `StripeController`, `EmailWebhooksController`).
   - **Backend-only services** → the module's `providers` array.
3. Choose the gates (a route may carry both):

   | Gate | Decorator | Guard | HTTP | Question |
   |---|---|---|---|---|
   | Billing | `@CheckPolicies(...)` (`apps/backend/src/services/auth/permissions/permissions.ability.ts`) | `PoliciesGuard` | **402** `SubscriptionException` | Has this org paid? |
   | RBAC | `@RequirePermission(resource, action)` (`apps/backend/src/services/auth/rbac/require-permission.decorator.ts`) | `OrgRbacGuard` | **403** `ForbiddenException` | Is this member allowed? |

   `User.isSuperAdmin` bypasses RBAC, **not** billing.
4. Keep the handler a thin delegation: extract `@GetOrgFromRequest() org: Organization` /
   `@GetUserFromRequest() user: User`, call one nestjs-libraries service, return its result.
   **No business logic in the controller.**
5. CSRF: required on cookie-authenticated mutating routes — automatic via `CsrfMiddleware`
   for anything in `authenticatedController`. Header/API-key clients are unaffected.
6. DTO discipline: the global `ValidationPipe` runs with `whitelist: true,
   forbidNonWhitelisted: true` (`main.ts:112-118`). **Every new optional field must be
   declared on the DTO or the request 400s.**

Minimal skeleton (mirrors `brands.controller.ts`):

```ts
@Controller('/api/brands')
export class BrandsController {
  constructor(private _brandsService: BrandsService) {}

  @Post('/')
  @CheckPolicies(AuthorizationActions.Create, Sections.BRANDS)
  @RequirePermission('brands', 'create')
  create(@GetOrgFromRequest() org: Organization, @Body() body: CreateBrandDto) {
    return this._brandsService.create(org.id, body);
  }
}
```

---

## 3. Recipe: add a DTO

1. File in `libraries/nestjs-libraries/src/dtos/<domain>/<name>.dto.ts` (31 domain dirs exist:
   `posts`, `webhooks`, `integrations`, `ai-settings`, …). Note: a few small controllers keep
   their DTO class inline at the top of the controller file (e.g. `CreateBrandDto` in
   `brands.controller.ts`) — acceptable for single-controller DTOs; shared DTOs go in `dtos/`.
2. Decorate every field with `class-validator` (`@IsString()`, `@IsOptional()`, …).
   `@IsOptional()` + a decorator on optional fields — undeclared fields are rejected by the
   global pipe (see §2.6).
3. Body-validate in the handler with `@Body() body: <Name>Dto`.

---

## 4. Recipe: add a repository / domain

1. Create directory `libraries/nestjs-libraries/src/database/prisma/<domain>/`.
2. Add the repository (filename keyed on the model — `organization.repository.ts` in
   `organizations/`, `users.repository.ts` in `users/`) extending the base classes from
   `libraries/nestjs-libraries/src/database/prisma/prisma.service.ts`:

   | Export | Shape | Use |
   |---|---|---|
   | `PrismaService` | `PrismaClient` subclass | only inside repositories / sanctioned seeders |
   | `PrismaRepository<T extends keyof PrismaService>` | `this.model = Pick<PrismaService, T>` | standard repository base |
   | `PrismaTransaction` | `this.model = Pick<PrismaService, '$transaction'>` | injectable `$transaction` handle |

   ```ts
   @Injectable()
   export class WidgetsRepository extends PrismaRepository<'widget'> {
     findByOrg(orgId: string) { return this.model.widget.findMany({ where: { organizationId: orgId } }); }
   }
   ```
3. Add `<domain>.service.ts` beside it; the service injects the repository, never Prisma.
4. Register **both** in `libraries/nestjs-libraries/src/database/prisma/database.module.ts`
   (providers + exports).
5. Schema changes (new model/column) → follow `agents/database.md`: committed migration via
   `pnpm run prisma-migrate-dev`, apply via `prisma migrate deploy`. **Never `db push` on a
   shared/production DB.**

---

## 5. Recipe: add an Inngest function (brief — full detail in `agents/jobs.md`)

1. **Activity** — domain logic in a new or extended `*.activity.ts` in
   `libraries/nestjs-libraries/src/inngest/activities/` (e.g. `post.activity.ts`,
   `analytics.activity.ts`).
2. **Function factory** — `createX(activity)` in
   `apps/backend/src/inngest/functions/<name>.ts`:
   `inngest.createFunction({ id, concurrency }, { cron | event }, handler)`; crons use
   `TZ=...` strings (`{ cron: 'TZ=UTC 0 2 * * *' }`); fan-out crons `step.sendEvent` one
   event per org (see `analytics-collection.ts`).
3. Register the activity in `libraries/nestjs-libraries/src/inngest/inngest.module.ts`
   (providers **and** exports).
4. Thread it through the `InngestActivities` interface **and** `createFunctions` in
   `apps/backend/src/inngest/functions/index.ts`.
5. New injected services (not activities) go in the `InngestService` constructor
   (`libraries/nestjs-libraries/src/inngest/inngest.service.ts`) — functions are built in the
   constructor, so constructor injection is the only path.

Invariants:

- **Idempotency ids must be event-unique.** A constant id dedupes every later emit into the
  first and black-holes reschedules. Pattern: `` `${kind}:${orgId}:${entityId}:${date}` ``
  (see `analytics-collection.ts:74`). Fan-out crons that must re-run each sweep emit **no**
  event id.
- Events only fire when `USE_INNGEST=true` (checked in
  `libraries/nestjs-libraries/src/inngest/inngest.client.ts:12`); otherwise scheduling is a
  logged no-op (`posts.service.ts:944`).
- The handler is served by `InngestController` at `/api/inngest`
  (`apps/backend/src/api/controllers/inngest.controller.ts`).

---

## 6. Error handling

- Throw Nest `HttpException`s (`BadRequestException`, …) or the domain exceptions below.
- **Global filter chain** — registered in `apps/backend/src/main.ts:162-164` in this order:
  1. `SubscriptionExceptionFilter` (`apps/backend/src/services/auth/permissions/subscription.exception.ts`)
     — `SubscriptionException` → **402** envelope `{ statusCode, error: 'Payment Required', message, url }`.
  2. `PostValidationExceptionFilter` (`apps/backend/src/api/routes/posts.validation.exception.ts`)
     — `PostValidationException` (per-provider post-validation failures).
  3. `HttpExceptionFilter` (`libraries/nestjs-libraries/src/services/exception.filter.ts`) —
     catches **`HttpForbiddenException`** only.
- Additional `APP_FILTER` providers in `app.module.ts`: Sentry `FILTER`,
  `PROVIDER_NOT_CONFIGURED_FILTER`, `SHORT_LINK_PROVIDER_FILTER`, `ProviderExceptionFilter`.
- **Naming trap:** `HttpForbiddenException` returns **401 Unauthorized**, not 403. It is the
  auth middleware's *unauthenticated* rejection (missing/invalid/expired token; 6 call sites in
  `auth.middleware.ts` + `public.auth.middleware.ts`) and clears the auth cookie via
  `removeAuth()`. The frontend keys on 401 to redirect to login. Do not "fix" the name or flip
  the status.
- Use Nest `Logger` (`new Logger(ClassName.name)`), never `console.log`.
- **No secrets/PII in logs or Sentry.** The Sentry scrubber
  (`libraries/nestjs-libraries/src/sentry/initialize.sentry.ts`) is the backstop, not
  permission — don't capture at source. See `agents/security.md`.

---

## 7. Cross-cutting rules (detail in `agents/security.md` / `agents/notifications.md`)

| Rule | Mechanism | Path |
|---|---|---|
| All user-influenced outbound HTTP | `safeFetch` (`isSafePublicHttpsUrl` + `ssrfSafeDispatcher` + per-hop redirect re-validation); never bare `fetch(userUrl)` | `libraries/nestjs-libraries/src/dtos/webhooks/safe.fetch.ts` |
| Secrets at rest | AES-GCM, `v2:` prefix. Per-org rows → `EncryptionService`; global rows → `AuthService.fixedEncryption`. Same key behind two routes — never cross routes for one row | `libraries/nestjs-libraries/src/encryption/encryption.service.ts`, `libraries/helpers/src/auth/auth.service.ts:100` |
| User-facing notifications | **Only** `NotificationService.notify` — never `EmailService` directly from feature code | `libraries/nestjs-libraries/src/database/prisma/notifications/notification.service.ts`; `agents/notifications.md` |
| Redis | Never blocking commands (BRPOP/BLPOP/BRPOPLPUSH) on the shared `ioRedis` client — they stall the per-request throttler. Use `ioRedis.duplicate()` | `libraries/nestjs-libraries/src/redis/redis.service.ts` |
| Throttling | On by default: `ThrottlerBehindProxyGuard`, 600/h (`API_LIMIT` env) **per (controller, handler, org)** — per client IP only for unauthenticated routes, not one global budget. Sensitive routes add `@Throttle({ default: { limit, ttl } })` (login 10/min, register 5/min); polled job-status endpoints raise the hourly cap | `app.module.ts:58-73`; examples in `auth.controller.ts`, `heygen.controller.ts` |

---

## 8. Module wiring map

**`apps/backend/src/app.module.ts`** — `@Global()`, imports: `FeatureFlagsModule`,
`SentryModule.forRoot()`, `ScheduleModule.forRoot()` (only when `DEV_DISABLE_CRON` is unset —
`FeatureFlagsService.isEnabled('cron')`), `DatabaseModule`, `ApiModule`, `PublicApiModule`,
`AgentModule`, `ChatModule`, `InngestModule`, `AiModule`, `VpnModule`, `ProvidersModule`,
`CollaborationModule`, `ThrottlerModule.forRoot(...)` (Redis-backed). Applies
`RequestIdMiddleware` to all routes.

**Global guard order** (`APP_GUARD` registration order): `ThrottlerBehindProxyGuard` →
`PoliciesGuard` (billing, 402) → `OrgRbacGuard` (RBAC, 403).

**`apps/backend/src/main.ts` boot order:**

1. `./register-provider-paths` — runtime resolver for bare `@postmill-ai/provider-*` imports
   (must be first import).
2. `initializeOtel()` — before Sentry/Nest so auto-instrumentations patch modules on load.
3. `initializeSentry('backend', true)`.
4. `NestFactory.create(AppModule, { rawBody: true, cors: ... })`; `enableShutdownHooks()`;
   Socket.IO `IoAdapter`.
5. `startMcp(app)`.
6. Global `ValidationPipe` (`transform`, `whitelist`, `forbidNonWhitelisted`).
7. 50mb JSON limit on `/copilot/{*splat}` and `/posts`; `cookieParser()`; `compression()`.
8. `helmet(...)` — skipped under `NOT_SECURED` (+ dev); CSP/HSTS/frameguard/noSniff otherwise.
9. Global filters (see §6).
10. `ConfigurationChecker` fail-fast — fatal-missing secrets exit non-zero before `listen` in
    production or with `CONFIG_CHECK_STRICT` (`NOT_SECURED` bypasses).

---

## 9. Provider registration (detail in `agents/providers/overview.md`)

Adding a provider package requires exactly three touch points:

1. Workspace dependency in `apps/backend/package.json`.
2. Two path aliases (`@postmill-ai/provider-<id>` and `@postmill-ai/provider-<id>/*`) in
   `tsconfig.base.json`.
3. Import + spread in `apps/backend/src/providers.generated.ts` — **hand-maintained,
   alphabetical; no generator exists** despite the filename.

Boot auto-registers every module in `providerModules` via
`apps/backend/src/providers.bootstrap.ts` (`ProvidersBootstrap.onModuleInit` →
`ProviderKernel.register`), gated per domain by `DEV_DISABLE_AI` / `DEV_DISABLE_MEDIA` /
`DEV_DISABLE_SHORTLINKS` / `DEV_DISABLE_EMAIL` (the `empty` email provider always registers).
Malformed manifests / duplicate registrations (`ProviderManifestError`) are **fatal at boot**.

---

## 10. Scheduled work

- **Inngest cron functions are the real path** (see §5 and `agents/jobs.md`).
- `@nestjs/schedule` (`ScheduleModule.forRoot()`) exists but is the exception — the known case
  is `SessionCleanupService` (`apps/backend/src/services/session-cleanup.service.ts`,
  `@Cron('0 3 * * *')`). Prefer Inngest for anything new.

---

## 11. Decorators / helpers

| Symbol | Import path | Purpose |
|---|---|---|
| `@GetOrgFromRequest()` | `@postmill-ai/nestjs-libraries/user/org.from.request` | param decorator → `Organization` |
| `@GetUserFromRequest()` | `@postmill-ai/nestjs-libraries/user/user.from.request` | param decorator → `User` |
| `ParseCuidPipe` | `libraries/nestjs-libraries/src/pipes/parse-cuid.pipe.ts` | validate cuid route params (`@Param('id', ParseCuidPipe)`) |
| `TrackService` | `@postmill-ai/nestjs-libraries/track/track.service` | product analytics (`track(...)` with `TrackEnum` from `user/track.enum`) |
| `@CheckPolicies(...)` | `@postmill-ai/backend/services/auth/permissions/permissions.ability` | billing gate (§2) |
| `@RequirePermission(resource, action)` | `@postmill-ai/backend/services/auth/rbac/require-permission.decorator` | RBAC gate (§2) |

Managers live in `apps/backend/src/services/**` when backend-only (`AuthProviderManager`,
`ProvidersManager`) or in nestjs-libraries (`IntegrationManager`,
`integrations/integration.manager.ts`).

---

## Checklist — new backend feature

- [ ] DTO declared in `libraries/nestjs-libraries/src/dtos/<domain>/` (or inline for a
      single-controller DTO); every field decorated; optional fields `@IsOptional()`
      (global pipe 400s on undeclared fields).
- [ ] Layering respected: controller → service → repository; no Prisma outside repositories;
      cross-domain reads through the owning service (no new leaf-reads without the DI-cycle
      justification + `// layering: sanctioned leaf-read` comment).
- [ ] Controller registered in the right `api.module.ts` array (`authenticatedController` for
      cookie-auth — gets Auth+CSRF middleware; plain `controllers` for public/webhook).
- [ ] Gates chosen deliberately: `@CheckPolicies` (402 billing), `@RequirePermission` (403
      RBAC), both, or neither; `@Throttle()` on sensitive routes.
- [ ] All business logic in `libraries/nestjs-libraries`; controller is a thin delegation.
- [ ] Repository + service registered in `database.module.ts`; repository extends
      `PrismaRepository<T>`.
- [ ] Outbound HTTP influenced by users goes through `safeFetch`.
- [ ] Notifications via `NotificationService.notify` only; no direct `EmailService`.
- [ ] Errors via Nest `HttpException`s / domain exceptions; `Logger`, not `console.log`; no
      secrets/PII in logs or Sentry.
- [ ] Spec alongside (`<name>.controller.spec.ts` / `*.spec.ts` next to the unit) — see
      `agents/testing.md`.
