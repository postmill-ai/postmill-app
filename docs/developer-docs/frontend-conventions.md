# Frontend Conventions

Postmill's frontend runs on **Next.js (App Router) + React** with **Tailwind 3** for styling and **SWR** for data fetching. It listens on port `4200`.

---

## App Router structure

Source: `apps/frontend/src/app/`

| Route group | Path | Purpose |
|---|---|---|
| `(app)/(site)/` | `/posts`, `/agents`, `/comments`, `/analytics`, `/media`, `/campaigns`, `/billing`, `/settings` | Main application pages |
| `(app)/(site)/analytics/v2/` | `/analytics/v2` | Multi-channel analytics dashboard |
| `(app)/(site)/agents/[id]/` | `/agents/[id]` | Individual agent detail |
| `(app)/auth/` | `/auth/login`, `/auth/forgot`, `/auth/activate` | Authentication flows |
| `(app)/integrations/social/` | `/integrations/social/[provider]` | OAuth redirect handler for social providers |
| `(app)/(preview)/p/[id]/` | `/p/[id]` | Public post preview page |
| `(app)/(extension)/` | Extension pages | Browser extension UI |
| `(app)/(provider)/` | Provider pages | Provider bridge UI |
| `(app)/oauth/` | `/oauth/authorize` | OAuth authorization grant page |

### Shared layout

`apps/frontend/src/app/(app)/layout.tsx` wraps the authenticated app shell — sidebar navigation, top bar, context providers.

---

## Data fetching — SWR via `useFetch`

All API calls use **SWR** through the `useFetch` hook from `libraries/helpers/src/utils/custom.fetch.tsx`.

### Rules

1. **One SWR call per hook.** Each resource gets its own hook function:

   ```tsx
   // CORRECT — one hook per resource
   const usePosts = () => useSWR<PostListResponse>('posts', getPosts);

   // WRONG — nesting hooks inside returned objects (breaks rules-of-hooks)
   const useData = () => ({
     posts: () => useSWR<PostListResponse>('posts', getPosts),
     media: () => useSWR<MediaListResponse>('media', getMedia),
   });
   ```

2. **Never** add `// eslint-disable-next-line` to suppress `react-hooks/rules-of-hooks`.

3. Each hook lives in its component file or a dedicated hooks file in the same directory. There is no centralized hooks barrel file.

### `useFetch` architecture

The `FetchWrapperComponent` at the app root (in `layout.tsx`) provides a fetch instance through React context. The `useFetch` hook reads this context. The underlying `customFetch` function handles auth headers, automatic token refresh, and error normalization.

```tsx
function useCommunities() {
  const fetch = useFetch();
  return useSWR<CommunitiesResponse>('/communities', fetch);
}
```

`useFetch` is exported from `libraries/helpers/src/utils/custom.fetch.tsx`.

---

## Styling — Tailwind 3

Class-based dark mode. Utility classes only — no inline styles, no CSS modules for new components.

### Design tokens

CSS variables are defined in `apps/frontend/src/app/colors.scss` with their Tailwind mappings in `apps/frontend/tailwind.config.cjs`.

**Deprecated — do not use:**
- `--color-custom*` variables — all are replaced by `--new-*` tokens.

**Current tokens use the `--new-*` prefix.** Reference the existing component library to match the established design. Studio pages use the dedicated `studioBg`/`studioBorder` tokens.

### Global styles

`apps/frontend/src/app/global.scss` defines base element styles, scrollbar styling, and utility overrides.

---

## Component / design-system policy

### Default to shared bespoke primitives

These are the canonical building blocks — use them rather than re-rolling or pulling a new npm widget:

- **Button** → the shared `Button` primitive in `libraries/react-shared-libraries/src/form`.
- **Input / form fields** → the shared `Input` primitive in `libraries/react-shared-libraries/src/form`.
- **Modals** → the bespoke `useModals()` / `ModalManager` in `apps/frontend/src/components/layout/new-modal`.

### Mantine for sanctioned primitives

Mantine is the sanctioned base for the few primitives where bespoke would be wasteful, and stays:

