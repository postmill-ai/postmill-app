# UI standards: tokens, primitives, and component rules

The rulebook for writing any frontend UI in `apps/frontend` (Next.js App Router, Tailwind 4, class-based dark mode). Read before creating or modifying any component. Data-fetching rules live in `agents/frontend.md`; this file covers visual/style/component conventions only.

## Design tokens

Source of truth is `apps/frontend/src/app/colors.scss` — CSS custom properties declared twice, under `:root .dark` and `:root .light` — mapped to Tailwind color names in `apps/frontend/tailwind.config.cjs` (loaded via the v4 `@config` bridge in `apps/frontend/src/app/tailwind.css`; dark mode is `@custom-variant dark (&:where(.dark, .dark *))` there — the `dark`/`light` class on a root element selects the values). Use the **Tailwind name**, never the CSS var and never raw hex.

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

## Tailwind extensions (tailwind.config.cjs + src/app/tailwind.css)

Tailwind 4.3 runs CSS-first: `src/app/tailwind.css` holds `@import 'tailwindcss'`, the `@config`
bridge to `tailwind.config.cjs`, `@source '../../../libraries'` (v4 auto-detection doesn't cross the
workspace root), and the `@custom-variant`s. Sass cannot parse those at-rules, which is why the entry
is plain CSS — every App Router layout imports it **before** `global.scss`, and `global.scss` keeps
its `@apply` blocks working via `@reference './tailwind.css'`. PostCSS uses `@tailwindcss/postcss`
(`postcss.config.mjs`).

