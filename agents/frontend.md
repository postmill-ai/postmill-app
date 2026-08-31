# Frontend architecture & conventions (Next.js App Router)

LLM-facing reference for `apps/frontend`. Tokens, design primitives, buttons/inputs, and modals are owned by
[`agents/ui-standards.md`](./ui-standards.md) — do not duplicate them here; follow that doc for anything visual.
Backend layering: [`agents/backend.md`](./backend.md). Shared libraries: [`agents/libraries.md`](./libraries.md).
Tests: [`agents/testing.md`](./testing.md).

## Stack & layout

- Next.js App Router + React, dev port **4200**, Tailwind 3, Sentry-instrumented.
- Path aliases (`tsconfig.base.json`): `@postmill-ai/frontend/*` → `apps/frontend/src/*`,
  `@postmill-ai/react/*` → `libraries/react-shared-libraries/src/*`,
  `@postmill-ai/helpers/*` → `libraries/helpers/src/*`,
  `@postmill-ai/nestjs-libraries/*` → `libraries/nestjs-libraries/src/*`.

### Route groups under `apps/frontend/src/app/`

| Group | Contents | Boundary files |
|---|---|---|
| `(app)/` | Authenticated shell. `layout.tsx`, `error.tsx`, `not-found.tsx`; nests `(site)/`, `(preview)/`, `api/`, `auth/`, `integrations/`, `oauth/`, `setup/` | yes |
| `(app)/(site)/` | Main product surface: `dashboard/`, `posts/`, `media/`, `analytics/`, `campaigns/`, `comments/`, `replies/`, `settings/`, `billing/`, `agents/`, `files/`, `profile/`, `user/`, `uploads/`, `err/`; own `layout.tsx`, `page.tsx`, `error.tsx`, `not-found.tsx` | yes |
| `(app)/(preview)/` | Public post preview `p/[id]/page.tsx` | — |
| `(provider)/` | Provider embed surface (`provider/…`); own `layout.tsx`, `error.tsx`, `not-found.tsx` | yes |
| `(extension)/` | Browser-extension modal (`layout.tsx`, `modal/`) | no error.tsx |
| `share/` | Public share pages (`analytics/`, `campaign/`; own `layout.tsx`) | — |
| app root | `global-error.tsx` only — there is **no** root `error.tsx`/`not-found.tsx` | partial |

New authenticated pages go under `(app)/(site)/<feature>/page.tsx`.

### Components

- `apps/frontend/src/components/ui/` — generic kit.
- `apps/frontend/src/components/<feature>/` — feature components (`composer/`, `dashboard/`, `settings/`,
  `media-tools/`, `layout/`, `shared/`, `errors/`, …).
- **Check existing components before building a new one**; reuse over new.

## Data fetching — SWR via `useFetch`

`useFetch` comes from `libraries/helpers/src/utils/custom.fetch.tsx`
(alias `@postmill-ai/helpers/utils/custom.fetch`); it returns the fetch function built by
`custom.fetch.func.ts` and provided via `FetchWrapperComponent` (mounted in
`apps/frontend/src/components/layout/layout.context.tsx`, the `(app)` shell).

What the fetch wrapper does automatically:

- Returns a **raw `Response`** — you must call `.json()` (or `.text()`) yourself.
- `credentials: 'include'` when `isSecured` from `useVariables()`; `Accept`/`Content-Type: application/json`
  (Content-Type skipped for `FormData` bodies).
- `showorg` header (impersonation) when configured.
- CSRF: on mutating verbs (`POST`/`PUT`/`PATCH`/`DELETE`) without an explicit `auth` header, reads the
  `csrf_token` cookie and sends `x-csrf-token`.
- `afterRequest` (in `layout.context.tsx`) is the session/billing chokepoint: 401/`logout` header →
  redirect `/auth/logout`; `reload`/`onboarding` headers → redirect/reload; **402 → payment dialog**;
  **406 → finish-trial dialog**. If it returns false the fetch never resolves — don't swallow that.

