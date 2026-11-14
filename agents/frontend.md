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
- Global Plus Jakarta Sans comes from `components/new-layout/jakarta-sans.ts` using
  `next/font/local` and the OFL variable fonts in `apps/frontend/public/fonts`. Do not use
  `next/font/google` in application layouts: build-time Google downloads make production
  deploys depend on an external network response.

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

## AI Designer chat attachments

- Attach is enabled only in the resting `intake`, `awaiting_plan`, and `delivered` states, never while
  planning/executing/revising or during an optimistic send. Intake sends optional bounded
  `referenceFileIds`/`attachmentFileIds` through `message`; plan/design resting states use `revise`.
- Keep image and document chips while the send is pending. Clear only the acknowledged send's chips on
  its nonce-matched user-message echo; preserve newer selections. On invalid/busy rejection, disconnect,
  or the 10-second send timeout, remove the optimistic bubble and restore its text and chips for retry.
  Busy is a typed error carrying the original nonce, not an accepted transcript message; it restores only
  the rejected send and leaves the active run's progress and Cancel visible. Start uses a 60-second safety
  timeout when image/document IDs are present (10 seconds otherwise) so pre-session extraction cannot enable
  a duplicate Start click while validation is still running.

## Designer: four renderers, one document

`/media/designer` draws every document **four times**:

| Path | Where | Used for |
|---|---|---|
| Konva | `designer/elements.tsx`, `designer/video-canvas-overlay.tsx` | the canvas, page thumbnails and SVG rasterization |
| node-canvas | `design-render/design-render.service.ts` | PDF, bulk generation, and static PNG/JPEG/WebP previews/exports through `/media/designs/render` |
| a browser script | `design-render/frame-renderer-script.ts` | video frames, in headless Chromium |
| an SVG translator | `designer-doc/svg-export.ts` | SVG export |

The SVG path is a **translation**, not a fourth renderer: anything SVG cannot express is emitted as
an `<image>` the caller rasterises. It still has to agree on geometry, so the same rules apply.

All three must produce the same picture, so **every rule any of them needs goes in a shared pure
module under `designer-doc/`** — `fit-text`, `shape-geometry`, `path-geometry`, `layer-tree`,
`pixel-ops`, `layer-styles`, `pattern-tiles`, `background-texture`, `media-geometry`. Reimplementing
one of those rules in one renderer is how the exports drift.

The frame renderer is injected into a page as text and cannot import, so it takes the shared code as
**source**: `shapeGeometrySource()` stringifies the geometry functions (and everything they close
over) for the script to prepend. A spec evaluates that source and diffs it against the real
functions, which is what stops the third path silently forking.

Layer semantics that are easy to get wrong, and that the renderers must agree on:

- **Groups are flat.** `output.children` stays a flat array; nesting is expressed by `parentId` and
  resolved by `buildLayerTree`. A group renders at the position of its **first** member. Never add a
  nested `children[]` to an element — ~87 call sites iterate the flat array.