- **Custom screens** (all raw media queries): `mobile` ≤1025px (the app-wide phone breakpoint), `tablet` ≤1300px, `maxMedia` ≤1400px, `iconBreak` ≤1560px, `xs` ≤401px, `minCustom` min-height 800px, `custom` max-height 800px. DataTable reflows to stacked cards at `mobile`.
- **Shadows**: `shadow-menu` (themed), `shadow-previewShadow` (themed), `shadow-yellowToast`, `shadow-greenToast`, `shadow-yellow`; `drop-shadow-glow` (note: `glow` is a **dropShadow**, not boxShadow).
- **Animations**: `animate-fade`, `animate-fadeIn`, `animate-normalFadeIn`, `animate-normalFadeOut`, `animate-fadeDown` (toasts), `animate-normalFadeDown`, `animate-overflow`, `animate-overflowReverse`, `animate-newMessages`, `animate-marqueeUp`, `animate-marqueeDown`.
- **Plugins**: `tailwind-scrollbar` (v4) only. `tailwindcss-rtl` is gone — `rtl:`/`ltr:` are core v4 variants. Custom variants `child:` (`& > *`) and `child-hover:` live in `tailwind.css` as `@custom-variant`.
- **v4 spellings** (don't reintroduce the v3 names): `outline-hidden` (not `outline-none`), `shrink-*` (not `flex-shrink-*`), `rounded-xs`/`blur-xs`/`shadow-xs` for the old `*-sm`, bare `rounded`→`rounded-sm`, bare `shadow`→`shadow-sm`, `/opacity` modifiers instead of `bg-opacity-*`, and trailing `!` for important (`bg-red-700!`, not `!bg-red-700`). Function colors are not supported through the `@config` bridge — theme colors are plain `var(--x)` strings; v4 applies `/opacity` via `color-mix`.
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

### Tab bars and chip strips

**There is one tab bar.** `OverflowTabs`
(`apps/frontend/src/components/ui/overflow-tabs.tsx`) is the only way to render a horizontal
tab/chip/sub-nav row. Below `mobile:` (≤1025px) it keeps **three items inline and folds the rest into
a ⋮ menu**; at desktop widths everything stays inline.

```tsx
<OverflowTabs
  items={tabs.map((t) => ({ key: t.key, label: t.label, section: t.section }))}
  activeKey={tab}
  onSelect={setTab}
  variant="underline"        // 'underline' | 'pill' | 'outline'
  semantics="tabs"           // 'tabs' → tablist/tab · 'nav' → aria-current · 'toolbar' → aria-pressed
  ariaLabel={t('more_tabs', 'More tabs')}
  renderItem={…}             // only for a bespoke selected style; must apply `slotProps`
/>
```

- Pick `semantics` by what the bar *does*: swaps an in-page panel (`tabs`), navigates (`nav`), or
  filters (`toolbar`). Don't put `role="tab"` on a `<Link>` that changes the route.
- **The active item is always one of the three visible** — the component swaps it forward. Never
  re-implement `items.slice(0, 3)` by hand; two copies of that had already drifted apart.
- `section` groups the item under a header in the overflow menu (used by `/media` and `/settings`,
  which can carry 14–47 entries). Pass an **already-translated** label.
- Using `renderItem`? You must spread `slotProps` (class + `data-overflow-slot`) or your overflow
  items stay visible on mobile and the component does nothing.
- **Testing:** jsdom applies no CSS, so both the inline and desktop-only copies are queryable. Assert
  on `[data-overflow-slot="inline"]` or the exported pure `splitOverflowItems` — never mock
  `matchMedia`, the component deliberately doesn't use it.

Deliberately *not* using this pattern (each solves mobile another way): the bottom tab bar
(4 pinned + a bottom sheet), the Designer menu bar (`☰`), the Designer output tabs (`…` past 6), and
the setup stepper (progress bar).

### Picking a file or media asset

**There is one picker.** `useMediaPicker()`
(`apps/frontend/src/components/media-tools/use-media-picker.tsx`) is the only sanctioned way to let
a user choose an existing file or stock asset — used by the composer, the Designer, every provider
studio, the AI Designer, campaigns and settings.

```tsx
const picker = useMediaPicker({
  title: t('background_image', 'Background image'), // default: "Select media"
  kinds: ['image'],          // restricts the tabs; 'My Files' always survives
  excludeTabs: ['Stock Icons'],
  multiple: true,            // batch mode + Confirm tray, use with onConfirm
  requireFile: true,         // import stock picks so you always get a fileId
  onSelect: (item) => …,     // single-select; the picker closes itself
});
return <><Button onClick={picker.open} />{picker.element}</>;
```

- **Never wrap it in `openModal`** (rule 8 below) and never render `MediaSelectorModal` yourself.
- **`requireFile`** replaces the hand-rolled "if `!fileId` → `POST /files/import`" block that had been
  copied into six surfaces. Use it whenever you persist a reference. Don't combine it with a caller
  that imports the batch itself (the AI Designer does).
- The picker opens on **My Files**, not stock. `FileManager` embedded there renders no page chrome —
  that is gated on its `standalone` prop.

Name collisions to be aware of:

- `apps/frontend/src/components/ui/color-picker.tsx` exports a **different** `ColorPicker` (post-color swatch palette, `value?: string | null`) — for post heading colors, not RHF forms.
- `apps/frontend/src/components/ui/slider.component.tsx` exports `SliderComponent` (carousel with arrows/dots) — unrelated to the form `Slider` toggle.

**Mantine is sanctioned only for:** `Autocomplete` (`@mantine/core`), the date picker (`@mantine/dates`), and hooks (`@mantine/hooks`). All Mantine packages are v9 (`^9.5.1`). Reach for these before hand-rolling equivalents. **Never add a new UI kit** (no shadcn, MUI, Chakra, etc.).

Notes on the v9 line (very different from the old v5 behavior):

- **Styles are plain CSS, not emotion** — `@mantine/core/styles.css` and `@mantine/dates/styles.css` are imported once in `apps/frontend/src/app/(app)/layout.tsx` (before `global.scss`). No `MantineProvider` anywhere.
- **Date values are `'YYYY-MM-DD'` strings, not `Date`** — `DatePicker`/`TimeInput` `value`/`onChange` hand back strings (`TimeInput` is a native `input[type=time]`, `'HH:mm'`).
- **`RangeCalendar` and `dayClassName` are gone** — range picking is `<DatePicker type="range" allowSingleDateInRange />`; day states (selected/weekend/outside/in-range) are styled with Tailwind `data-[selected]:` / `data-[outside]:` / `data-[in-range]:` variant classes in `classNames.day`, not a callback.
- `@mantine/dates` needs `dayjs` as a peer — it is a declared `apps/frontend` dependency.

## App-level kit (`apps/frontend/src/components/ui/`)

| Component | File | Contract |
|---|---|---|
| `DataTable<T>` + `StatusPill` + `AvatarCell` | `data-table.tsx` | Generic table: `columns: Column<T>[]` (`key`, `header`, `align`, `width`, `sortable`, `render`), `data`, `keyExtractor`, optional `loading` (built-in skeleton), `error`+`onRetry`, sorting, row selection, pagination, `emptyState`, `onRowClick`, `leadingRows`, `rowProps`. Handles its own loading/error/empty states. `StatusPill`: `status: 'green'\|'blue'\|'amber'\|'red'`. |
| `EmptyState` | `empty-state.tsx` | **Canonical** empty state: `icon?`, `title`, `description?`, `action?`, `className?`. Standard-card styled. |
| `PageHeader` | `page-header.tsx` | `title`, `description?`, `action?`. The standard page top — use it (current adoption is low; it is still the standard). |
| `KebabMenu` / `KebabMenuItem` | `kebab-menu.tsx` | `items` (label/onClick, or `href`+`download`, `divider`, `danger`), `ariaLabel` (required), `align`, `width`, `insideLink`, `active`, `size`, `triggerClassName`. Anchors to its own trigger — for pointer-anchored menus use `ContextMenu`. |
| `ContextMenu` / `ContextMenuItem` | `context-menu.tsx` | Pointer-anchored menu for right-click and long-press: `x`, `y`, `items` (label/onClick, `divider`, `danger`, `disabled`), `onClose`, `ariaLabel` (required), `width`. Portals to `document.body` (a `fixed` menu is otherwise clipped by scrolling or transformed ancestors), closes on outside **mousedown** (not click — click would swallow the first click of the action underneath), Escape, scroll and resize; clamps to the viewport on all four edges; `role="menu"` with arrow/Home/End roving focus and focus restored to the opener on close. |
| `useContextMenu<T>()` | `use-context-menu.ts` | `{ menu, openAt, close }` — tracks `{x, y, target}` for a `ContextMenu`. `openAt` falls back to the element's bounding rect when `clientX/Y` are 0, so keyboard invocation (Shift+F10 / Menu key) anchors correctly. |
| `useLongPress<T>()` | `use-long-press.ts` | Touch equivalent of right-click: `bind(payload)` returns the touch handlers for one element, so a single instance can serve a whole list. 500ms hold, cancelled by >10px drift. Its `onClickCapture` **swallows the synthetic click** touchend emits after firing — without it the underlying tile handler runs beneath the menu. Pair with `select-none` + `WebkitTouchCallout: 'none'` and `preventDefault()` in `onContextMenu` for iOS Safari. |
| `LoadingRows` | `loading-rows.tsx` | Skeleton rows: `rows?` (3), `columns?` (4). |
| `RouteError` / `RouteNotFound` | `components/errors/route-error.tsx`, `route-not-found.tsx` | Rendered by App Router `error.tsx` / `not-found.tsx` segment boundaries. `RouteNotFound` is async (server-safe, uses backend `getT`). |
| `TranslatedLabel` | `translated-label.tsx` | Duplicate of the one in react-shared-libraries — prefer the shared import in library code. |

There is a **second `EmptyState`** in `components/analytics-v2/kit/states.tsx` (analytics-flavored: default chart icon, no `className`, centered-panel rather than card styling) alongside `TabSkeleton` (`variant: 'cards'|'list'|'chart'`) and `ErrorState` (`title?`, `message?`, `onRetry?`). Use the analytics-v2 kit inside analytics-v2/dashboard surfaces (it is what `SectionCard` consumes); use `ui/empty-state.tsx` everywhere else.

## Modals

Single bespoke system: `apps/frontend/src/components/layout/new-modal.tsx` (zustand store). **`@mantine/modals` is not installed** — it was dropped with the Mantine v9 upgrade; never use it.

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
- **Confirm dialogs**: `const decision = useDecisionModal(); const ok = await decision.open({ title?, description?, approveLabel?, cancelLabel?, onlyApprove? })` → `Promise<boolean>` (resolves `false` on dismiss). `areYouSure({...})` is the same thing callable outside React via `decisionModalEmitter` (handled by `<DecisionEverywhere/>`). Note `areYouSure` does **not** forward `onlyApprove` — for an OK-only dialog use the hook.
- **Text input (the `prompt()` replacement)**: `const prompt = usePromptModal(); const value = await prompt.open({ title?, label?, placeholder?, initialValue?, approveLabel?, cancelLabel? })` → `Promise<string | null>`. Resolves the **trimmed** value on submit and **`null`** when cancelled or dismissed — the `null` vs `''` distinction is load-bearing (callers use it to tell "aborted" from "submitted empty", e.g. clearing a link vs. leaving it alone).
- **Native `alert`/`confirm`/`prompt` are banned and lint-enforced** — `no-alert` + `no-restricted-globals` in the frontend block of `eslint.config.mjs`. They block the event loop, ignore theme tokens, can't be translated, can't be focus-trapped alongside stacked modals, and are auto-dismissed by Playwright in `e2e/`.

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
- Date/time picking: `DatePicker` (`components/launches/helpers/date.picker.tsx`) wraps `@mantine/dates` `DatePicker` (single date) + `TimeInput`; it works in `newDayjs` values. Range picking (calendar filters, analytics filter bar) uses `@mantine/dates` `DatePicker type="range"`, which speaks `'YYYY-MM-DD'` strings.
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
6. Modals only via `useModals()`; confirms only via `useDecisionModal()`/`areYouSure()`; text input
   via `usePromptModal()`. No native `alert`/`confirm`/`prompt` — enforced by `no-alert` +
   `no-restricted-globals` (frontend block of `eslint.config.mjs`).
7. File/media picking only via `useMediaPicker()` — never render `MediaSelectorModal` directly and
   never wrap it in `openModal` (it renders its own dialog; wrapping stacks two chromes with
   different headers). Enforced by `media-tools/media-picker-single-chrome.spec.ts`.
8. Horizontal tab/chip/sub-nav rows only via `OverflowTabs` — never hand-roll a scroll track, and
   never let a row rely on `overflow-x-auto` alone (the scrollbar is suppressed app-wide, so the
   tail becomes unreachable).
9. Match the surrounding component's style (token usage, spacing scale in `px-[…]`, comment density) — check `apps/frontend/src/app/global.scss` and neighboring components before writing new UI.

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