Standard pattern — one SWR hook per resource, defined per-file (no barrel exports of hooks):

```tsx
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import useSWR from 'swr';

export const useDashboardSummary = () => {
  const fetch = useFetch();
  return useSWR<DashboardSummary>('/dashboard/summary', (url) =>
    fetch(url).then((r) => r.json())
  );
};
```

Rules:

- Never add `// eslint-disable-next-line` to a hook; restructure instead (see `react-hooks/rules-of-hooks`).
- Paged feeds: `useSWRInfinite` from `swr/infinite` — reference implementation:
  `apps/frontend/src/components/media-tools/use-stock-search.ts`.
- Test isolation: wrap renders in
  `<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>` (used across
  `apps/frontend/src/**/*.spec.tsx`).

## Contexts / hooks every agent should know

| Hook | Path | Notes |
|---|---|---|
| `useUser()` | `apps/frontend/src/components/layout/user.context.tsx` | current user (`UserSelfProfile`), org context |
| `useVariables()` | `@postmill-ai/react/helpers/variable.context` | deployment/env flags: `isGeneral`, `billingEnabled`, `isSecured`, `backendUrl`, … |
| `usePermissions()` | `apps/frontend/src/components/layout/use-permissions.tsx` | `{ isResolved, hasPermission(resource, action) }` — RBAC UI gating; details in `ui-standards.md` |
| `useModals()` | `apps/frontend/src/components/layout/new-modal.tsx` | bespoke modal manager — owned by `ui-standards.md` |
| `useHasOpenModals()` | `apps/frontend/src/components/layout/new-modal.tsx:79` | boolean, any modal open |
| `useT()` | `@postmill-ai/react/translation/get.transation.service.client` | i18n; `t('key', 'Fallback')` (note the historical `transation` typo in the path — it is real) |
| `LayoutContext` | `apps/frontend/src/components/layout/layout.context.tsx` | mounts `FetchWrapperComponent` + `afterRequest` logic |

## Error boundaries

- Route groups ship segment `error.tsx` + `not-found.tsx` rendering the shared
  `RouteError` / `RouteNotFound` from `apps/frontend/src/components/errors/`
  (`route-error.tsx`, `route-not-found.tsx`). New route segments in `(app)/(site)` reuse these.
- `/media/*` canvas studios are wrapped at the media-layout level in `StudioErrorBoundary`
  (`apps/frontend/src/components/media-tools/studio-error-boundary.tsx`), mounted in
  `apps/frontend/src/app/(app)/(site)/media/layout.tsx`. Reuse this pattern for new canvas tools —
  no ad-hoc try/catch.

## Dashboard widget pattern

`/dashboard` is the primary composition surface (`apps/frontend/src/app/(app)/(site)/dashboard/page.tsx` →
`apps/frontend/src/components/dashboard/dashboard.component.tsx`, responsive grid).

- Backend aggregation lives in `libraries/nestjs-libraries/src/dashboard/dashboard.service.ts` —
  **not** in the controller (see `agents/backend.md`).
- Consume `/dashboard/*` endpoints via dedicated `use*` hooks in
  `apps/frontend/src/components/dashboard/hooks/` — one SWR hook per widget, each with a colocated `.spec.ts`
  (`useDashboardSummary.ts`, `useAttention.ts`, `useSchedule.ts`, `useAiUsage.ts`, …).
- Widget components live in `apps/frontend/src/components/dashboard/widgets/<name>.widget.tsx` with a
  colocated `.spec.tsx` (`attention.feed.tsx`, `campaigns.widget.tsx`, `daily.brief.tsx`, …).
- Register the widget in the `DASHBOARD_SECTIONS` array in `dashboard.component.tsx` — without it the
  widget does not appear in the Customize (hide/show) popover.