- `@mantine/core` (e.g. `Autocomplete`).
- `@mantine/dates` (the date picker).
- `@mantine/hooks` (utility hooks like `useClickOutside`).

Reach for an existing Mantine primitive before hand-rolling one of these; do not rip Mantine out.

### Write bespoke only when nothing shared fits

Match the design tokens (`colors.scss` / `tailwind.config.cjs`); don't introduce a new npm UI kit (shadcn, MUI, Chakra, etc.).

### Deprecate ad-hoc duplicates

Don't add a new one-off button/input/modal that overlaps the canonical ones — consolidate onto them.

### UI components

Reusable low-level UI components live in `apps/frontend/src/components/ui/`. Examples:

- `logo-text.component.tsx`
- `check.icon.component.tsx`
- `translated-label.tsx`

### Feature components

Feature-specific components live in `apps/frontend/src/components/`:

| Directory | Purpose |
|---|---|
| `analytics-v2/` | Multi-channel analytics dashboard components |
| `ai/` | AI-related components (CopilotKit runtime, generators) |
| `launches/` | Calendar, post detail modal, post editor |
| `layout/` | App shell — sidebar, top menu, user context, modals |
| `settings/` | Settings tab panels |
| `new-layout/` | Refactored layout components |
| `media-tools/` | Studio Kit, Designer, HeyGen, Deepgram, stock browsers |
| `campaigns/` | Campaign hub and Discussion |

---

## Capability-aware UI

The frontend reads provider capabilities from `provider-capabilities.ts` (`libraries/nestjs-libraries/src/integrations/social/`). The matrix gates UI controls consistently. The same matrix is exposed to end users in the [Supported Channels](../user-guide/supported-channels.md) user guide and via the `GET /provider-capabilities` API endpoint.

| Capability | Gating effect |
|---|---|
| `analytics` | Shows/hides analytics tabs and cards |
| `comments` | Shows/hides comment sections and sync controls |
| `firstComment` | Enables first-comment configuration in composer |
| `poll` | Enables poll creation UI |
| `video` | Enables video upload controls |
| `carousel` | Enables multi-media carousel mode |
| `altText` | Shows alt-text fields on media |
| `maxMedia` | Caps the number of selectable media items |
| `linkPreview` | Shows link preview toggle |
| `refreshToken` | Shows refresh-token health indicators |
| `watchlist` | Enables competitor tracking UI |

**Do not add ad-hoc capability gating** — read the `PROVIDER_CAPABILITIES` map.

---

## Navigation

`apps/frontend/src/components/layout/top.menu.tsx` defines two menu groups:

**Group 1 — Core features:** Schedule, Agent, Comments, Analytics, Media, Plugs, Campaigns, Integrations

**Group 2 — Account:** UGC, Affiliate, Billing, Profile, Settings

Menu items are role-gated and billing-gated. The `isGeneral` flag (self-hosted mode) hides billing and UGC items.

---

## Error boundaries

- App Router segment boundaries: each main route group ships `error.tsx` + `not-found.tsx` (`(app)`, `(app)/(site)`, `(app)/(site)/media`, `(provider)`), rendering the shared `RouteError` / `RouteNotFound` (`components/errors/`). `error.tsx` is a `'use client'` component receiving `{ error, reset }`.
- The `/media/*` canvas studios (Designer, HeyGen, Replicate, Deepgram, and every Studio Kit `StudioShell`) are wrapped at the media layout level in `StudioErrorBoundary` (`components/media-tools/studio-error-boundary.tsx`) so a studio crash shows a themed fallback with a reset instead of a blank screen.

Reuse the `StudioErrorBoundary` pattern for new canvas tools rather than adding ad-hoc try/catch.

---

## React conventions

- All components are functional components with hooks.
- Use `useT()` for translatable strings (provided by the React shared libraries).
- Use `useUser()` for the current user/org/role (in `apps/frontend/src/components/layout/user.context`).
- Use `useVariables()` for feature flags (provided by the helpers package).
- Modals use `useModals()` (in `apps/frontend/src/components/layout/new-modal`).
- **No `dangerouslySetInnerHTML` without DOMPurify sanitization.**

> Verified against v1.0.0