- **Blend controls share the existing compositors.** Static single/multi-selections use the Common
  Inspector's `SELECTABLE_BLEND_MODES` and `setLayerBlend`; clips keep the native-only subset in their
  own Inspector. Plain non-native static layers must go through the server's offscreen `applyBlend`
  path just like styled, masked, and grouped layers — drawing them directly drops the blend.
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
- **Pages and Carousel are slides WITHIN one output (doc v8, image mode only).** `output.children`
  IS page 1; `output.pages[0..n]` are the extra pages (`{ id, name?, background?, children[] }` — no
  size: pages inherit their output's canvas, capped at `MAX_PAGES_PER_OUTPUT`). This is one document
  model, not a separate carousel doc type. **View → Pages / Carousel** opens the side-by-side strip;
  Carousel can insert after any slide and delete slide 1 by promoting the next slide (`allowFirst`),
  while ordinary Pages keeps the base-slot deletion restriction. Selection/reorder/duplicate/delete/
  insert each commit one Undo. Shared accessors live in `designer-doc/designer-doc.pages.ts`
  (`pageChildren`/`withPageChildren`/`pageBackground`/`appendPage`/`removePageAt`) — never read
  `output.children` directly in an editing surface. Headless `addPage` accepts `afterPageNumber`, and
  `removePage` accepts `allowFirst`. Linked-edit (`originId`) propagation across outputs is a
  PAGE-1-only behavior; per-page edits stay local. Video outputs reject `pages` in the schema. The
  store tracks `currentPage` (editor state, reset/clamped on output/history changes);
  `DesignRenderService.renderPage(doc, outputIndex, opts, pageNumber)` renders one page and
  `renderPdf` flattens all pages of all outputs sequentially. Server-persisted snapshots of the
  whole doc live in the `DesignVersion` table (`/media/designs/:id/versions*`) — the versions panel,
  not the in-memory History panel; restore takes an `auto` safety snapshot server-side first.
  Preview opens a current-versus-saved comparison without loading the saved doc into the store.
  `POST /media/designs/preview` renders the captured current doc and the org-scoped
  `GET /media/designs/:id/versions/:vid/preview` validates and renders a saved version. Both use
  output 0/page 1 or the video time-zero poster through `DesignPreviewService`, returning PNG with
  `private, no-store` and no File row. Stored version thumbnails avoid only the version fetch;
  preview loads are request-scoped by design/version id and are not restarted by changing
  translation identities.
- **Video outputs have variants too.** The `+` add-format flow works in video mode: a new output
  CLONES the current output's tracks/clips with fresh ids and smart-reflows the geometry onto the
  new canvas via `designer-doc/video-reflow.ts` (clips map onto pseudo-elements and go through
  `smartReflow` — timing, fps and durationMs are invariant). Repeated presets and custom dimensions
  are allowed in both document modes; the store disambiguates names (`Name 2`, `Name 3`, …) and
  enforces `MAX_OUTPUTS`. `originId` on `VideoClip` links sibling
  clips across variants: content/style edits propagate through `applyLinkedVideoClip`
  (`apply-linked.ts`), geometry and timing stay local (`VIDEO_CLIP_LOCAL_KEYS`). Doc v14 adds optional
  `textStroke`; its width follows the same aspect-aware type scale as linked font size and reflow, with
  a 1px minimum for nonzero sources. Writing a stroke to an older video document stamps v14 immediately.
  The same branches
  serve the backend `addOutput`/`resizeOutput` ops, so agent-driven edits match the UI. The backend
  ops vocabulary adds clip ops (`updateClip`/`replaceClipMedia`/`updateTransition` in
  `designer-doc-ops.schema.ts`) which are FORMAT-LOCAL — no originId propagation on the headless
  path. Server-side previews of a video output (AI Designer saver, contact sheets, critic re-check)
  render the t=0 POSTER projection `designer-doc/video-poster.ts` — a render-only synthetic image
  output (clips→elements; `video`-track clips draw from their File row's stored thumbnail poster
  when one is resolved by the caller — `DesignPreviewService` self-heals missing ones through the
  File row's local or cloud storage adapter via `media/video-frame.ts`). A fileId-less remote video
  uses bounded `safeFetch` + the same frame extractor, with no File row required. Preview rendering
  fails when a visible required time-zero poster or other visual asset cannot be loaded; intentional
  black pixels remain valid.
  `renderPage` still rejects video outputs.
- **Formats can be linked or independent.** Add Formats defaults to linked content; independent
  copies use fresh ids without shared `originId`s for static pages/elements and video clips. The
  store and headless `addOutput` op both accept `linkContent: false`; omitting it preserves linked
  behavior, and Undo adds/removes the whole format. The store seeds from the ACTIVE output (including
  its pages); a frozen source is allowed unless linked copying would need to backfill its missing
  `originId`s, in which case the popover stays open with a warning and independent copies remain
  available. The Link/Unlink button beside output tabs only
  toggles `editFormatOnly`; it never rewrites existing element/clip links. Presets include grouped
  1080×1350 Instagram/Facebook/LinkedIn/Threads portraits and Facebook/LinkedIn squares with safe
  zones. `FormatThumbnail` lazily renders near-visible output/page previews through one queued,
  shared `output-thumbnail` stage and the existing video-poster projection. Its 100-entry LRU is
  scoped to the page view/symbols/size, with reference-only lookups during render and structural
  output/symbol fallback after the debounce, so unrelated page edits, undo, and save adoption do
  not invalidate every thumbnail or deep-compare the LRU on every drag frame. Image preloads are
  capped at five seconds so the serial queue cannot stall indefinitely. Never allocate
  full-resolution offscreen stages for this path or capture on every drag frame. Saved library previews instead use
  `renderLibraryPreview`, which retains the original full-size stage before scaling the final JPEG.
- **Output freeze is distinct from layer/track lock.** Optional-additive `output.frozen` is valid on
  v13 without a version bump (and remains additive when a later version lands). Snowflakes switch
  the flag through `setOutputFrozen` (store and headless op); switching output, exporting, and
  read-only clip/keyframe clipboard copies remain available. `output-freeze.ts` performs
  reference-fast, key-order-insensitive checks (including referenced symbol definitions) for the
  store's boolean-returning guarded actions and `DesignerDocService.applyOps`. Frozen
  canvas/Inspector/page/timeline/resize/remove/`setDoc` edits are rejected before selection/history
  changes, and the canvas shows a read-only hint. Pathfinder, Freeze Frame and captions use the
  same guarded actions and return before their own history commits. Explicit `pushHistory()` calls
  remain valid even when the document is unchanged (for example, concurrency markers). Headless rejection uses
  `DESIGNER_OP_OUTPUT_FROZEN`. History navigation, save adoption, explicit load/reset, version
  restore and remote collaboration documents use trusted raw replacement rather than local-edit
  guards; collaboration carries `frozen` in video output maps. No SQL migration is involved.
- **Pathfinder is multi-shape and atomic.** Two or more unlocked shapes/paths/icons compute fully
  before one document commit on the current output/page only; linked copies in other formats stay
  untouched. Unite merges every region, Minus Front subtracts every later shape
  from the first, Intersect is successive, Exclude keeps odd-coverage regions, Divide emits unique
  regions, and Outline removes fills. Disjoint results survive and are all selected. Contained
  regions become one compound path: `nodes` is the outer contour, optional `subpaths` carries every
  contour, and `fillRule: evenodd` preserves holes across Konva, server rendering, resize/reflow/warp,
  and SVG export. One Undo restores every input. Canvas-space outlines include each element's
  rotation (origin pivot) and flips (center pivot). Axis-aligned rectangles sharing a horizontal or
  vertical strip use the exact interval path in `path-boolean.ts`; vertical merging writes all four
  corners in top-left → top-right → bottom-right → bottom-left order. Offset Path and Live Corners
  instead use the pre-transform local outline, so the element's existing rotation/flips apply once.
- **Design/template previews are best-effort, never save blockers.** Video saves render through
  `DesignPreviewService`; image saves use that server renderer when no client thumbnail arrives.
  Org-owned background `fileId`s resolve through the folder storage adapter before the remote URL,
  and failed remote image loads are evicted so a later save can recover. `.pdesign` export also renders
  when its source has no resolvable preview and then triggers targeted healing of the latest source.
  A render failure keeps the previous preview, and preview replacement cleans up only the old File
  row it actually replaced. Legacy remote video clips with no File row use the bounded streaming
  frame extractor (never the 256 MB whole-buffer path), and only successful posters stay cached.
  Share opens a dialog whose URL is derived from `currentDesignId` as `/media/designer?designId=<id>`;
  it never copies the generic current location. Deep-linked loads reject HTTP and error-shaped
  responses with a visible unavailable state instead of treating an error body as a DesignerDoc.
- **Video clips are canvas objects too.** The tool palette applies to both document kinds: a clip
  carries the same geometry an element does, and a drag writes back through `clip-geometry.ts` as a
  DELTA — writing absolute values would collapse a keyframed clip's animation onto whichever frame
  was showing. A keyframe sitting under the playhead is edited in place; otherwise the base props
  move. Track types `shape` and `raster` (doc v5) exist so shape and paint tools have somewhere to
  put their output on a timeline. Doc v9 adds optional `fillGradient`/`align`; doc v10 adds optional
  `fontStyle` (`normal`/`italic`) and format-local `groupId`. Style fields propagate through linked
  edits and the clip-op whitelist; `groupId` never does. Text corner transforms scale the rendered
  `fontSize` through that same base/keyframe path, while side handles only re-wrap. Generic new Text
  starts at 400 Normal; named presets keep their authored weight. The video overlay is the sole owner
  of clip drag/transform geometry: the static Layer handlers return early in video mode, and every
  selected visible node commits through silent clip updates plus ONE history push. Shift/Ctrl/Cmd-click
  and marquee use `selectedClips`; grouped members select together, duplicate/paste remaps group ids,
  and `video-reflow.ts` supplies one group box so relative geometry survives resize/seed.
- **Canvas input works with mouse and touch.** Stage tools share `MouseEvent | TouchEvent` handlers,
  the canvas owns its gesture with `touchAction: none`, and a short touch tap places a default shape
  through `rectFromTap` while a drag uses the authored box. Text and caption hit surfaces cover the
  full box (`fullBoxHitProps` or a transparent hit Rect), never just the painted glyphs; coarse
  pointers enlarge the Transformer anchors. Two-finger pinch-zoom is anchored at its centroid through
  `canvas-pinch.ts`; pinch start explicitly stops the active Konva node drag and flushes any active
  paint/marquee through its normal end handler, then the container capture phase suspends new tool
  commits until every finger lifts. Do not add mouse-only Stage handlers or reintroduce a
  synthetic-mouse duplicate commit after a touch gesture.
- **Rich-text paste normalizes CSS into the save contract.** The content-editable commit path stores
  only the primary font family from every quoted or unquoted stack (or inherits the element font),
  accepts only bounded pixel font sizes, and drops oversized run colors. Bounds come from
  `designer-doc.limits.ts` (`MAX_FONT_FAMILY_LEN`, `MAX_COLOR_LEN`, `MAX_RICH_TEXT_RUNS`), never local literals.
  Combined text is capped at `MAX_TEXT_LEN` with a visible toaster warning; runs beyond `MAX_RICH_TEXT_RUNS`
  are coalesced into the final run with a formatting-simplification warning so text is not lost.
  Enter-to-edit prevents the key's default action so selection/focus cannot replace the text with a newline.
  Ordinary content-editable commits change only text/rich runs and retain the existing box's shrink-to-fit
  behavior. `measure-text.ts` owns growth for the explicit Inspector Size control: height grows for wrapping,
  width only for one unwrapped overflow word, growth never shrinks a manual box, and output bounds and
  alignment anchors are preserved. Canvas Ctrl/Cmd+> and < match those keys with or without Shift;
  physical `Comma`/`Period` codes require Shift and a non-letter key so Dvorak paste and unshifted
  Cmd+comma/period are untouched. `text-shortcuts.ts` ignores ordinary text-entry focus but remains
  available in the inline contenteditable, and covers every selected static text or video text/caption
  clip. Static shortcuts start at the fitted size and adjust rich runs independently. An already shrunk
  box keeps its geometry; an unshrunk box grows through the same bounded helper so each increase paints
  at the new size. Unset caption sizes start at the renderer's 28px fallback. Inline blur serialization
  applies shortcut deltas instead of restoring stale run sizes.
- **Desktop/mobile workspace shares one store and tool registry.** Desktop docks Inspector, Layers,
  Brand, and AI in `workspace-panel.tsx` using `OverflowTabs`; AI and Brand mount on their first visible
  activation, then stay mounted under hidden wrappers so results and in-flight work survive tab and
  collapse changes without eager fetches or hidden job adoption. Selection never changes the user's tab
  or collapsed state; Layers multi-select/rename and Brand/AI workflows stay sticky, and Expand restores
  the active tab. Active-tab/collapse preferences persist per organization while legacy Layers and Brand
  open preferences remain fallback inputs. Mobile starts with Inspector closed and applies desktop
  preferences only after the actual viewport is known. The rail Brand action and Tools ▸ Workspace commands
  select those tabs, History/Versions sit beside Undo/Redo, Templates sits beside Save, and View remains
  display-only. History, Versions, and Template Fields keep their persisted floating-panel positions.
  `mobile-designer-tools.tsx` keeps prominent quick actions and inline, non-modal Tools/Brand sheets;
  Workspace ▸ Layers toggles its floating panel. The mobile Inspector participates in layout at half or
  expanded height with collapse, accessible snap buttons, and a pointer/keyboard drag handle. The main
  mobile column scrolls when expanded panels exceed the viewport, and Brand mounts only in its active
  mobile layout. Mobile keeps design rename and timeline collapse/zoom-to-fit available.
- **Timeline gestures and exact timing.** Clip move/trim and ruler scrub use `trySetPointerCapture`
  from `pointer-capture.ts` (an inactive pointer returns false instead of throwing; every Designer
  capture call goes through it), with pointer-id checks, cancellation/lost-capture handling, and
  bounded horizontal/vertical auto-scroll.
  `clip-timing.ts` shares the drag's move/trim rules with the Inspector's Start/End/Duration steppers
  and the expanded mobile timeline's compact selected-clip editor. These are clip-local and separate
  from the output-duration stepper. Each changed stepper edit commits one history entry (unchanged
  blur is a no-op), and `clip-source-duration.ts` supplies a reactive source bound only after a
  successful probe. Failed probes never cache the 10-second insertion fallback as the real duration;
  they back off for 30 seconds and accept late metadata. Auto-scroll adds viewport displacement to
  drag deltas and only runs after actual pointer movement.
- **Timeline transport and Inspector essentials.** `timeline-split.ts` is the single split guard for
  the transport, S shortcut, context menu, and store: an unlocked selected clip, a strictly interior
  playhead, and at least 100 ms on both sides. Invalid cuts are no-ops; valid splits select the right
  half. Split is a labeled transport action. Consecutive clips follow the renderer's
  `from.endMs <= to.startMs` transition rule, including gaps and fractional flush cuts. A 24×16 badge
  sits in a dedicated top lane clear of the ruler and both full-height trim edges; tiny cut-only pairs
  omit it, but every pair with an existing transition keeps its control. The badge opens the existing
  transition popover; do not add another timeline model. The transport's duration stepper uses `setVideoDuration` and the shared 1–180 s cap. Clip
  replacement/background removal lives in `clip-media.ts`; static replacement shares
  `image-replacement.ts`. Replacement preserves frame, fit, and focal intent, remaps same-aspect crops,
  and derives a bounded frame-aspect cover crop around the old relative center when source aspects differ
  (or clears an unmeasurable incompatible crop), so explicit crops never letterbox the frame. It adopts
  the new owned File, clears original/smart-filter and painted-mask state, propagates linked content,
  and commits one Undo. Ordinary file drops always retain insertion/SVG-import routing. Alt/Option-drop
  on an unlocked, visible static image or image/sticker clip shows a distinct Replace indicator and uses
  those same actions with `dropEffect: 'copy'` for OS drag negotiation; locked targets fall through to
  insertion, video/audio clips are never targets, undecodable uploads are rejected, target failures are
  not reported as upload failures, and a failed replacement deletes its newly uploaded File. Generation
  returns a review candidate and does not edit the doc; Apply commits once after the before/after dialog. Static
  (`ai-image-actions.ts`) and clip paths share `background-removal.ts` geometry: preserve the existing
  crop/fit/focal geometry by default, with preserve-frame contain and aspect-correct canvas fitting
  as options. Apply keeps original pixels as `src`, rasterizes the reviewed alpha into the final
  element box through `computeMediaDraw`
  (contain/cover/crop all included), uploads that box-space bitmap as `maskSrc` through
  `background-removal-mask.ts`, and commits once after the before/after dialog. If mask preparation
  fails, Apply falls back to the old flattened cutout rather than discarding the provider result.
  A later aspect-changing resize remaps the box-space mask through the old and new media geometry and
  uploads it in the same history commit; no provider call is made. It first samples the old box rect
  into the old source rect (box → source), then renders the new source rect into the new box rect.
  Pixels outside the old cover crop have no alpha information and remain transparent if a resize
  reveals them. Live mask buffers are seeded only after the gesture's stale check. Broken image/mask
  elements are not paintable and must not reach `drawImage`; a broken mask degrades to the plain source image.
  Magic Grab (`magic-grab.ts`) uses the same cutout plus an opaque white-subject-on-black source
  mask and a review dialog. The server reconstructs only through the resolved masked-inpaint path,
  never unmasked image-to-image generation, and composites by mask luminance so unrelated pixels
  remain original. The Inspector requires both background-removal and inpaint availability. Static Apply
  replaces/inserts adjacent layers; still-video Apply uses adjacent tracks. Both commit once, select
  only the subject, and delete the temporary inpaint-mask File. It does not claim moving-subject
  extraction from video footage.
  Outpainting (`outpaint.ts`) uses one prepare/review/Apply candidate flow for selected images and
  whole pages. The dialog owns pending/error state and blocks duplicate requests. Directional input
  is the exact cropped/cover display frame, restored from the same bitmap; canonical mode geometry
  is independent of provider-returned pixel dimensions. Whole-page Apply inserts a generated
  extension whose original-page rect is transparent, then translates every ORIGINAL layer by the
  same centering offset without flattening the selected image, other layers, or page background.
  Final compositions are referenced `internal: 'design-asset'` Files, hidden from the library;
  cancel/stale cleanup uses `/media/outpaint/cleanup`, while Apply and Undo/redo retain them.
  `cutout-refine-controls.tsx` arms the same mask for Restore
  (white brush) and Erase (alpha removal); still-image clip masks use optional-additive doc v11
  fields and mirror through `video-canvas-overlay.tsx` and the isolated frame-render buffer. Legacy
  flattened cutouts without originals say so. `doc-file-refs.ts` collects and remaps all three file
  references. `use-pixel-ops.tsx` must not let an older rebake overwrite a newer media source. Static
  and video Inspectors share `corner-radius-control.tsx` and `text-style-control.tsx`.
- **Timeline hit-testing starts at the scroll viewport.** `timeline-geometry.ts` owns row/new-track
  geometry, duration-preserving keyboard moves, and the separate zoom-aware snap and collision
  thresholds. Never measure drop rows from the toolbar wrapper or reuse edge-snap tolerance to
  relocate collisions. Inserts use the playhead's first free compatible unlocked track; only an
  occupied set of compatible tracks or the explicit below-last-row zone creates another track.
- **One video element per clip in the editor.** `video-element-registry.ts` is shared by the
  playback engine and canvas overlay, with consumer-scoped ownership. The engine plays that element
  for picture + sound; the overlay paints its frames and seeks only for scrubbing/entry/drift. Never
  create a second hidden video for canvas drawing, and never let one consumer's teardown destroy the
  other's element. Same-id `src` changes must reload the shared element.

- **Gesture commits and history stay immutable.** Static drag frames batch every moved node into one
  current-output-only write through `updateElementsEphemeral`; `commitElementGesture` then applies
  linked edits once and pushes one Undo. Transform frames synchronously bake Konva scale into geometry,
  throttle only their ephemeral store writes, and commit through `updateElement` plus ONE `pushHistory`.
  Node snapping is likewise synchronous during `dragmove`; rAF is only for guides/HUD and store writes,
  so same-frame release commits the snapped position. Static and video gestures bracket their work with
  `beginGesture`/`endGesture`, which suppresses autosave and collaboration broadcast until the final
  write. The shared video Transformer does not open a second hold: the clip overlay owns it, releases
  it when the target is deleted, leaves the playhead, unmounts, or finishes, and uses per-gesture tokens
  so an earlier async commit cannot clear or suppress a newer drag. Static drag start also selects an
  unselected target through the normal group-aware handler. Remote documents received during a hold
  preserve dragged/selected elements' and clips' local geometry and keyframes while accepting all other
  remote changes; normal release then reconciles and broadcasts the merged document once. History stores
  immutable document references with structural sharing, never JSON-cloned snapshots: every edit must
  replace the affected document/output/element/clip objects and must never mutate an object reachable
  from an earlier snapshot. Materialized-save adoption keeps the `history` ARRAY identity for paid async
  result guards, replacing its current snapshot only when that snapshot is exactly `sentDoc`; a silent
  edit therefore keeps its pre-edit Undo snapshot. Saved indices become `-1` when branching or eviction
  discards the saved doc.

- **Autosave adopts materialized assets.** Create/update responses carry the validated document with
  large inline rasters replaced by stored URLs. `designer-autosave.ts` adopts that document only when
  the captured design id, document reference, name, and `designSession` are current, without a history
  entry. `reset`/`loadDesign` bump that session; first-create promises are scoped to their new-design
  queue/session, and an ID-less intermediate request is skipped once creation has installed an ID, so
  slow or silent first saves cannot POST duplicate rows. An in-flight edit always wins and is
  materialized by the next save. Automatic writes are serialized per design and coalesced by document
  reference AND name; a stalled design never blocks another design, and switching designs does not
  discard queued work. Idempotent update PUTs have a 30-second timeout; create POSTs are not blindly
  timed out and retried because their server outcome may be uncertain. Manual Save bypasses retry pause, idle
  capture, and queued writes (joining an identical write only before its network request starts), and
  returns `persisted`/`skipped`/`failed`; missing-ID, skipped, and failed results produce a failure
  toast, while a successful PUT remains `persisted` even if a newer local edit stays dirty. Failed
  manual writes reschedule retry. Retry timers/counters are per design, one design's success cannot
  cancel another's retry, and idle queues plus bounded state maps are pruned. Stale responses never
  adopt or mark clean a newer live document; if an older same-design request settles after a newer
  successful write, the newest successful document is sent again to restore server ordering. Static
  preview capture receives the exact captured doc, shares one task per doc, runs after idle for
  autosave, and is promoted to immediate work by manual Save; stale uploaded File rows are trashed,
  and name-only saves reuse the persisted preview. Video saves still omit client snapshots. Create
  and update saves drive the Saving indicator, including the first create.

- **Animated stock stickers are video media.** `stock-stickers.tsx` marks an MP4 pick as `type: 'video'`;
  video-mode `onInsertMedia` must route that pick through `addMediaToTimeline` (real duration/dimensions,
  `mediaType: 'video'`, playback/seek/poster/export), never `addImageClipToTimeline`. Animated stickers
  use the static-sticker sizing rule too: contain within 80% of the canvas without upscaling a small
  source rendition. Ordinary videos still contain-fit to the full canvas. Static stickers remain image
  clips, and existing `fileId` references pass through unchanged.

- **Stock vectors and icons.** Pixabay vector searches omit blank `q`, cache for 24 hours, and
  prefer `vectorURL` with the documented raster fallback. Only actual SVG URLs are rasterized into an
  owned PNG File before insertion; raster fallbacks use ordinary URL import without upscaling.
  Icon wrappers set both `fill` and inherited `color`, so outline
  artwork using `stroke="currentColor"` follows the selected fill in Konva, server PNG/PDF and SVG export.

- **Effects, warp and text metrics are SHARED code, not two implementations.** `designer-doc/`
  carries the painter (`layer-style-render.ts`), the deformation (`warp.ts`), the fitter
  (`fit-text.ts` — which owns `textTransform`, because case changes what a line measures), the
  filter stack (`filter-pixels.ts`), the curved-text arc (`curved-text.ts`) and the SVG path parser
  (`svg-path-parse.ts`); the canvas and `design-render.service` both call them. Adding a lookalike copy on
  one side is how the two renderers drift — that is exactly how seven layer styles ended up drawing
  in PDFs and nowhere else. Video text has its own Konva-authoritative wrapper/painter,
  `video-text-layout.ts`: paragraphs, long-token splitting, fixed-box overflow, one-fontSize line
  height, centred baselines and justified offsets. The frame script receives it through
  `videoTextLayoutSource()`; never reintroduce a second `wrapText` there. Shape clips use the same
  `buildStyleGradient` and `gradientFillProps` as image shapes. Text and compatible caption clips use
  those same gradients plus optional v14 `textStroke`; the shared Inspector exposes solid/multi-stop
  fills and outline color/width. Chromium strokes before filling through `drawVideoText` with Konva's
  miter limit 2, composites the resulting text/caption bitmap once at transition opacity, and Konva uses
  `fillAfterStrokeEnabled`; posters project both fields to static text. Static 3D is an `extrusion` layer
  style rendered from the layer alpha; text clips use optional v12 `textExtrusion`. Both derive
  offsets from the bounded `text-extrusion.ts` module (depth ≤200), which is injected into the frame
  script and projected onto the poster as an extrusion style. Animation presets live in
  `text-animation-presets.ts`, grouped into entrance/emphasis/exit, and write only the existing
  keyframe/reveal channels — never a parallel animation model. Zoom/pulse frames compensate x/y to
  preserve the center and scale fontSize on text/caption clips. Exit frames are clamped at zero and
  re-anchored to the new duration by `updateClipSilent` when a timing edit changes a matched exit.
  Multi-select text effects compute each element's own path and commit one history entry.
- **Preset previews are transient, never edits.** Text styles/effects and photo frames store scoped
  `previewPatches` outside `doc`; only the interactive canvas passes them to `CanvasElements`, which
  merges them into Konva render props. Save, duplicate, history, async writes, collaboration, export,
  thumbnails and server payloads always read the base document. Mouse leave/unmount clears only the
  projection, real edits/history cancel it, clicks commit once, and ending a preview re-arms a dirty
  autosave without suspending base-document saves or retries. Command and shortcut dispatch
  synchronously flushes an active projection to the stage before any live-stage read. Resets clear
  only their own effect/mask. Styles scale from the canvas type basis, preserve colors and rich-run
  typography, await the target font before measuring, and shrink feature-grown boxes only back to
  the height remembered before the first growth, never below their authored height. Effects never rasterize
  text or add hit-blocking layers; a Paint layer listens when it has either `src` or a live buffer.
  Snap uses the nearest guide at 6 screen px (`6 / zoom`), but uses multi-selection bounds only when
  the dragged node belongs to that selection; equal-spacing classification uses 2 document px.
  Add-format/resize shares text-stack/panel frames: a safe-zone shift moves every member together,
  with per-element fallback on an oversize axis. Contain media keeps its target fit and centers only
  axes that were centered or spanned at least 95% of the source, preserving edge origins on other axes.
  Small logos retain uniform frame scaling.
- **QR codes are ordinary raster media plus editable settings.** `qr-code.ts` uses the frontend's
  `qrcode` dependency to make a 1024px PNG data URL, stored in the existing `src` on an image element
  or still-image clip. Optional-additive doc v13 `qr` preserves value, six-digit colors, L/M/Q/H error
  correction and a 0–8 quiet zone for the shared Inspector editor. The editor generates a debounced
  live preview for independent foreground/background edits, with one Apply history commit. `qrCodePatch` clears `fileId` and
  derived media when regenerating pixels, and every media-replacement path clears `qr`; never retain
  settings from a different image. Smart-filter rebakes produce derived pixels of the same QR code,
  so both static and clip rebake paths preserve `qr` while replacing the underlying media clears it.
  Do not add a QR element type or renderer — Konva, node-canvas, the
  frame renderer, SVG, previews, Files and `.pdesign` all use the existing raster source and document fields.
- **node-canvas is not a browser canvas.** `ctx.filter = 'blur(…)'` is accepted and ignored, and
  `ctx.scale()` does not condense glyphs — text is rasterised at the font size with only the origin
  moving. `blurCanvas` therefore uses the browser's native filter when available and retains its
  pixel-space three-pass fallback for node-canvas; text still needs a squeezed rendered bitmap.
  The native path resets compositing to `source-over` and alpha to 1 inside its save/restore block.
  Styled layers also reuse one inner bitmap for under/over effects instead of recapturing per style.
  Server rendering yields between layers, and an oversized requested pixel ratio is reduced to fit
  the 16384px canvas bound instead of cropping the page. A visual effect that "works locally" and
  not in an export is almost always this platform split.
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
  box height the overflow line is dropped, truncating the string. `fonts.ts` awaits each injected
  stylesheet before calling `document.fonts.load`, and `canvas.tsx` then forces a re-measure. Calling
  `document.fonts.load` immediately after appending the link races the stylesheet and preserves the
  fallback layout. Anything that changes the font stylesheet depends on this ordering.
- **The font catalog is written down three times** — `designer/fonts.ts`, the `@import` in
  `app/global.scss`, and `CURATED_FONTS` in `font-loader.service.ts`. A family missing from the
  second renders as Arial; missing from the third exports as sans-serif. `font-catalog.drift.spec.ts`
  fails the build if they disagree.
- **Brand Studio owns every brand.** `/brands` is the editor-facing management surface for voice,
  colors, fonts, logos, reference imagery, preferred formats, associated templates, intro/outro,
  enforcement, and brand-scoped Knowledge; `/settings/ai/brands` only redirects legacy links.
  `/brands/knowledge` lists/deletes content not assigned to a Brand Kit, including legacy and
  org-wide auto-indexed rows, without exposing brand rows. `useBrands` is the single org-aware SWR
  cache. Editors manage kits; members/viewers are read-only. Only super-admins see deployment
  Knowledge settings; org enablement uses `ai-config:update`.
- **Designer Brand/General selection is one shared context.** `BrandKitProvider` resolves the
  document's `brandProfileId`: string = Brand Mode, `null` = General Mode, absent = legacy default.
  Never independently select the default brand in a panel or silently replace an unavailable explicit
  id. `useBrandColors`, `useBrandFonts`, inspectors, compliance, templates, and preferred formats all
  consume that context. Saving a logo to the kit and placing it on canvas are separate actions.
  Global-modal surfaces that consume it must wrap their children in `BrandKitModalProvider`: the
  modal manager renders outside the Designer's React subtree, so context from the caller is not retained.
  Selected-brand template priority is applied in the repository before pagination, not by sorting
  the loaded page. Brand Studio fetches only referenced file IDs and loads org-scoped template pages
  on demand (`scope=org`), never the whole library on open.
- **Custom font batches are sequential and brand-scoped.** Both the Brand panel and shared family picker accept
  multiple TTF/OTF/WOFF2 files through `useUploadCustomFont(brandId).uploadMany`: validate and post each
  file through the existing single-file endpoint, continue after individual failures, expose
  per-file results, hold one uploading state, and run one final brand-specific custom-fonts SWR refresh. The
  `upload(file)` wrapper remains for single-file callers. Sequential posts are required because
  the endpoint read/modify/writes brand `customFonts` JSON; parallel posts lose entries. Batch
  toasts summarize full/partial success and retain the WOFF2 server-render warning. General Mode
  requests `brandId=null` and resolves one face per family/weight/style in deterministic default-first
  order; Brand Mode resolves only the selected kit. The browser and export use that same rule.
- **Brand actions work in both document modes.** `panels/brand-actions.ts` applies palette/font
  choices to static elements or selected video text/caption/shape clips. `addBrandLogo` preserves
  aspect ratio in static designs and uses `addImageClipToTimeline` for video; never call the
  static-only `addElement` path for video media.
- **Designer AI assistance is bounded and schema-driven.** `DesignerAssistantService` uses the
  governed `AIModelProvider` and Brand style only. `/media/designer-assistant/copy` prompts for and
  validates one root `variants` array containing exactly three alternatives; `/suggestions` prompts
  for and validates one root `suggestions` array containing 2–6 font/color/layout/spacing entries.
  A schema-invalid parsed response gets one correction retry; thrown provider errors do not. Strict
  service-side Zod validation remains the security boundary. Static layout/spacing suggestions may
  carry only semantic `align` or `distribute` actions from `align-distribute.ts`, never coordinates,
  element ids, URLs, or arbitrary doc ops. `designer-assistant-actions.ts` captures the originating
  output/page/selection, rejects stale or video-mode layout actions, and applies all element patches
  with one history entry. The request context is bounded to 50 geometry-only selected elements;
  copy and whitelisted font/color styles continue to work for static and video text/caption clips.
- **Export preflight is scoped, conservative, and non-blocking.** `design-preflight.ts` audits only
  the selected outputs/pages and returns stable element/clip targets for low solid-background
  contrast, unsafe-zone text, structurally missing media, and measured text overflow. Static text
  uses `fit-text.ts`; video text uses `layoutVideoText`. Safe-zone checks use the measured line
  extents, including alignment and static vertical alignment, rather than the full text box. Hidden
  layers are skipped; rotated bounds and solid-shape backdrops are assessed directly, while
  image/gradient/obscured backgrounds and unavailable measurements remain unassessed rather than
  passing or failing guesses. `export-preflight.tsx` displays warnings and targeted unassessed
  reasons with counts; finding and reason clicks navigate to the target and close export.
  Brand enforcement and its admin override retain their existing blocking semantics, while these
  new warnings never block export.
- **Static export failures are staged and resumable.** `export-format.ts` classifies preview, final
  render, and upload failures as HTTP, network, timeout, or abort, and logs only numeric output/page
  coordinates plus format, scale, and status/kind — never document contents, asset URLs, prompts, or
  credentials. Only the idempotent `/media/designs/render` POST gets a 120 s budget and at most one
  retry after 750 ms, for network/timeout or HTTP 502/503/504. Uploads have no render timeout or
  abort signal and never retry automatically. Network/unknown outcomes and HTTP 502/503/504 are
  uncertain: the UI warns the user to check Files and labels the explicit manual action Upload again.
  Every failure retains a manual recovery action, independent of the automatic-retry policy, and a
  manual upload retry reuses its cached blob rather than rerendering. Non-retryable 4xx responses
  preserve sanitized server reasons without retry advice. Quality/scale fallbacks run only after an
  actual blob exceeds 10 MiB.
  `runStaticExportBatch` keeps completed output/page keys, continues after individual failures, and
  reports progress as each task settles. Task identity includes the configuration generation, output,
  page, format, scale, quality, and selected pages/outputs; changing any of them clears completed,
  failed, and pending-upload UI state so stale bytes cannot cross formats. External document edits
  do not reset an open dialog or revoke completed downloads on the done step. Preview/final render
  cancellation is AbortController-backed, but uploads are never aborted by dialog close. Once the
  current upload settles, the remaining queue stops and a cancelled batch returns without a success
  toast, partial completion state, or draft creation. Partial exports stay visible with per-output
  retry and an explicit Use completed exports action; draft
  creation still requires that explicit action when any output failed. Every user-facing reliability
  string, including oversize fallback, retry UI, and plural forms, must have an entry in all 16
  locale catalogs.
- **Video poster state distinguishes effective and generated images.** The export dialog sends
  only an uploaded File path as `posterUrl` and may send the paused playhead as `posterTimeMs`.
  Polling reads `thumbnailUrl` (effective), `generatedPosterUrl` (rendered alternative), `fileId`,
  and `thumbnailTimestamp`; it must never replace a custom selection with the generated JPEG.
  Pre-/post-render uploads share one handler, and post-render rendered/custom changes persist
  through `/files/information` before the UI treats them as saved. Draft media carries the same
  effective thumbnail and timestamp.

Acceptance test for any change here: render the same document through **both** paths and diff them —
a document with a blended group, a clipped adjustment and a layer style is the case that catches
divergence.

## Designer: `.pdesign` import/export

Designs and templates round-trip as a `.pdesign` file — a zip (`fflate`) with `manifest.json`
(type tag `postmill-design`, `formatVersion`, `docVersion`, mode, name) and `doc.json` (the
DesignerDoc verbatim). Build/parse live in `designer-doc/postmill-file.ts`; every parse failure is
a coded `PostmillFileError` so the API can 400 with a distinct message (corrupt, wrong type, newer
file format, newer doc version).

**Format v2 (current) is self-contained and export is ASYNC.** `manifest.json` also carries
`assets` (originalFileId → `{ path, mime, originalName, size }`, bytes in `assets/`) and `fonts`
(`[{ family, weight, italic, path }]`, bytes in `assets/fonts/`). `POST /media/designs/:id/export`
/ `POST /media/design-templates/:id/export` enqueue an uncosted (`creditType: 'none'`)
`provider: 'design-export'` media job (`media/design-export` Inngest event; Redis payload key;
deterministic same-minute event id — the video-render pattern); the Designer polls
`GET /media/designs/export/:jobId` and downloads the completed artifact through a reusable connected
anchor; its blob object URL is revoked only after a 60-second start window, never synchronously after
`click()`. A successful standalone import loads the returned doc and replaces
the current URL's `designId` through the native History API without a full-page navigation; the
search-param effect skips that load when the store already has the same ID. Embedded Designers keep
the import in memory and leave the host route alone. The export activity
(`media/design-export/design-export.service.ts`) pre-flights summed asset bytes against a 1 GB
ceiling, reads each file through its folder-resolved adapter, streams the zip (never `zipSync`)
and lands the artifact via `writeBuffer` + `saveGeneratedMedia`. The media-jobs sweep routes
export jobs to their own event (never the provider-poll path) and fails stuck ones past a 15 min
budget. Import (`POST /media/designs/import`, disk-spooled, 1 GB cap via
`upload/design-import.validation.ts` — NOT `CustomFileValidationPipe`, which rejects zips and
renames files) streams the unzip, re-uploads each bundled asset into the importing org, rewrites
`fileId`/`originalFileId`/`maskFileId` + their paired `/uploads/…` srcs
(`designer-doc/doc-file-refs.ts` `rewriteDocFileRefs`), recreates bundled fonts through the
deduped `addCustomFont`, then runs the stage-1 pipeline: validate → `stripIds` →
`assignIdsAndNormalize` → create a NEW design. **v1 files (no `assets` key) still import exactly
as stage 1** — references verbatim; same-org round-trips resolve, cross-org media shows broken.

## Designer: Bulk Create

`bulk-create-dialog.tsx` is opened from File ▸ Bulk Create for static designs. The shared CSV parser
supports RFC-4180 quoting, escaped quotes, multiline cells, TSV detection, CRLF and BOM input;
duplicate/blank headers, malformed quoting, files over 5 MB and batches over 200 rows are rejected
before enqueue. `designer-doc/bulk-variables.ts` is the one substitution/discovery engine for the
preview, saved variation and renderer: it covers all outputs/pages, rich text, mustache variables,
text/image/color slots and symbol overrides. With no preexisting variables, the dialog's guided
assignment table maps CSV columns directly to text/image/color targets on every output/page and in
reusable symbol definitions (an instance's explicit content overrides still win); applying adds their
slots as ONE undoable edit, then reuses the same preview/batch pipeline. Text
and colour may be assigned in separate passes without replacing either binding. One column may feed
multiple targets, incompatible existing variable kinds are rejected, and existing mustache/slot
bindings remain intact. Before substitution, a colour mustache renders transparent through the shared
`canvasColor` boundary rather than inheriting the canvas's previous fill; a real row replaces it with
the supplied colour. Spreadsheet `=IMAGE("https://…")` cells and recognized Google Drive share links
normalize to direct image sources during substitution; other values stay unchanged. Enqueue validates
every transformed row one at a time, retaining only source metadata, then sequentially preflights
unique row-owned remote raster images through `safeFetch` and PNG/JPEG/WebP magic-byte detection
before creating a job/folder/event. Unchanged template assets, including remote SVG icons, are not
fetched. Remote and inline images are capped at 20 MiB; declared lengths are rejected and unknown or
false lengths are streamed with cancellation on overflow. Errors include the row, spreadsheet path
(for example `rows[2].product_image`) and DesignerDoc path. No files are persisted during preflight,
so an HTML Drive response or blocked URL cannot leave outputs behind. The batch runs
through `DesignBulkCreateService` and creates editable Designs, per-page PNG Files, and one
self-contained `.pdesign` per row. Changed image sources drop stale file identity, derived pixels,
crop/natural-size metadata, default to aspect-preserving `cover` unless the template explicitly
chose another fit, and adopt the persisted image's real dimensions. A per-batch `.pdesign` asset/font cache deduplicates shared reads.
Existing `/uploads/...` substitutions also resolve once per batch; legacy/preventSave objects without
File rows are copied into new org-owned Files, never rejected or deleted on rollback. The batch folder
and ZIP retain every editable archive plus `source/template.pdesign` and the quoted normalized
`source/data.csv`; the completion dialog links every editable Design, Recent Designs, and the PNG +
editable ZIP. PNG output is capped at 128 MB and accounted batch output at 1 GB. Stored entries stream
one at a time through a temporary ZIP file and into the storage adapter's streaming upload; entry
arrays, compressed chunks, and a concatenated ZIP buffer are never retained in memory. Any row or artifact failure
after enqueue rolls back every design, imported/generated file, editable archive, and source artifact
rather than calling a partial batch complete. Never substitute a client-only flattened image for the
editable result.

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