- AI-generated brief content belongs in `dashboard-brief.service.ts`, not `dashboard.service.ts`.
- Wrap every widget in `SectionCard` (`apps/frontend/src/components/dashboard/kit/section-card.tsx`):
  - stable `id` prop (`data-section-id`), `title`, optional `icon`, `badge`, `viewAllHref`;
  - optional `permission?: [resource, action]` — hidden when `usePermissions()` resolves false;
  - visibility toggle via `useDashboardPrefs().hidden` (returns `null` when hidden);
  - internally wraps children in `ErrorBoundary` (`components/analytics/error.boundary`) +
    `ErrorState` (`components/analytics/kit/states`).

## Capability-aware UI (social channels)

Gate composer/UI features per channel on the shared capability matrix, not on ad-hoc provider checks:

- Source of truth: `PROVIDER_CAPABILITIES` / `ProviderCapability` in
  `libraries/providers/kernel/src/domains/social-capabilities.ts`.
- Frontend import: `@postmill-ai/provider-kernel/domains/social-capabilities`
  (e.g. `apps/frontend/src/components/composer/editor.tsx:18`).
- Backend re-export shim: `libraries/nestjs-libraries/src/integrations/social/provider-capabilities.ts`.
- Fields: `analytics`, `comments`, `firstComment`, `poll`, `video`, `carousel`, `altText`, `maxMedia`,
  `linkPreview`, `refreshToken`, `watchlist`, `richText?` (absent ⇒ supported).
- See `agents/providers/social.md` for adding a provider.

## Billing / capability gating UI

- `CheckPayment` (`apps/frontend/src/components/layout/check.payment.tsx`) — polls
  `GET /billing/check/<check>`; used to gate paid features.
- `PreConditionComponent` / `PreConditionComponentModal`
  (`apps/frontend/src/components/layout/pre-condition.component.tsx`) — pre-condition gate wrapper.
- HTTP-level 402/406 handling is automatic in the fetch wrapper's `afterRequest` (see above);
  UI components only need these gates for proactive checks.

## Channel & provider icons

- Social channel icons: `/icons/platforms/<identifier>.png` under `apps/frontend/public/icons/platforms/`
  (convention: `` `/icons/platforms/${identifier}.png` ``; youtube uses `.svg` variants).
- AI/media/storage provider surfaces use the inline-SVG `ProviderIcon` map in
  `apps/frontend/src/components/shared/provider-icon.tsx` — cross-link `ui-standards.md`.

## Composer extension point

- Provider-specific composer components live in
  `apps/frontend/src/components/composer/providers/<id>/<id>.provider.tsx`
  (plus `<id>.preview.tsx` for previews).
- Wrapped by the HOC `high.order.provider.tsx` (react-hook-form `FormProvider`,
  `classValidatorResolver` from `@hookform/resolvers/class-validator`, zustand launch store).
- Registered in the `Providers` array / `ShowAllProviders` in
  `apps/frontend/src/components/composer/providers/show.all.providers.tsx`.
- Full walkthrough: `agents/providers/social.md`.

## Designer: four renderers, one document

`/media/designer` draws every document **four times**:

| Path | Where | Used for |
|---|---|---|
| Konva | `designer/elements.tsx`, `designer/video-canvas-overlay.tsx` | the canvas *and* PNG/JPEG/WebP export |
| node-canvas | `design-render/design-render.service.ts` | PDF and bulk generation |
| a browser script | `design-render/frame-renderer-script.ts` | video frames, in headless Chromium |
| an SVG translator | `designer-doc/svg-export.ts` | SVG export |

The SVG path is a **translation**, not a fourth renderer: anything SVG cannot express is emitted as
an `<image>` the caller rasterises. It still has to agree on geometry, so the same rules apply.

All three must produce the same picture, so **every rule any of them needs goes in a shared pure
module under `designer-doc/`** — `fit-text`, `shape-geometry`, `path-geometry`, `layer-tree`,
`pixel-ops`, `layer-styles`, `pattern-tiles`. Reimplementing one of those rules in one renderer is
how the exports drift.

