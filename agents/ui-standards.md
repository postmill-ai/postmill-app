# UI standards: tokens, primitives, and component rules

The rulebook for writing any frontend UI in `apps/frontend` (Next.js App Router, Tailwind 3, class-based dark mode). Read before creating or modifying any component. Data-fetching rules live in `agents/frontend.md`; this file covers visual/style/component conventions only.

## Design tokens

Source of truth is `apps/frontend/src/app/colors.scss` — CSS custom properties declared twice, under `:root .dark` and `:root .light` — mapped to Tailwind color names in `apps/frontend/tailwind.config.cjs` (`darkMode: 'class'`; the `dark`/`light` class on a root element selects the values). Use the **Tailwind name**, never the CSS var and never raw hex.

| Group | Tailwind names (→ CSS var) | Notes |
|---|---|---|
| Surfaces | `newBgColor` (--new-bgColor, page bg), `newBgColorInner` (card bg), `third` (alias of newBgColorInner), `newBackdrop` (--new-back-drop), `boxHover` (--new-box-hover), `newSettings` (--new-settings) | `primary`/`secondary` are legacy aliases of newBgColor/newBgColorInner |
| Borders / lines | `newBorder` (--new-border), `newSep` (--new-sep), `newBgLineColor`, `newTableBorder`, `tableBorder` (same var), `blockSeparator` | `newTableBorder` is the default card/table border |
| Text | `textColor` (--new-btn-text, primary text), `newTextColor` (RGB triplet — alpha-aware: `text-newTextColor/70`), `textItemFocused`, `textItemBlur`, `inputText`, `newTableText` (secondary), `newTableTextFocused`, `gray` | `newTableText` = muted/secondary text on cards |
| Brand / action | `btnPrimary` (#2b5cd3), `btnPrimaryAccent` (theme-adjusted variant of btnPrimary for text on tinted chips — use it instead of `text-btnPrimary` on `bg-btnPrimary/15` surfaces for AA), `btnSimple`, `btnText`, `dangerText` (theme-adjusted error text), `ai`, `promo`, `badge` | `dangerText` flips light-red/deep-red per theme; do not use raw `text-red-*` for themed danger copy |
| Semantic metrics | `positive` / `negative` (theme-adjusted green/red for up/down metrics, AA-tuned per theme) | Chart/delta colors; also redeclared unthemed at `:root` — the themed `.dark`/`.light` values win |
| Priority | `priorityHigh`, `priorityMedium`, `priorityLow` | |
| Charts | `--chart-1` … `--chart-8`, `--chart-muted` | **Theme-independent**: declared once at bare `:root` in colors.scss, not inside `.dark`/`.light`; no Tailwind names — use `bg-[var(--chart-1)]` etc. |
| Studio / designer | `studioBg`, `studioBorder` (CSS-var backed, themed); `designerAccent` (#2B5CD3), `designerSurface`, `designerCanvas`, `designerGuide` (raw hex in tailwind.config.cjs, theme-independent) | Only for `/media/*` studios and the Designer canvas |

Rules:

- **Never raw hex in new UI.** `bg-btnPrimary`, not `bg-[#2B5CD3]`. (Legacy code contains hex — do not copy it.)
- **Avoid legacy aliases** `primary`, `secondary`, `third`, `forth`, `fifth`, `sixth`, `seventh`, `input` for new work; use the `new*`/`btn*` names they alias.
- **`--color-custom*` vars are deprecated/removed — never use.**
- **Every new token gets both a `.dark` and a `.light` value** in `colors.scss`, plus the mapping in `tailwind.config.cjs`.
- **Standard card recipe** (used by `EmptyState`, `DataTable`, `SectionCard`):
  ```
  bg-newBgColorInner border border-newTableBorder rounded-[12px]
  ```

## Tailwind extensions (tailwind.config.cjs)

- **Custom screens** (all raw media queries): `mobile` ≤1025px (the app-wide phone breakpoint), `tablet` ≤1300px, `maxMedia` ≤1400px, `iconBreak` ≤1560px, `xs` ≤401px, `minCustom` min-height 800px, `custom` max-height 800px. DataTable reflows to stacked cards at `mobile`.
- **Shadows**: `shadow-menu` (themed), `shadow-previewShadow` (themed), `shadow-yellowToast`, `shadow-greenToast`, `shadow-yellow`; `drop-shadow-glow` (note: `glow` is a **dropShadow**, not boxShadow).
- **Animations**: `animate-fade`, `animate-fadeIn`, `animate-normalFadeIn`, `animate-normalFadeOut`, `animate-fadeDown` (toasts), `animate-normalFadeDown`, `animate-overflow`, `animate-overflowReverse`, `animate-newMessages`, `animate-marqueeUp`, `animate-marqueeDown`.
- **Plugins**: `tailwind-scrollbar`, `tailwindcss-rtl`, plus custom variants `child:` (`& > *`) and `child-hover:`.
- **RTL is supported.** Use logical utilities — `ps-`/`pe-`, `ms-`/`me-`, `start-`/`end-`, `text-start` — instead of `pl-`/`pr-`/`left-`/`right-` in anything user-facing.

## Primitive catalog

Import alias: `@postmill-ai/react/*` → `libraries/react-shared-libraries/src/*` (tsconfig.base.json paths). All form primitives self-register with React Hook Form via `useFormContext()` — **wrap every form in `<FormProvider {...form}>`** (`react-hook-form`), or pass `disableForm` for standalone use. Labels go through `TranslatedLabel`: `label` is the English fallback, `translationKey` / `translationParams` the optional explicit i18n key.

| Primitive | Import | Key props / contract |
|---|---|---|
| `Button` | `@postmill-ai/react/form/button` | Native `<button>` + `secondary`, `danger`, `loading` (built-in spinner, disables), `innerClassName`. Defaults `type="button"`. |
| `Input` | `@postmill-ai/react/form/input` | `label`, `name` (both required), `icon`, `error`, `removeError`, `disableForm`, `customUpdate` (called when the RHF value changes), `translationKey`/`translationParams`. Reads RHF field error automatically. |
| `Select` | `@postmill-ai/react/form/select` | `label`, `name`, `extraForm` (RegisterOptions), `hideErrors`, `disableForm`. |
| `CustomSelect` | `@postmill-ai/react/form/custom.select` | `options: {value, label, icon?}[]`; stores the whole `{value,label}` object in RHF (`form.setValue`). **Requires FormProvider** — calls `form.watch`/`form.setValue` unconditionally; `disableForm` is declared but not implemented. |
| `Checkbox` | `@postmill-ai/react/form/checkbox` | `variant?: 'default' \| 'hollow'`, `label`, `disableForm`, synthetic `onChange({target:{name,value}})`. |
| `Textarea` | `@postmill-ai/react/form/textarea` | `label`, `name`, `disableForm`. |
| `Slider` | `@postmill-ai/react/form/slider` | Boolean toggle: `value: 'on'\|'off'`, `fill`, `onChange`. Not RHF-bound. |
| `ColorPicker` | `@postmill-ai/react/form/color.picker` | react-colorful `HexColorPicker`; `name`, `label`, `enabled`, `canBeCancelled`. |

Name collisions to be aware of:

- `apps/frontend/src/components/ui/color-picker.tsx` exports a **different** `ColorPicker` (post-color swatch palette, `value?: string | null`) — for post heading colors, not RHF forms.
- `apps/frontend/src/components/ui/slider.component.tsx` exports `SliderComponent` (carousel with arrows/dots) — unrelated to the form `Slider` toggle.

**Mantine is sanctioned only for:** `Autocomplete` (`@mantine/core`), the date picker (`@mantine/dates`), and hooks (`@mantine/hooks`). All Mantine packages are v5 (`^5.10.5`). Reach for these before hand-rolling equivalents. **Never add a new UI kit** (no shadcn, MUI, Chakra, etc.).

## App-level kit (`apps/frontend/src/components/ui/`)

| Component | File | Contract |
|---|---|---|
| `DataTable<T>` + `StatusPill` + `AvatarCell` | `data-table.tsx` | Generic table: `columns: Column<T>[]` (`key`, `header`, `align`, `width`, `sortable`, `render`), `data`, `keyExtractor`, optional `loading` (built-in skeleton), `error`+`onRetry`, sorting, row selection, pagination, `emptyState`, `onRowClick`. Handles its own loading/error/empty states. `StatusPill`: `status: 'green'\|'blue'\|'amber'\|'red'`. |
| `EmptyState` | `empty-state.tsx` | **Canonical** empty state: `icon?`, `title`, `description?`, `action?`, `className?`. Standard-card styled. |
| `PageHeader` | `page-header.tsx` | `title`, `description?`, `action?`. The standard page top — use it (current adoption is low; it is still the standard). |
| `KebabMenu` / `KebabMenuItem` | `kebab-menu.tsx` | `items` (label/onClick, or `href`+`download`, `divider`, `danger`), `ariaLabel` (required), `align`, `width`, `insideLink`, `active`, `size`, `triggerClassName`. |
| `LoadingRows` | `loading-rows.tsx` | Skeleton rows: `rows?` (3), `columns?` (4). |
| `RouteError` / `RouteNotFound` | `components/errors/route-error.tsx`, `route-not-found.tsx` | Rendered by App Router `error.tsx` / `not-found.tsx` segment boundaries. `RouteNotFound` is async (server-safe, uses backend `getT`). |
| `TranslatedLabel` | `translated-label.tsx` | Duplicate of the one in react-shared-libraries — prefer the shared import in library code. |

There is a **second `EmptyState`** in `components/analytics-v2/kit/states.tsx` (analytics-flavored: default chart icon, no `className`, centered-panel rather than card styling) alongside `TabSkeleton` (`variant: 'cards'|'list'|'chart'`) and `ErrorState` (`title?`, `message?`, `onRetry?`). Use the analytics-v2 kit inside analytics-v2/dashboard surfaces (it is what `SectionCard` consumes); use `ui/empty-state.tsx` everywhere else.

## Modals

Single bespoke system: `apps/frontend/src/components/layout/new-modal.tsx` (zustand store). **`@mantine/modals` is vestigial** — it is in `apps/frontend/package.json` but has zero imports in source; never use it.

```tsx
const { openModal, closeAll, closeById, closeCurrent } = useModals();
openModal({
  title: 'Edit channel',
  size: 600,                       // width; also maxSize (maxWidth), height, top, center
  children: (close) => <MyForm onDone={close} />,  // ReactNode or render-prop
});
```

- `openModal` params: `title?`, `children` (`ReactNode | ((close: () => void) => ReactNode)` — the render-prop `close` honors `askClose`), `size?`, `maxSize?`, `height?`, `top?`, `fullScreen?`, `center?`, `askClose?` (confirm before closing), `withCloseButton?` (default true), `closeOnEscape?`, `closeOnClickOutside?`, `onClose?`, `id?` (dedupes by id), `removeLayout?` (bare overlay, no card chrome), `classNames?.modal`.
- Modals **stack**: each layer renders at `zIndex = 200 + index`; only the topmost responds to Escape.
- A11y and chrome are built in: `role="dialog"` + `aria-modal`, `aria-labelledby` from `title`, focus trap (Tab cycles, focus restored on close), body scroll-lock, backdrop blur of `.blurMe` elements.
- `useHasOpenModals()` — true while any modal is open (e.g. to hide the mobile nav).
- `showModalEmitter(params)` — open a modal from non-React contexts (emitter).
- **Confirm dialogs**: `const decision = useDecisionModal(); const ok = await decision.open({ title?, description?, approveLabel?, cancelLabel?, onlyApprove? })` → `Promise<boolean>` (resolves `false` on dismiss). `areYouSure({...})` is the same thing callable outside React via `decisionModalEmitter` (handled by `<DecisionEverywhere/>`).

## Feedback

- **Toasts**: `useToaster().show(text, 'success' | 'warning')` from `@postmill-ai/react/toaster/toaster`. Renders through the single `<Toaster/>` mounted once in the app layout; auto-dismisses after ~4.2s with `animate-fadeDown`.
- **Tooltips**: one global `react-tooltip` instance (`components/layout/top.tip.tsx`, `<Tooltip id="tooltip"/>`). Attach with attributes on the element: `data-tooltip-id="tooltip"` + `data-tooltip-content="..."`. Do not mount additional `Tooltip` instances.

## State conventions per context

| State | Use |
|---|---|
| Full-page loading | `LoadingComponent` (or default-export `Spinner`) from `components/layout/loading.tsx` |
| In-section skeleton | `LoadingRows` (generic) or `TabSkeleton` (analytics/dashboard) |
| Empty | `EmptyState` (`ui/empty-state.tsx`; analytics variant in the analytics-v2 kit) |
| Recoverable error | `ErrorState` with `onRetry` (analytics-v2 kit), or pass `error`+`onRetry` to `DataTable` |
| Route crash | App Router `error.tsx` / `not-found.tsx` rendering `RouteError` / `RouteNotFound` |
| Canvas-studio crash | Wrap `/media/*` canvas tools in `StudioErrorBoundary` (`components/media-tools/studio-error-boundary.tsx`, optional `fallback` prop). Reuse for new canvas tools — no ad-hoc try/catch. |

## Icons

- **No icon npm package is installed** (verified: no lucide, react-icons, @tabler, @heroicons, react-feather, @phosphor, @iconify in any package.json). Do not add one.
- Bespoke SVGs live in `apps/frontend/src/components/ui/icons/index.tsx`. Reuse first; add new ones there following the existing shape: `FC<IconProps>` where `IconProps = SVGProps<SVGSVGElement> & { size?: number }`, `stroke="currentColor"` where possible so text-color utilities theme them.
- Platform/channel icons: static PNGs at `apps/frontend/public/icons/platforms/<identifier>.png` (38 files, e.g. `instagram.png`, `linkedin-page.png`).
- Provider icons on settings surfaces: `ProviderIcon` (**default export**) from `components/shared/provider-icon.tsx` — `identifier`, `name?`, `size?` (28); inline SVG registry with letter-tile fallback (deterministic color from the identifier hash).

## Dates & i18n

- **dayjs everywhere** — never `moment`, never raw `Date` math for display.
- Date/time picking: `DatePicker` (`components/launches/helpers/date.picker.tsx`) wraps `@mantine/dates` `Calendar` + `TimeInput`; it works in `newDayjs` values.
- Timezone handling: `components/layout/set.timezone.tsx` — `getTimezone()` (user's stored timezone, `localStorage('timezone')`, falling back to `dayjs.tz.guess()`), `newDayjs()` (timezone-aware construction; date-only strings parse as midnight **in the user's timezone**), `getTimezoneAbbr()`.
- UTC→local rendering: `UtcToLocalDateRender` (`@postmill-ai/react/helpers/utc.date.render`) — `date`, `format`.
- **All user-facing strings** go through `useT()` from `@postmill-ai/react/translation/get.transation.service.client` (the filename typo `transation` is real — import it exactly). Pattern: `t('snake_case_key', 'English fallback', params?)`. Server components use `getT()` from `@postmill-ai/react/translation/get.translation.service.backend`. Form labels use `TranslatedLabel` (`label` = fallback, `translationKey` optional).
- Optional literal-string audit: `I18N_LINT=1 pnpm exec eslint apps/frontend/src` enables `i18next/no-literal-string` at warn (off by default — see eslint.config.mjs).

## RBAC-aware rendering

`usePermissions()` (`components/layout/use-permissions.tsx`) fetches `GET /settings/roles/me` via SWR and returns:

- `hasPermission(resource, action)` — `manage` on a resource implies all actions; super-admins pass everything.
- `isOwner`, `isAdmin`, `isSuperAdmin`, `role`, `refresh()`.
- `isLoaded` (fetch settled, success or failure) and `isResolved` (fetch succeeded).

Pattern (see `SectionCard`, `components/dashboard/kit/section-card.tsx`): **render optimistically, hide once resolved** — only gate when `permissions.isResolved && !permissions.hasPermission(...)`, so UI doesn't flash-hide while the fetch is in flight. UI gating is UX only; the backend `OrgRbacGuard` (403) is the real gate — see `agents/backend.md`.

## Hard rules

1. No new UI kit — no shadcn/MUI/Chakra/etc. Bespoke primitives + sanctioned Mantine only.
2. No raw `<button>`/`<input>` where a canonical primitive fits (`Button`, `Input`, `Select`, …).
3. No `// eslint-disable-next-line` on hooks — every SWR/data call is its own hook (see `agents/frontend.md`).
4. No `--color-custom*` vars; no raw hex where a token exists; no legacy alias colors (`primary`…`seventh`, `input`) in new code.
5. No `@mantine/modals`; no new `react-tooltip` instances; no icon npm packages.
6. Modals only via `useModals()`; confirms only via `useDecisionModal()`/`areYouSure()`.
7. Match the surrounding component's style (token usage, spacing scale in `px-[…]`, comment density) — check `apps/frontend/src/app/global.scss` and neighboring components before writing new UI.

## Checklist

Before shipping UI, verify:

- [ ] Tokens, not hex (`bg-btnPrimary`, not `bg-[#2B5CD3]`); new tokens have both `.dark` and `.light` values.
- [ ] Canonical primitives used (`Button`, `Input`, …) — no raw form elements where one fits.
- [ ] Forms wrapped in `<FormProvider>`; standalone controls pass `disableForm` (not `CustomSelect` — it requires FormProvider).
- [ ] All user-facing strings via `useT()` / `TranslatedLabel` with English fallbacks.
- [ ] Loading, empty, and error states covered (`LoadingRows`/`Spinner`, `EmptyState`, `ErrorState`/`RouteError`); canvas tools wrapped in `StudioErrorBoundary`.
- [ ] Feedback via `useToaster().show(...)`; tooltips via `data-tooltip-id="tooltip"`.
- [ ] Modals via `useModals().openModal(...)`; destructive confirms via `useDecisionModal()`.
- [ ] Verified in both dark and light mode (`textColor`, `newTableText`, `dangerText`, `positive`/`negative` are theme-adjusted — don't override them with fixed colors).
- [ ] RTL-safe: logical properties (`ps-`/`pe-`/`start-`/`end-`), not physical `pl`/`pr`/`left`/`right`.
- [ ] Permission-gated with `usePermissions()` using the optimistic-render pattern where the action is role-restricted.
