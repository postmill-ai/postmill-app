---
name: dashboard-widget
description: Add a new widget/card/metric tile to the Postmill /dashboard page — backend aggregation endpoint, SWR hook, SectionCard shell, grid composition. Use when adding a dashboard widget, a new /dashboard card or section, or a dashboard metric tile.
---

# Dashboard widget

Procedure for adding a new section to `/dashboard` (`apps/frontend/src/app/(app)/(site)/dashboard/page.tsx` → `DashboardComponent`).

## Read first
- `agents/frontend.md` § Dashboard widget pattern — composition surface, SectionCard contract.
- `agents/ui-standards.md` — tokens, state components (`TabSkeleton`/`EmptyState`/`ErrorState`), RBAC optimistic-render pattern.
- `agents/backend.md` — Controller → Service → Repository layering, only if a new `/dashboard/*` endpoint is needed.

## Procedure

1. **Data source.** Check whether the data already exists behind an endpoint in
   `apps/backend/src/api/routes/dashboard.controller.ts` (`@Controller('/dashboard')`:
   `/summary`, `/schedule`, `/campaigns`, `/media-jobs`, `/usage`, `/attention`, `/brief`).
   If not, add a `@Get('/<name>')` there: keep the controller thin — `UnauthorizedException`
   when `org?.id` is missing, `@RequirePermission('<resource>', 'read')` when RBAC-gated,
   clamp `ParseIntPipe` query params — and put **all aggregation logic in
   `libraries/nestjs-libraries/src/dashboard/dashboard.service.ts`** (`DashboardService`,
   which composes the Prisma repository services and caches via `RedisService` +
   `singleFlight`, TTL 60s). AI-generated content goes in `dashboard-brief.service.ts`.
   (Detail: `agents/backend.md` § layering.)
2. **Frontend hook.** Create `apps/frontend/src/components/dashboard/hooks/use<Name>.ts` —
   one SWR hook per resource, `'use client'`, `useFetch()` from
   `@postmill-ai/helpers/utils/custom.fetch` + `useSWR<Type>('/dashboard/<name>', load)`.
   Follow `useDashboardSummary.ts` exactly: throw `createFetchError(...)` (from
   `../dashboard.utils`) on `!res.ok`, `res.json()` on success,
   `revalidateOnFocus: false, revalidateOnReconnect: false`. Never fetch inside the widget.
3. **Hook spec.** Colocate `use<Name>.spec.ts` copying `useDashboardSummary.spec.ts`:
   `vi.mock` both `swr` and `useFetch`, `renderHook` from `@testing-library/react`;
   assert SWR key/options, loading state, parsed-JSON success, and throw-on-`!ok`.
4. **Widget component.** Create `apps/frontend/src/components/dashboard/widgets/<name>.widget.tsx`
   (+ colocated `.spec.tsx`, like the existing `*.widget.spec.tsx`). Cover loading
   (`TabSkeleton` from `components/analytics/kit/states`, or an `animate-pulse` block)
   and empty (`EmptyState` from the same analytics kit — not `ui/empty-state.tsx`).
5. **Wrap in SectionCard.** In `apps/frontend/src/components/dashboard/dashboard.component.tsx`,
   wrap the widget in `SectionCard` (`./kit/section-card`) with a **stable lowercase `id`**
   (never rename it — it keys `data-section-id` and the user's hide/show prefs),
   `title={t('key', 'Fallback')}`, optional `icon`/`badge`/`viewAllHref`, and
   `permission={['<resource>', 'read']}` matching the backend `@RequirePermission`.
   SectionCard already hides on `useDashboardPrefs().hidden`, hides optimistically on
   unresolved RBAC, and wraps children in `ErrorBoundary` + `ErrorState` — do not re-add those.
6. **Register + compose.** Add `{ id, label, permission? }` to the `DASHBOARD_SECTIONS`
   array in `dashboard.component.tsx` (fed to `DashboardHeader` → `CustomizePopover`; without
   it the widget can't be toggled). Place the card in the grid
   (`grid grid-cols-1 lg:grid-cols-12 gap-[12px]`) inside a
   `lg:col-span-<N> order-<n> lg:order-<m>` wrapper.
7. **UI rules.** Tokens not hex (`bg-newBgColorInner`, `text-newTableText`); all strings via
   `useT()`; logical properties (`ps-`/`pe-`) for RTL. (Detail: `agents/ui-standards.md`.)

## Verify

```bash
vitest run --root apps/frontend                          # hook + widget + dashboard specs
vitest run --root libraries/nestjs-libraries             # dashboard.service.spec.ts (backend change only)
pnpm exec eslint apps/frontend/src/components/dashboard  # root flat config; no per-package lint
```

Manually: load `/dashboard` (port 4200), toggle the widget in the gear (Customize) popover,
and check it hides for a role lacking the gated permission.

## Pitfalls

- **Aggregation in the controller** — the controller only validates and delegates; logic belongs
  in `DashboardService`. Don't "fix" this by inlining queries in the route.
- **Fetching outside `components/dashboard/hooks/`** — every dashboard fetch is a dedicated hook
  there; no ad-hoc `useSWR` inside widgets, no eslint-disabled hooks.
- **Unstable or renamed `SectionCard id`** — breaks `dashboard_prefs` (localStorage
  `dashboard_prefs.hidden`) and the Customize popover silently.
- **Forgetting `DASHBOARD_SECTIONS`** — the widget renders but is invisible to the hide/show UI.
- **Missing hook spec** — every existing hook ships a `.spec.ts`; new hooks without one fail review.
- **Permission mismatch** — frontend `permission={[...]}` must mirror the backend
  `@RequirePermission`; frontend gating is UX only, the `OrgRbacGuard` 403 is the real gate.