The frame renderer is injected into a page as text and cannot import, so it takes the shared code as
**source**: `shapeGeometrySource()` stringifies the geometry functions (and everything they close
over) for the script to prepend. A spec evaluates that source and diffs it against the real
functions, which is what stops the third path silently forking.

Layer semantics that are easy to get wrong, and that the renderers must agree on:

- **Groups are flat.** `output.children` stays a flat array; nesting is expressed by `parentId` and
  resolved by `buildLayerTree`. A group renders at the position of its **first** member. Never add a
  nested `children[]` to an element — ~87 call sites iterate the flat array.
- **A clipped adjustment masks by the base layer's ALPHA, not its bounding box.** The canvas caches
  the base layer alone and filters that bitmap, so its transparent gaps keep the backdrop; the server
  mirrors this by rendering the base node alone and feathering the write-back by that mask.
- **An unclipped adjustment includes the artboard background**, because in this document model the
  background sits below every layer. On the client that means passing it to `CanvasElements` as
  `backdrop` (so it joins the fold) rather than rendering it as a sibling.
- **Server readbacks are in DEVICE pixels.** `ctx.scale(ratio, ratio)` is applied once at page setup
  and never undone, so `getImageData` with logical coordinates reads the wrong region.
- **Guides are editor state that lives on the output.** `output.guides` follows the design rather
  than the session, and **no renderer reads it** — a guide in an export is a defect. The grid and
  snap-to-grid are session view prefs on the store, not document content.
- **Video clips are canvas objects too.** The tool palette applies to both document kinds: a clip
  carries the same geometry an element does, and a drag writes back through `clip-geometry.ts` as a
  DELTA — writing absolute values would collapse a keyframed clip's animation onto whichever frame
  was showing. A keyframe sitting under the playhead is edited in place; otherwise the base props
  move. Track types `shape` and `raster` (doc v5) exist so shape and paint tools have somewhere to
  put their output on a timeline.

- **Effects, warp and text metrics are SHARED code, not two implementations.** `designer-doc/`
  carries the painter (`layer-style-render.ts`), the deformation (`warp.ts`), the fitter
  (`fit-text.ts` — which owns `textTransform`, because case changes what a line measures), the
  filter stack (`filter-pixels.ts`), the curved-text arc (`curved-text.ts`) and the SVG path parser
  (`svg-path-parse.ts`); the canvas and `design-render.service` both call them. Adding a lookalike copy on
  one side is how the two renderers drift — that is exactly how seven layer styles ended up drawing
  in PDFs and nowhere else.
- **node-canvas is not a browser canvas.** `ctx.filter = 'blur(…)'` is accepted and ignored, and
  `ctx.scale()` does not condense glyphs — text is rasterised at the font size with only the origin
  moving. Anything that needs either must work in pixel space (`blurCanvas`) or squeeze a rendered
  bitmap. A visual effect that "works locally" and not in an export is almost always this.
- **The CANVAS is authoritative when two renderers disagree.** It is the authoring surface, and
  stored geometry means what it drew — so a fix goes into the other renderer, not into the canvas.
  Two consequences worth stating outright, because both were wrong on the server for a long time:
  **rotation pivots on the element ORIGIN** (Konva rotates about the node origin and no offset is
  ever set, so `x/y/rotation` mean "top-left pivot"), and **each text line is drawn CENTRED in its
  line box** — Konva draws with `textBaseline = 'middle'` half a line-height down (`Text.js`
  `translateY = lineHeightPx / 2`), and `TextPath` defaults to `'middle'` too. Drawing from the top
  of the line box instead puts an export a fraction of a line-height above the canvas.
  node-canvas and Chrome still define `'middle'` slightly differently (em box vs font metrics),
  which leaves a sub-0.2em residual on some faces; there is no metric both expose that would let one
  shared definition close it.
