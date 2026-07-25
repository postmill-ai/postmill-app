---
name: new-ui
description: Build a new UI page, component, settings tab, form, or feature interface in the Postmill Next.js frontend. Use when asked to create or modify any frontend UI, page, form, modal, settings surface, or dashboard widget in apps/frontend.
---

# New UI (Postmill frontend)

Build UI in `apps/frontend` (Next.js App Router, Tailwind 3, class-based dark/light) using the bespoke design system only.

Match the surrounding component's style — token usage, spacing scale, comment density — and check `apps/frontend/src/app/global.scss` plus neighboring components before writing new UI.

## Read first
- `agents/ui-standards.md` — the rulebook: tokens, primitives, modals, feedback, icons, RBAC rendering.
- `agents/frontend.md` — route-group layout, `useFetch` + SWR data fetching, contexts/hooks, error boundaries.

## Procedure
1. Place the route under `apps/frontend/src/app/(app)/(site)/<feature>/page.tsx` for authenticated product UI. Ship sibling `error.tsx` + `not-found.tsx` that render `RouteError` / `RouteNotFound` from `apps/frontend/src/components/errors/` (detail: `agents/frontend.md` § Error boundaries).
2. Before writing a component, check `apps/frontend/src/components/ui/` and `components/<feature>/` for an existing one — reuse over new. New generic kit goes in `components/ui/`, feature components in `components/<feature>/`.
3. Colors via Tailwind theme names only: `bg-newBgColorInner`, `border-newTableBorder`, `text-textColor`, `text-newTableText` (muted), `bg-btnPrimary`, `text-dangerText`. These map in `apps/frontend/tailwind.config.cjs` to CSS vars in `apps/frontend/src/app/colors.scss` (declared under both `:root .dark` and `:root .light`). Never raw hex, never deprecated `--color-custom*`, never legacy aliases (`primary`…`seventh`, `input`). Standard card:
   ```
   bg-newBgColorInner border border-newTableBorder rounded-[12px]
   ```
   New token = both `.dark` and `.light` values in `colors.scss` + mapping in `tailwind.config.cjs` (detail: `agents/ui-standards.md` § Design tokens).
