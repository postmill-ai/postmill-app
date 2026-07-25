---
name: new-endpoint
description: Add a REST endpoint to the Postmill backend — new API route, controller, or DTO, with correct module registration, auth/billing/RBAC gates, and DTO validation. Use when asked to add a REST endpoint, new API route, new controller, or new backend route.
---

# Add a REST endpoint

One-line purpose: wire a thin NestJS controller route whose logic lives in `libraries/nestjs-libraries`, registered with the right middleware and gates.

## Read first
- `agents/backend.md` — §1 layering, §2 controller recipe, §3 DTO recipe (the rulebook)
- `agents/security.md` — gates, CSRF, global ValidationPipe, safeFetch (before touching auth/secrets/HTTP)
- `agents/frontend.md` — only if a UI consumes the endpoint (SWR via `useFetch`, one hook per resource)
- `agents/testing.md` — Vitest conventions for the co-located spec

## Procedure
1. Create the controller at `apps/backend/src/api/routes/<name>.controller.ts`; put the spec alongside as `<name>.controller.spec.ts` (49+ exist in that directory). Keep handlers thin: extract `@GetOrgFromRequest() org: Organization` / `@GetUserFromRequest() user: User`, call one nestjs-libraries service, return its result. **No business logic in the controller** (detail: `agents/backend.md` §2).
2. Register in `apps/backend/src/api/api.module.ts`:
   - Cookie-authed → add to the `authenticatedController` array (`api.module.ts:102`). Membership auto-applies `AuthMiddleware` + `CsrfMiddleware` (`api.module.ts:213-214`). **Missing this array means NO auth and NO CSRF — a silent security gap.**
   - Public / webhook / OAuth-callback → the module's `controllers` array directly (e.g. `StripeController`, `EmailWebhooksController`).
   - Backend-only service → the module's `providers` array.
3. Choose the gates deliberately (a route may carry both; both guards are global `APP_GUARD`s, order: throttler → billing → RBAC):

   | Gate | Decorator | Guard | HTTP |
   |---|---|---|---|
   | Billing | `@CheckPolicies(...)` (`apps/backend/src/services/auth/permissions/permissions.ability.ts`) | `PoliciesGuard` | **402** |
   | RBAC | `@RequirePermission(resource, action)` (`apps/backend/src/services/auth/rbac/require-permission.decorator.ts`) | `OrgRbacGuard` | **403** |

   `User.isSuperAdmin` bypasses RBAC, **not** billing. Add `@Throttle()` on sensitive routes (global default is `API_LIMIT || 600`/h per IP).
4. Declare the DTO: shared DTOs in `libraries/nestjs-libraries/src/dtos/<domain>/<name>.dto.ts` (31 domain dirs exist); a single-controller DTO may sit atop the controller file (e.g. `CreateBrandDto` in `brands.controller.ts`). Decorate **every** accepted field with `class-validator` (`@IsString()`, `@IsOptional()` + a validator on optional fields) — the global pipe runs `whitelist: true, forbidNonWhitelisted: true` (`apps/backend/src/main.ts:115-116`), so undeclared fields 400.
5. Put the logic in `libraries/nestjs-libraries`: Controller → Service → Repository. Only `*.repository.ts` under `libraries/nestjs-libraries/src/database/prisma/<domain>/` touches Prisma; register repo + service in `database/prisma/database.module.ts`. Cross-domain reads go through the owning domain's **service**, never its repository — do not create new cross-domain leaf-reads (the sanctioned ones are marked `// layering: sanctioned leaf-read` and exist only to avoid Nest DI cycles; detail: `agents/backend.md` §1).
6. Any user-influenced outbound HTTP goes through `safeFetch` (`libraries/nestjs-libraries/src/dtos/webhooks/safe.fetch.ts`) — never bare `fetch(userUrl)` (SSRF: DNS rebinding, redirects; detail: `agents/security.md` § Outbound HTTP).
7. User-facing notifications via `NotificationService.notify` only (never `EmailService` directly); errors via Nest `HttpException`s; `Logger`, not `console.log`; no secrets/PII in logs or Sentry.
8. If a frontend consumes it: fetch via `useFetch` from `@postmill-ai/helpers`, one SWR hook per resource (detail: `agents/frontend.md`).

## Verify
```bash
vitest run --root apps/backend                              # controller spec + package suite
vitest run --root libraries/nestjs-libraries                # if you added/changed a service/repository
pnpm run test                                               # full suite (all workspaces) before shipping
grep -n "<Name>Controller" apps/backend/src/api/api.module.ts   # confirm correct array
```

## Pitfalls
- Registering a cookie-authed controller in the plain `controllers` array instead of `authenticatedController` — it serves with **no auth and no CSRF**, silently.
- Adding an optional body field without declaring it on the DTO — `forbidNonWhitelisted` makes every request carrying it 400.
- Importing `PrismaService` / `@prisma/client` in a service or controller — only repositories touch Prisma.
- Reaching into another domain's repository for a "quick read" — new cross-domain reads go through the owning service; sanctioned leaf-reads are pre-approved only, don't extend the pattern.
- Changing an existing route's response shape — the system is in production; prefer additive, backward-compatible changes (new fields, new routes).
- Treating `isSuperAdmin` as a billing bypass — it skips RBAC (403) only; `@CheckPolicies` (402) still applies.