- **Konva measures a Text node once and caches the arrangement.** A redraw does not re-measure, so
  text first laid out before its webfont arrives keeps the fallback's line breaks — and with a fixed
  box height the overflow line is dropped, truncating the string. `canvas.tsx` forces a re-measure
  after `ensureFontsLoaded`; anything that changes the font stylesheet depends on it.
- **The font catalog is written down three times** — `designer/fonts.ts`, the `@import` in
  `app/global.scss`, and `CURATED_FONTS` in `font-loader.service.ts`. A family missing from the
  second renders as Arial; missing from the third exports as sans-serif. `font-catalog.drift.spec.ts`
  fails the build if they disagree.

Acceptance test for any change here: render the same document through **both** paths and diff them —
a document with a blended group, a clipped adjustment and a layer style is the case that catches
divergence.

## Forms

- `react-hook-form` + `FormProvider` is the standard; shared form primitives self-register against the
  form context (see `ui-standards.md`).
- Validation: **class-validator DTOs via `classValidatorResolver` (`@hookform/resolvers/class-validator`)** —
  zod/`zodResolver` is **not** used in the frontend.
- HTML rendering: never use raw `dangerouslySetInnerHTML` with user/LLM content. Sanitize through
  `SafeContent` (`apps/frontend/src/components/shared/safe-content.tsx`) — DOMPurify
  (`isomorphic-dompurify`) with an allowlist of tags/attrs/URI schemes.

## Lint enforcement

Flat `eslint.config.mjs` at the **repo root only** — there is no per-package lint script.

- `react/display-name`: `error` (all forwardRef/memo components need a display name).
- `jsx-a11y` recommended ruleset applied to `apps/frontend/src/**/*.{js,jsx,ts,tsx}`; several rules are
  **warn-not-block** (`no-static-element-interactions`, `click-events-have-key-events`, `media-has-caption`,
  `no-autofocus`, `label-has-associated-control`, `no-noninteractive-element-interactions`,
  `no-noninteractive-tabindex`) — tracked debt, don't add new violations.
- `i18next/no-literal-string` is **opt-in**: `I18N_LINT=1 pnpm exec eslint apps/frontend/src`.
- No lint rule enforces the design system — that is doc + code review only (`ui-standards.md`).

## Checklist

Adding a new page / feature UI:

- [ ] Route placed under `apps/frontend/src/app/(app)/(site)/<feature>/page.tsx` (or the correct group per
      the table above).
- [ ] Segment ships `error.tsx` + `not-found.tsx` rendering `RouteError` / `RouteNotFound` from
      `components/errors/` (new canvas tool: wrap in `StudioErrorBoundary` at its layout).
- [ ] Data via `useFetch()` + `useSWR<Type>` — one hook per resource, colocated, no barrels, no
      eslint-disabled hooks; `.json()` on the raw `Response`.
- [ ] Dashboard widget: dedicated hook in `components/dashboard/hooks/` (+ `.spec`), wrapped in
      `SectionCard` with stable `id`, `permission` prop if RBAC-gated; visibility via `useDashboardPrefs`.
- [ ] Channel-specific UI gated on `PROVIDER_CAPABILITIES` (`@postmill-ai/provider-kernel/domains/social-capabilities`),
      not hardcoded provider lists.
- [ ] RBAC-gated UI via `usePermissions()`; paid-feature gates via `CheckPayment` /
      `PreConditionComponent` where proactive gating is needed.
- [ ] States covered: loading, empty, error (`ErrorState`), permission-hidden.
- [ ] All user-visible strings via `useT()` (`t('key', 'Fallback')`).
- [ ] Any HTML injection goes through `SafeContent` (DOMPurify) — never raw `dangerouslySetInnerHTML`.
- [ ] Primitives (Button/Input/modals/icons/tokens) from `agents/ui-standards.md` — no new one-off
      buttons/inputs/modals.
- [ ] Specs: SWR isolated with `<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>`
      (see `agents/testing.md`).