4. Forms: `react-hook-form` + `<FormProvider {...form}>` — the shared primitives self-register via `useFormContext()`: `Button` (`@postmill-ai/react/form/button`; `secondary`, `danger`, `loading` props), `Input` (form/input; `label`+`name` required), `Select` (form/select), `CustomSelect` (form/custom.select — requires FormProvider), `Checkbox`, `Textarea`, `Slider` (boolean `'on'|'off'`, not RHF-bound), `ColorPicker` (all under `libraries/react-shared-libraries/src/form/`). Standalone use: `disableForm` (except `CustomSelect`). Mantine v5 only for `Autocomplete`, `@mantine/dates`, `@mantine/hooks` — no other UI kit. Validation via `classValidatorResolver` (`@hookform/resolvers/class-validator`), never zod.
5. Modals: `useModals().openModal({ title, size, children: (close) => ... })` from `apps/frontend/src/components/layout/new-modal.tsx` — never `@mantine/modals` (vestigial dep, zero imports). `children` accepts ReactNode or a render-prop receiving `close`; other params: `maxSize`, `fullScreen`, `center`, `askClose`, `withCloseButton`, `id`. Modals stack (z-index 200+index). Destructive confirms: `const decision = useDecisionModal(); await decision.open({...})` (resolves boolean), or `areYouSure()` outside React (detail: `agents/ui-standards.md` § Modals).
6. Feedback: `useToaster().show(text, 'success' | 'warning')` from `@postmill-ai/react/toaster/toaster`. Tooltips: `data-tooltip-id="tooltip"` + `data-tooltip-content="..."` on the element — do not mount new `Tooltip` instances (one global `react-tooltip` in `components/layout/top.tip.tsx`).
7. Data: `useFetch` from `@postmill-ai/helpers/utils/custom.fetch` + `useSWR` — ONE hook per resource, colocated per-file (no barrels). The wrapper returns a raw `Response`; call `.json()` yourself. It auto-handles credentials, CSRF header on mutating verbs, and 401/402/406 redirects in `afterRequest`. Paged feeds: `useSWRInfinite` (reference: `components/media-tools/use-stock-search.ts`). Never eslint-disable a hook (detail: `agents/frontend.md` § Data fetching).
8. States: loading skeleton via `LoadingRows` (`components/ui/loading-rows.tsx`), empty via `EmptyState` (`components/ui/empty-state.tsx`; `icon?`, `title`, `description?`, `action?`), recoverable error via `ErrorState` with `onRetry`. Tables: `DataTable<T>` (`components/ui/data-table.tsx`) takes `columns`, `data`, `keyExtractor` and handles loading/error/empty itself; page top via `PageHeader` (`components/ui/page-header.tsx`). Canvas tools (`/media/*`): wrap in `StudioErrorBoundary` (`components/media-tools/studio-error-boundary.tsx`).
9. Strings via `useT()` from `@postmill-ai/react/translation/get.transation.service.client` (the `transation` typo in the path is real): `t('snake_case_key', 'English fallback')`. Dates via dayjs + `UtcToLocalDateRender` (`@postmill-ai/react/helpers/utc.date.render`) — never moment, never raw `Date` math.
10. Icons from `apps/frontend/src/components/ui/icons/index.tsx` (`FC<IconProps>`, `stroke="currentColor"`) — reuse first, add new ones there; no icon npm package. Channel logos: `/icons/platforms/<identifier>.png`; provider icons: `ProviderIcon` from `components/shared/provider-icon.tsx`.
11. RTL-safe: logical utilities `ps-`/`pe-`/`ms-`/`me-`/`start-`/`end-`/`text-start`, not physical `pl`/`pr`/`left`/`right`.
12. RBAC-gated UI: `usePermissions()` (`components/layout/use-permissions.tsx`) — render optimistically, hide once resolved: `permissions.isResolved && !permissions.hasPermission(resource, action)`. UX only; the backend `OrgRbacGuard` is the real gate. Any HTML injection goes through `SafeContent` (`components/shared/safe-content.tsx`), never raw `dangerouslySetInnerHTML`.
13. Dashboard widgets: dedicated SWR hook in `components/dashboard/hooks/` (+ colocated `.spec.ts`), wrapped in `SectionCard` (`components/dashboard/kit/section-card.tsx`) with stable `id`, `title`, optional `permission` prop (detail: `agents/frontend.md` § Dashboard widget pattern).
14. Channel-gated features: check `PROVIDER_CAPABILITIES` from `@postmill-ai/provider-kernel/domains/social-capabilities`, never hardcoded provider lists. Responsive: custom screens in `tailwind.config.cjs` — `mobile` ≤1025px (phone), `tablet` ≤1300px, `xs` ≤401px.

## Verify
- Lint from the repo root (flat `eslint.config.mjs`; there is no per-package lint script): `pnpm exec eslint apps/frontend/src/<path-you-touched>`
- Optional literal-string audit: `I18N_LINT=1 pnpm exec eslint apps/frontend/src`
- Frontend tests: `vitest run --root apps/frontend` (isolate SWR in specs with `<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>`).
- Run the app (`pnpm run dev:frontend`, port 4200) and check the page in BOTH dark and light mode, plus a narrow (`mobile` ≤1025px) viewport.
- Match against the checklist in `agents/ui-standards.md` § Checklist and `agents/frontend.md` § Checklist before shipping.

## Pitfalls
- Raw `<button>`/`<input>` where a primitive fits — use `Button`/`Input`/…; `Button` already has `loading` and defaults `type="button"`.
- Hex colors (`bg-[#2B5CD3]`) or `--color-custom*` vars — use tokens; legacy code contains hex, do not copy it. `textColor`/`newTableText`/`dangerText` are theme-adjusted — don't override with fixed colors.
- Missing `<FormProvider>` — shared form primitives (and `CustomSelect` unconditionally) read the form context and crash without it.
- Adding an icon npm package or a new UI kit (shadcn/MUI/Chakra) — both are forbidden; extend `components/ui/icons/index.tsx` and use sanctioned Mantine only.
- Name collisions: `components/ui/color-picker.tsx` (post-color swatches) and `components/ui/slider.component.tsx` (carousel) are NOT the form `ColorPicker`/`Slider`.
- Skipping empty/loading/error states, or shipping a route segment without `error.tsx`/`not-found.tsx`.
- `useT` import path — the typo `get.transation.service.client` is real; importing the "corrected" spelling fails.
