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
- **Pages are slides WITHIN one output (doc v8, image mode only).** `output.children` IS page 1;
  `output.pages[0..n]` are the extra pages (`{ id, name?, background?, children[] }` — no size:
  pages inherit their output's canvas, capped at `MAX_PAGES_PER_OUTPUT`). Shared accessors live in
  `designer-doc/designer-doc.pages.ts` (`pageChildren`/`withPageChildren`/`pageBackground`) — never
  read `output.children` directly in an editing surface. Linked-edit (`originId`) propagation across
  outputs is a PAGE-1-only behavior; per-page edits stay local. Video outputs reject `pages` in the
  schema. The store tracks `currentPage` (editor state, reset/clamped on output/history changes);
  `DesignRenderService.renderPage(doc, outputIndex, opts, pageNumber)` renders one page and
  `renderPdf` flattens all pages of all outputs sequentially. Server-persisted snapshots of the
  whole doc live in the `DesignVersion` table (`/media/designs/:id/versions*`) — the versions panel,
  not the in-memory History panel; restore takes an `auto` safety snapshot server-side first.
- **Video outputs have variants too.** The `+` add-format flow works in video mode: a new output
  CLONES the current output's tracks/clips with fresh ids and smart-reflows the geometry onto the
  new canvas via `designer-doc/video-reflow.ts` (clips map onto pseudo-elements and go through
  `smartReflow` — timing, fps and durationMs are invariant). Repeated presets and custom dimensions
  are allowed in both document modes; the store disambiguates names (`Name 2`, `Name 3`, …) and
  enforces `MAX_OUTPUTS`. `originId` on `VideoClip` links sibling
  clips across variants: content/style edits propagate through `applyLinkedVideoClip`
  (`apply-linked.ts`), geometry and timing stay local (`VIDEO_CLIP_LOCAL_KEYS`). The same branches
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
  copies use fresh ids without shared `originId`s for static pages/elements and video clips, so
  carousel content edits stay local. The store and headless `addOutput` op both accept
  `linkContent: false`; omitting it preserves linked behavior, and Undo adds/removes the whole format.
- **Pathfinder is multi-shape and atomic.** Two or more unlocked shapes/paths/icons compute fully
  before one document commit. Unite merges every region, Minus Front subtracts every later shape
  from the first, Intersect is successive, Exclude keeps odd-coverage regions, Divide emits unique
  regions, and Outline removes fills. Disjoint results survive and are all selected; unsupported
  holes make no edit. One Undo restores every input. Axis-aligned rectangles sharing a horizontal
  strip use the exact interval path in `path-boolean.ts`.
- **Design/template previews are best-effort, never save blockers.** Video saves render through
  `DesignPreviewService`; image saves use that server renderer when no client thumbnail arrives.
  Org-owned background `fileId`s resolve through the folder storage adapter before the remote URL,
  and failed remote image loads are evicted so a later save can recover. `.pdesign` export also renders
  when its source has no resolvable preview and then triggers targeted healing of the latest source.
  A render failure keeps the previous preview, and preview replacement cleans up only the old File
  row it actually replaced.
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
- **Mobile workspace uses the same store and tool registry.** `mobile-designer-tools.tsx` provides
  prominent quick actions and inline, non-modal Tools/Brand sheets; it never forks editing behavior.
  The Inspector participates in layout at half or expanded height instead of covering the canvas,
  with collapse, accessible snap buttons, and a pointer/keyboard drag handle. The main mobile column
  scrolls when expanded panels exceed the viewport, and Brand mounts only in its active layout.
  Mobile keeps design rename and timeline collapse/zoom-to-fit available; desktop adds a direct rail
  Brand button through the same `brandPanel.toggle()` action as the Window menu.
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
  half. The transport's duration stepper uses `setVideoDuration` and the shared 1–180 s cap. Image
  replacement/background removal lives in `clip-media.ts`: preserve editing semantics, update media
  identity/intrinsics, and clear crop/original/smart-filter state. Generation returns a review
  candidate and does not edit the doc; Apply commits once after the before/after dialog. Static
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
  mask and a review dialog. The server prefers reconstruction only through the resolved
  image-to-image default (never a generic text-to-image fallback), falls back to inpainting, and
  composites by mask luminance so unrelated pixels remain original. The Inspector requires both
  background-removal and inpaint availability. Static Apply
  replaces/inserts adjacent layers; still-video Apply uses adjacent tracks. Both commit once, select
  only the subject, and delete the temporary inpaint-mask File. It does not claim moving-subject
  extraction from video footage.
  Outpainting (`outpaint.ts`) uses one prepare/review/Apply candidate flow for selected images and
  whole pages. The dialog owns pending/error state and blocks duplicate requests. Directional Apply
  scales and offsets the element frame to expose the new area; whole-page Apply resizes the output
  and selected image and translates every other layer by the same centering offset in one history
  entry.
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

- **Autosave adopts materialized assets.** Create/update responses carry the validated document with
  large inline rasters replaced by stored URLs. `designer-autosave.ts` adopts that document only when
  the sent document reference and name are still current, without a history entry; an in-flight edit
  always wins and is materialized by the next save. This prevents repeated base64 uploads and hashing.

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
  `buildStyleGradient` and `gradientFillProps` as image shapes. Static 3D is an `extrusion` layer
  style rendered from the layer alpha; text clips use optional v12 `textExtrusion`. Both derive
  offsets from the bounded `text-extrusion.ts` module (depth ≤200), which is injected into the frame
  script and projected onto the poster as an extrusion style. Animation presets live in
  `text-animation-presets.ts`, grouped into entrance/emphasis/exit, and write only the existing
  keyframe/reveal channels — never a parallel animation model. Zoom/pulse frames compensate x/y to
  preserve the center and scale fontSize on text/caption clips. Exit frames are clamped at zero and
  re-anchored to the new duration by `updateClipSilent` when a timing edit changes a matched exit.
  Multi-select text effects compute each element's own path and commit one history entry.
- **QR codes are ordinary raster media plus editable settings.** `qr-code.ts` uses the frontend's
  `qrcode` dependency to make a 1024px PNG data URL, stored in the existing `src` on an image element
  or still-image clip. Optional-additive doc v13 `qr` preserves value, six-digit colors, L/M/Q/H error
  correction and a 0–8 quiet zone for the shared Inspector editor. `qrCodePatch` clears `fileId` and
  derived media when regenerating pixels, and every media-replacement path clears `qr`; never retain
  settings from a different image. Smart-filter rebakes produce derived pixels of the same QR code,
  so both static and clip rebake paths preserve `qr` while replacing the underlying media clears it.
  Do not add a QR element type or renderer — Konva, node-canvas, the
  frame renderer, SVG, previews, Files and `.pdesign` all use the existing raster source and document fields.
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
  box height the overflow line is dropped, truncating the string. `fonts.ts` awaits each injected
  stylesheet before calling `document.fonts.load`, and `canvas.tsx` then forces a re-measure. Calling
  `document.fonts.load` immediately after appending the link races the stylesheet and preserves the
  fallback layout. Anything that changes the font stylesheet depends on this ordering.
- **The font catalog is written down three times** — `designer/fonts.ts`, the `@import` in
  `app/global.scss`, and `CURATED_FONTS` in `font-loader.service.ts`. A family missing from the
  second renders as Arial; missing from the third exports as sans-serif. `font-catalog.drift.spec.ts`
  fails the build if they disagree.
- **Custom font batches are sequential.** Both the Brand panel and shared family picker accept
  multiple TTF/OTF/WOFF2 files through `useUploadCustomFont.uploadMany`: validate and post each
  file through the existing single-file endpoint, continue after individual failures, expose
  per-file results, hold one uploading state, and run one final custom-fonts SWR refresh. The
  `upload(file)` wrapper remains for single-file callers. Sequential posts are required because
  the endpoint read/modify/writes brand `customFonts` JSON; parallel posts lose entries. Batch
  toasts summarize full/partial success and retain the WOFF2 server-render warning.
- **Brand actions work in both document modes.** `panels/brand-actions.ts` applies palette/font
  choices to static elements or selected video text/caption/shape clips. `addBrandLogo` preserves
  aspect ratio in static designs and uses `addImageClipToTimeline` for video; never call the
  static-only `addElement` path for video media.
- **Designer AI assistance is bounded and schema-driven.** `DesignerAssistantService` uses the
  governed `AIModelProvider` and Brand style only. `/media/designer-assistant/copy` prompts for and
  validates one root `variants` array containing exactly three alternatives; `/suggestions` prompts
  for and validates one root `suggestions` array containing 2–6 font/color/layout/spacing entries.
  A schema-invalid parsed response gets one correction retry; thrown provider errors do not. Strict
  service-side Zod validation remains the security boundary, and the shared Inspector panel applies
  text and whitelisted font/color styles only, never model-generated doc ops.
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
`GET /media/designs/export/:jobId` and downloads the artifact File. The export activity
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
assignment table maps CSV columns directly to text/image/color targets on every output/page;
applying adds their slots as ONE undoable edit, then reuses the same preview/batch pipeline. One
column may feed multiple targets, incompatible existing variable kinds are rejected, and existing
mustache/slot bindings remain intact. The batch runs through `DesignBulkCreateService` and
creates editable Designs plus per-page PNG Files and a ZIP; never substitute a client-only flattened
image for the editable result.

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
