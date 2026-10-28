# Changelog

All notable changes to Postmill are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.4.0] - 2026-10-28

### Added

- **fal.ai and Kling AI studios:**
  - **fal.ai studio** at `/media/fal`: FLUX images, Stable Audio, fal-hosted Kling video and Pika video from one fal.ai key. The Settings → Media card that was labelled **Kling** is now **fal.ai** (same provider, same key); `/media/kling` redirects to `/media/fal`, and `/media/pika` keeps using the fal.ai connection.
  - **Kling AI studio** at `/media/kling-ai`: a direct integration with the official Kling AI API using a klingai.com API key, with Kling 3.0 Turbo, 3.0, 2.6 and 2.5 Turbo text-to-video and image-to-video, and Kling V3 / V2.1 images. Its connection test is free.
  - There are now 46 media tools: Designer, AI Designer, 38 provider studios and 6 stock browsers (was 45 and 37).
- **ElevenLabs image and video:** new **Text → Image** (Gemini, GPT Image) and **Text → Video** (Veo 3.1) tabs through the ElevenLabs Image & Video API. Veo 3.1 accepts a start frame, an end frame and up to three reference images. These flows require an ElevenLabs Pro plan; lower tiers see a clear quota error.
- **Designer:**
  - **`.pdesign` design files:** export any saved design or template as a self-contained `.pdesign` file (media and custom fonts bundled) and import one as a new design, including into another organization. Exports run as a background job (`POST /media/designs/:id/export`, `POST /media/design-templates/:id/export`, `GET /media/designs/export/:jobId`); imports go through `POST /media/designs/import` (up to 1 GB). The Files library shows `.pdesign` thumbnails, image/video labels and duration badges, and can import a library `.pdesign` as a new design.
  - **Voiceover on AI Video:** optional narration for AI Video and faceless product videos, with separate visual and voiceover (TTS) providers. The visual and the voiceover land as aligned timeline tracks, and only after the visual succeeds.
  - **Video background removal choice:** **White background**, **Green screen** or **Auto** (organization default) in the clip inspector and the timeline context menu. `lucataco/rembg-video` (products, objects) is now the default; `arielreplicate/robust_video_matting` (people only) remains for green screen.
  - **Copy Link** on completed generation results (studio render queues, `/media/queue`, the Replicate result panel).
- **Template store federation:** new `templates:install` scope and `POST /federation/install-template`, so a trusted template store can push a `.pdesign` into a user's organization. The scope is never granted by default and is re-checked from the stored grant on every call.
- **Provider settings:** AI providers that support a custom endpoint (OpenAI, OpenRouter, Vercel AI Gateway and the OpenAI-compatible family, MiniMax and Qwen Cloud included) show an optional **Base URL** field, non-secret credentials are prefilled when editing, and config modals show the provider's description plus a **Configured** / last-updated status.
- **Replicate:** `lucataco/rembg-video` for video background removal, `kling-v2.5-turbo-pro` for image-to-video, Veo image-to-video with reference images, and per-model capability notes (no audio track, people-only, loose prompt adherence) in the model picker. The Files root is a valid save destination.
- **Reel.Farm:** slideshow results are encoded locally into a silent MP4, with aspect ratio, image fit and seconds-per-slide controls.

### Changed

- **fal.ai:** the retired Kling v1.6 (standard, pro) and v2 Master models are replaced by **Kling v2.5 Turbo Pro** and **Kling v2.6 Pro** for text-to-video and image-to-video. Organization defaults that pointed at a retired model are rewritten to v2.5 Turbo Pro by a one-time boot backfill; in-flight jobs are untouched. Kling 2.6 native audio is optional and off by default. The retired **Pikaffects** control is removed, and Pika 2.2 durations are sent as numbers.
- **Replicate:** `google/veo-3` is replaced by `google/veo-3.1` (retired upstream). `kwaivgi/kling-v2.1` and `kling-v2.1-master` are removed (discontinued upstream); a direct submission is rejected with an actionable alternative. Durations and aspect/reference constraints are model-aware instead of prompt padding, prompts are capped per model (veo-3.1 1024, seedance-1-pro 2000, kling 2500 characters) with a warning, and create-time provider errors reach you verbatim (was a masked 500). `minimax/video-01` image-to-video pins the single upload to `first_frame_image`. Resumed in-flight studio jobs are labelled with their actual model and creation time.
- **HeyGen** is resolved only for avatar (talking-head) generation — its catalog declares text-to-speech and video-avatar only — so ordinary product-video generation no longer routes to a talking-head flow. The connection test probes `/v2/voices` (was the full avatar catalog, which timed out); text-to-speech uses `POST /v3/voices/speech` and completes synchronously; voice pickers render 50 voices at a time with **Show more** and search over the full list.
- **ElevenLabs** text-to-speech defaults to `eleven_multilingual_v2` (was `eleven_monolingual_v1`, retired upstream); the voice catalog is refreshed to current models. The connection test uses the free `GET /v1/user`.
- **MiniMax:** the AI adapter defaults to the international host `api.minimax.io` (was `api.minimax.chat`); China-platform keys use the Base URL field. Video requests no longer send a `callback_url`, use IPv4, and MiniMax `base_resp` errors inside HTTP 200 responses become typed upstream errors (balance and quota included). Image-to-video sends the source as `first_frame_image`; S2V-01 requires a subject reference.
- **Connection tests are free for 14 more media providers** (OpenAI, Replicate, Stability, Runway, Leonardo, Recraft, fal.ai, Black Forest Labs, Ideogram, Together AI, SiliconFlow, Vercel AI Gateway, Azure OpenAI and MiniMax). Previously **Test** billed a real image render when the adapter had no probe. Bedrock checks credential presence only. Testing an unconfigured provider returns **404** (was 500).
- **Voice dropdowns** render at most 50 options and search the full list (HeyGen returns almost 3,000 voices).
- **Compact studios** reset when you switch provider in the Designer's generate dialogs, and `POST /media/studio/:provider/generate` returns **400** when the model is not in that provider's catalog. Studio option labels that come from a matched rule (for example Kling 2.6's "1080p (required for native audio)") are shown as written.
- **Reel.Farm:** the studio and docs state that the public API creates slideshows only; UGC/avatar and greenscreen videos are made in the Reel.Farm app. Failed connection probes are rejected, and terminal failures end the job instead of polling until timeout.
- **Designer:** generated media opened in a new Designer tab is handed over through a 5-minute same-origin store instead of the new tab's query string. Video playback uses one shared media element for timeline and canvas, generated videos are probed and remuxed for reliable seeking, and Designer render assets are served with byte-range support (`GET /media/designs/render-asset/:jobId/:file`).
- **Stored media is classified by content**, not by the job's operation, so a slideshow that completes with a JPG shows as an image everywhere (job list, `/media/jobs/:id`, Designer landing). Thumbnail maintenance reclassifies legacy rows once. AI artifacts are stored with real file extensions (`.mp4`, `.mov`, `.m4v`).
- **Sentry:** production trace sampling is **0.2** on the backend and **0.25** on the frontend (was 1.0 on both); development stays at 1.0. New optional env vars `SENTRY_TRACES_SAMPLE_RATE` and `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` override the trace rate. Uncaught controller errors are now reported to Sentry; provider upstream errors return the structured **502** envelope (provider, kind, settings link) and account-explained ones such as quota, billing and bad keys stay out of Sentry.
- The migration `20261021000000_design_version_creator_setnull` makes `DesignVersion.createdById` nullable with `ON DELETE SET NULL`, so versions a deleted member saved on teammates' designs survive (anonymized) instead of being deleted. It swaps a constraint and deletes no data.
- `.pdesign` export jobs never consume credits. Video file thumbnails are generated in the background on upload and job completion.

### Fixed

- **Designer canvas:** AI-generated videos stored at extensionless `/uploads/…/<hash>` URLs now play on the canvas instead of rendering as a static first frame — clips carry an explicit `mediaType` hint (set by every timeline landing path that knows the type) which the canvas overlay, pixel-ops bake gate and server frame renderer prefer over the URL extension sniff.
- **Replicate Studio:** unset optional form fields ('' / null / undefined) are no longer sent to the provider (fixes a spurious `end_image requires mode 'pro'` on image-to-video), and a set `end_image` forces `mode: 'pro'` when the schema has a `mode` field. `$ref`-inlined schema components now carry their `default`/`description` through, so schema defaults actually seed the form. The Designer-hosted studio seeds `aspect_ratio` from the canvas dimensions (never overriding an explicit Advanced-settings pick). Failed jobs surface the real job error instead of a bare "Generation failed". STT `language` enums render native language names instead of raw BCP-47 codes, and audio file fields (voice clone) offer an in-dialog "● Record" button that uploads the take and fills the field.
- **Designer AI Video dialog:** notes that text rendered inside a generated video is baked in and can't be edited as text afterwards.
- **Designer previews and playback:**
  - Video designs no longer get black thumbnails: server previews use a real poster frame for video clips (including clips saved before they carried a file id), an image clip on a video track uses the image as its poster, and audio-only designs get an explicit audio card.
  - Autosave no longer uploads client snapshots or overwrites a good poster during a throttled or failed render; incomplete renders with unresolved assets are rejected instead of saved black. `POST /media/designs/maintenance/regen-previews` accepts `designIds`, `templateIds` and `forceSourceThumbnails` for a targeted, organization-scoped repair.
  - Playback starts inside the Play click (browsers that require a user gesture no longer leave the video paused while the timeline runs), play rejections are retried instead of swallowed, and a paused video no longer repaints at 60 fps.
  - In-flight generation jobs are re-attached after a reload, timed-out generations link to `/media/queue?job=<id>`, and generated videos keep their duration and dimensions and fit the canvas without distortion.
  - Picking a HeyGen voice or avatar no longer closes the whole Generate Avatar Video dialog, and the voice list no longer requests hundreds of audio previews on open.
- **Media providers:**
  - **fal.ai:** queued video and audio jobs failed with HTTP 405 on the first poll; polling now uses the base fal returns. An exhausted balance is reported as a quota/billing error (was "invalid API key").
  - **Reel.Farm:** slideshow jobs never completed because exports carry slide images rather than a `video_url`; job previews render by the stored file type, so slides no longer show "The video failed to load"; terminal failures keep their details.
  - **HeyGen:** a valid key failed the connection test and emptied the avatar picker because the avatar catalog took longer than 30 s; HeyGen catalog calls get a 120 s budget.
  - **ElevenLabs** and other providers whose error `detail` is an object now show the sentence, not a JSON blob.
  - **Replicate:** riffusion music used the wrong prompt field and failed on long prompts; `robust_video_matting` sent the wrong input field and had no output type; `wan-2.7-videoedit` has a price and a 720p default; organization media-default tunables are filtered against the model schema instead of causing 422s; the chosen video-background model is actually applied; saving an image-to-video-only model as the text-to-video default is rejected with a 400; video background removal and upscale errors show the real provider reason.
  - **Replicate Studio** no longer blocks **Generate** when the Files root is the destination.
  - Media jobs that fail while polling store a structured error with a link to the provider's settings.
- **Settings:** a valid Qwen Cloud or MiniMax key was rejected because the endpoint could not be entered; a 401/403 during **Test** now includes the vendor's own message.
- **Setup gate:** a backend restart during a session no longer strands members on **Finish Setup**: `/user/self` and `/settings/roles/me` retry longer and revalidate on reconnect, and the wizard ejects non-privileged members when the permissions fetch fails.
- **Account deletion:** deleting a member no longer deletes the design versions they saved on teammates' designs.
- **Error reporting:** provider errors were answered with a generic 500 and reported to Sentry because the Sentry catch-all filter matched before the typed exception filters. The typed filters win again, and uncaught 500s are now captured.
- **Files:** video detection is type-based (`.webm`/`.mov` show a poster and play overlay, not a broken image); `.pdesign` exports carry the design's thumbnail; the bundled `ffmpeg-static` binary is installed deterministically again, so video thumbnails and audio probes work on fresh installs.

### Security

- **Dependency advisories:** `next` 16.4.2 (RCE in `use cache`), `@sentry/nextjs` ^10.75.2 (tunnel-route middleware bypass), `dompurify` ^3.4.17 (override), `multer` ^2.5.0, `undici` ^7.30.1, `happy-dom` ^21.0.4, and `@modelcontextprotocol/node` 2.1.1 (override under `@mastra/mcp`, enables request-body and JSON-RPC batch limits).
- `POST /settings/setup/complete` now requires `settings:update` in addition to a session, so a member cannot mark setup done for the whole organization.
- Generated media handed to a new Designer tab no longer places artifact URLs in the query string.

## [1.3.0] - 2026-10-21

### Added

- **Designer video mode** (timeline editor):
  - **Timeline:** filmstrip thumbnails, snapping, markers, cursor-anchored zoom, resizable height, track lock and hide, and caption and sticker tracks.
  - **Multi-track editing:** clips that would overlap are moved or rejected, and you can drag a clip below the last track to create a new one.
  - **Editing power tools:** multi-select, ripple delete, a clip clipboard and multi-move.
  - **Transitions:** fade (through black), dissolve, wipe, zoom and blur.
  - **Animation:** a keyframe editor with property dots, copy/paste and a timeline lane; speed ramping; keyframable clip volume with pitch preservation.
  - **Looks and blending:** a looks preset gallery and native blend modes.
  - **Animation presets:** a real typewriter text reveal, and presets for shape, image and sticker clips.
  - **Captions:** caption editing, transcribe-all, and SRT/VTT import and export.
  - **Text and fonts:** a text section and custom fonts in the clip inspector.
  - **Export:** 720p/1080p/4K and TikTok/Reels/Shorts/YouTube presets, plus loudness normalization (on by default).
  - Renders of up to **180 seconds** (was 60), with parallel frame capture and real progress reporting.
  - Video templates (mode badge, Video category, animated previews), video output variants that reflow the composition to the new format, and CTA lockups that land on the timeline.
- **Designer image mode:**
  - **Pages and history:** multi-page designs, and version history with named snapshots and an automatic snapshot before every restore.
  - **Templates:** the gallery is organized by category, with custom template folders and paging.
  - **Saving:** untitled designs autosave on first edit.
  - **Fonts and color:** custom font upload (multi-weight, also used by server renders), and a full color picker with alpha.
  - **Effects and text:** noise effect, grain and paper background textures, underline and strikethrough.
  - **AI image expansion (outpainting):** **Expand Image (AI)…** through Replicate `flux-fill-pro`, served by the new `POST /media/outpaint`.
- **Provider picker in the Designer's generate dialogs** (image, video, music, voiceover, avatar) with embeddable compact studios. This adds `GET /media/generation-providers?operation=` and an optional `provider` on `POST /media/text-to-speech`.
- **AI Designer video sessions:**
  - The start screen asks for Image or Video before the format lists.
  - Video sessions produce video-ready designs and, when the organization has a video provider, a real generated scene video per variant.
  - AI revise works on video designs, including regenerating media.
  - Voiceover can be recorded in the browser.
- **Setup wizard:** a beginner-friendly LLM step that explains API keys, links to each provider's key page, flags providers with a free tier, and shows the provider's actual validation error.
- **Storage:** cloud storage configurations are mounted automatically when created, and moving a file to a different storage provider copies its bytes across.
- Design previews are rendered server-side, and blank untitled designs older than 24 hours are pruned. `POST /media/designs/maintenance/regen-previews` repairs missing previews.

### Changed

- RBAC: the **member** system role now includes `media:update` and `media:delete`, so members can autosave and maintain the designs and files they create. The boot-time role seeder applies this to existing deployments; no migration is needed.
- **The Sora studio was removed** because OpenAI retired the Sora video API. There are now 45 media tools: Designer, AI Designer, 37 provider studios and 6 stock browsers.
- Replicate lists only models that can actually run. Kling text-to-video now uses `kling-v2.5-turbo-pro`, and video-to-video now uses `wan-2.7-videoedit`.
- Storage: the connection test for Cloudflare R2 and MediaLocker now requires a **Public URL**, so stored files get absolute, downloadable URLs. Existing configurations without one keep serving their files but report a health error until a Public URL is added.
- Video renders: the per-render time budget now scales with frame count and resolution instead of a flat timeout. Timed-out render containers are killed, and render containers no longer use swap. Podman deployments must rebuild the render image.
- `DELETE /files/folders/:id` returns a readable **400** for a non-empty folder (it was 500). `?force=true` deletes it anyway, unfiling its files and re-parenting its child folders.
- Design and design-template routes accept JSON bodies up to 50 MB; the old 100 KB limit rejected large designs. `GET /media/design-templates` accepts optional `page` and `limit`.
- The migration `20261020200424_drop_null_model_media_defaults` deletes media model defaults that were stored without a model and could never resolve. Those organizations fall back to an automatic pick. It is a data-only change and is idempotent.
- Two additive migrations add the `DesignTemplateFolder` and `DesignVersion` tables and a nullable `DesignTemplate.folderId`.
- Bulk CSV import validates every row with the same per-channel checks as the composer, and imports `media_url` into the media library and attaches it. A row whose URL is not public https, can't be downloaded, or isn't an image or video fails with a clear error. Rows for channels that need settings a CSV can't carry (Pinterest board, YouTube title) now fail at import instead of at publish.
- `POST /posts/inbox/bulk-read` only marks comments that still need a reply as handled; ignored and handled comments keep their status. The unread count is org-wide.
- MCP: `allowedScopes` is now a ceiling on the scopes a token can use, instead of a list every token must hold. Only `mcp:read` is required.
- `tools/db/postmill-migrate.sh` runs `prisma migrate deploy` with the image's bundled Prisma CLI against the `postmill` container. It used to run `db push --accept-data-loss` through pnpm, which the runtime image doesn't have. `pnpm run prisma-schema-check -- --file <sql>` now checks that file.
- `.env.example` documents the optional render, retention and AI Designer tunables and the separate LinkedIn Page app credentials. It now shows `VIDEO_RENDER_NETWORK="bridge"` (the code default) and drops the unused `JAMENDO_CLIENT_SECRET`.

### Fixed

- **Video rendering:**
  - Fixed a render outage caused by a payload race, plus problems with audio-mix and mux filtergraphs, cross-origin clip loading and render workdir permissions.
  - Remote clips are downloaded before rendering, and pre-downloaded clips are remuxed for faststart.
  - Clips with no audio stream are skipped in the mix.
  - Hidden-page media pipelines and wedged video elements now fail fast.
  - Timeouts scale with the pixel area.
  - Slideshow frames fit the canvas, and `webp-animated` output files get a real `.webp` extension.
- **Designer, video mode:**
  - Fixed preview repaint, trim, undo and the inspector, which silently rejected edits when a clip's timing was out of range.
  - Dead clips are flagged instead of playing black.
  - Media drops no longer shrink the timeline.
  - Generated images and audio now land on the timeline.
  - Pen and paint tools work.
  - Top-menu items that do nothing in video mode are now disabled.
- **Designer, image mode:**
  - Fixed effect and adjustment caches, shape transform bake, ellipse hit regions, canvas geometry clamps and design names lost on autosave.
  - Fixed an autosave re-entrancy stack overflow; autosave failures now show their reason, and schema traps no longer block saves.
  - Popovers no longer overflow the viewport.
  - Navigation is more responsive.
- **Media providers:**
  - Fixed remove-background, image-edit inputs (data URIs, relative uploads, providers that require public URLs), Replicate (community models, object outputs, a double-decrypted API key, the video catalog and source fields), OpenRouter timeouts and error attribution, and the music, voiceover and slideshow TTS paths.
  - Generation errors show their real reason.
- **Files:** move failures show the real reason; template folders can be deleted and moved on touch devices.
- Free stock search degrades gracefully on network failures instead of returning 500. Sentry triage removed noise from slide requires, upload 400s and aborted requests.
- **Video renders on multi-replica deployments:** pre-downloaded clips are served to the renderer from local disk through request interception, so a load balancer can no longer route an asset fetch to a replica without the files.
- **Account deletion:** `DELETE /users/me` no longer fails with 500 for users who saved a version of a teammate's design or granted a Postmill ID sign-in.
- **AI Designer Expand Image (AI)** resolves Replicate again. A catalog regeneration had dropped its `image-outpaint` category, and the generator now keeps it.
- **Dashboard:** the AI budget attention item uses the organization's own budget cap and alert threshold, falling back to the global cap only when the org has none.
- **Media:**
  - Deepgram transcription defaults to `nova-2`.
  - Stock Videos no longer shows a color filter that Pexels can't apply.
  - Related videos search by the clip's title instead of showing popular clips.
  - The Files panel's **Download** button downloads, and **Open file** opens a new tab.
- **Copy:** the AI provider settings description says **Make Primary**, and the unused Sora translation strings are removed.

### Security

- **Role checks on billing-only routes:**
  - Webhook create and test-ping now require `webhooks:create`.
  - Other mutating routes now require the matching role permission: autopost create, AI media generation, custom fonts and the Postmill agent. Previously they had only the billing gate, so a read-only viewer could use them.
  - An RBAC coverage test now fails any mutating route without a role check.
- **AI Designer WebSocket:** the handshake CSRF check is skipped only when `NOT_SECURED` is set *and* `NODE_ENV=development`. Before, `NOT_SECURED` alone disabled it in any environment.

## [1.2.0] - 2026-10-14

### Added

- **AI Designer reference images now condition generation (img2img).** Reference images attached to a session are passed to the organization's `media/image-to-image` default for the background and hero image slots instead of being reduced to prose cues. The fallback order is image-to-image → text-to-image → stock, and every fallback is disclosed in the delivery note. The OpenRouter (gemini-image family) and Replicate (flux-kontext / flux-dev) media adapters accept a source image; a model that cannot take a reference now refuses rather than silently dropping it. Variant compose, quality-pass and format-expansion stages run three variants concurrently, and a failed generation is retried only when the failure is transient.
- AI Designer: "change the background" revisions now replace the background image (the request was previously dropped silently), and a revision that changes nothing is reported as unsupported instead of re-delivering the same design.

### Changed

- **Postmill is now owned and maintained by Postmill AI Inc.**, which succeeds REAA Technologies, Inc. The contributor license agreements (`ICLA.md`, `CCLA.md`), the documentation footer, the SDK package author and the security-policy scope name the new owner. The `@reaatech/*` packages Postmill builds on are unchanged and are credited in the README Acknowledgements.
- AI Designer: a run now requires a `media/text-to-image` model default. With no default configured, the run is blocked and points to **Settings → AI → Model Defaults**. A default that is configured but can't be resolved, such as a disabled provider, only adds a warning; the run continues with disclosed stock fallbacks. Stock stand-ins are disclosed whenever stock was not the deliberate choice.
- Design and template preview thumbnails and AI Designer intermediate files no longer appear in the **Files** library. `POST /files/upload-simple` accepts an optional `internal: 'design-preview'` marker.
- The root `package.json` version, and with it the OpenAPI `info.version`, now tracks the release version.

### Fixed

- AI: the LangChain generator workflow (the agent's "generate post" tool and autopost utility calls) failed with "Missing credentials" for every provider, because the deprecated `openAIApiKey` field is ignored by `@langchain/openai` 1.4.x. All construction sites now pass `apiKey`.
- Designer:
  - A crash when transforming nodes after a commit (stale Transformer nodes).
  - Text editing: doubled text, font reverting, size entry, gradient fill and justify alignment.
  - The label text of CTA symbols is now editable.
  - Layer effects (outer glow, drop shadow) now render.
  - Image aspect ratio is preserved on insert.
  - The resize popover no longer overflows the screen.
  - Exports download as expected.
  - Video clips added to the timeline get their real dimensions.
- Media: the Designer no longer uploads an orphan preview file every few seconds while editing.
- Team: invited users whose invite cookie had expired (15 minutes) while the 1-hour invite token was still valid were placed in a new personal workspace. The cookie now lasts as long as the token. Refused invite joins are logged, and creating a duplicate user returns 409.
- Storage: saving an R2 configuration without an endpoint returned a 500 and left a broken configuration row. It now returns 400 and rolls back, and the R2 endpoint is required.
- Instagram: common OAuth token-exchange failures now show a specific error instead of "Unknown Error".
- Sentry: requests the client aborted are no longer reported as errors.

### Security

- Closed 14 high/critical dependency advisories (#109).

## [1.1.0] - 2026-09-30

### Added

- **Payment providers.** Billing is now a ProviderKernel domain (`payments`): Stripe is one provider (`payments/stripe@v1`, package `libraries/providers/stripe`) behind a provider-neutral orchestrator (`PaymentsService`), and any provider can be added by implementing the `PaymentsCapability` contract — see `docs/developer-docs/payment-providers.md`. Shipped alongside Stripe: **PayPal** (hosted checkout through the Subscriptions API, `PAYPAL_*`), the **Apple App Store** (`APPLE_IAP_*`) and **Google Play** (`GOOGLE_PLAY_*`) for the upcoming mobile app — the server verifies store purchases (`POST /billing/native/verify`) and consumes App Store Server Notifications / Play Real-time Developer Notifications. The billing pages branch on the deployment's checkout mode (embedded Stripe form, hosted redirect, or app-store copy) and hide affordances a provider lacks (portal, proration, coupons, add-ons, resume). Providers are enabled purely by their `.env` keys; `PAYMENTS_PROVIDER` picks the web-checkout default when several are enabled. New routes: `POST /payments/webhooks/:provider`, `GET /billing/config`, `POST /billing/native/verify` (for app-store purchases), `GET /billing/check/:id?ref=`. Schema: `Organization.paymentProvider`, `Subscription.provider`, `provider` on the webhook ledger (migration `20260921160000_payments_provider_domain`; existing Stripe organizations are backfilled). A daily `payments-expire-canceled` job tears down subscriptions whose scheduled end passed for providers that cannot keep a cancelled subscription alive until period end (Stripe rows are excluded — its own webhook tears them down).

- Organization-wide AI budget: a hard ceiling on total AI spend across all providers (monthly/daily caps + alert threshold), set from the new card at the top of **Settings → AI → LLM Providers** or `PUT /settings/ai/budget`. Enforced independently of per-provider caps — every AI call, including the AI Designer, content pipeline, agent digests and the daily brief, is refused with HTTP 429 (`org_budget_exceeded`) once reached. The usage dashboard now shows the organization's remaining budget. Stored on new nullable `Organization.aiBudget*` columns (migration `20260921130000_add_org_ai_budget_columns`); any cap previously written through the API into the legacy `perOrgCaps` settings slice is migrated on first boot. Previously that endpoint accepted a cap, sent an 80% alert, and never enforced it.

- **Postmill ID ("Sign in with Postmill").** First-party SSO federation: first-party apps (starting with the template store) can authenticate users of any Postmill instance — cloud or self-hosted — and receive verified identity claims (user id, name, email, avatar, and the consenting organization's id, name and role). No client registration or secrets: the client is pinned by a fixed audience and the `FEDERATION_TRUSTED_REDIRECT_URIS` allow-list (default `https://templates.postmill.ai/auth/callback/postmill`, exact match), and the code exchange is public-client PKCE (S256 mandatory). Each instance generates its own RS256 signing key on first use, encrypted at rest — self-hosters configure nothing. New endpoints: `/.well-known/postmill-identity`, `/federation/jwks`, `/federation/authorize`, `/federation/token`, `/federation/userinfo` (GET and POST), and grant list/revoke under `/user/approved-apps/federation`; the approved-apps page gains a "Postmill ID sign-ins" section. Claims are scope-gated (`profile`/`email`/`org` only). Schema: new `InstanceIdentity` and `FederationGrant` tables (migration `20260923094158_postmill_id_federation`). Relying-party contract: `docs/developer-docs/postmill-id.md`. The existing OAuth-app / MCP OAuth flow is unchanged.

- UI languages: **Dutch**, **Indonesian** and **Polish** (16 languages in total), with full catalogs and dayjs calendar locales.

### Changed

- Provider catalog metadata: modules that serve no AI/media/payments default surface (social, storage, shortlink, VPN, email, auth, comms, content packs) now declare `domains: []` instead of the historical `['media']` placeholder, and a kernel spec enforces the rule per module (the Google auth and Vultr storage modules got their own metadata files instead of inheriting the sibling AI module's `['ai']`). `PROVIDERS_INVENTORY.md` gains the auth rows it was missing (apple, facebook, linkedin, x) and the suno media row. No behaviour change — the field is not served over HTTP.
- Payment providers: an organization stays locked to the provider it first subscribed through, even after lapsing (documented; refused cross-provider activations log the operator escape hatch; `GET /billing/config` exposes `org.lockedTo`). Native-only deployments now show never-subscribed workspaces the "purchase in the mobile app" copy instead of web purchase buttons. The nightly expiry job warns about Stripe subscriptions past their scheduled end with no teardown webhook. Payments provider modules declare `domains: ['payments']` in the catalog.
- The billing master switch is "at least one payment provider is configured" (`billingEnabled()`) instead of `STRIPE_PUBLISHABLE_KEY` presence. For a Stripe-only deployment nothing changes: the same three `STRIPE_*` variables enable it. Deliberate normalisation: the public-API "no subscription" check and publish-time subscription checks previously keyed on `STRIPE_SECRET_KEY`; they now follow the same switch, so a deployment that set only the secret key loses those checks and one that set only the publishable key gains them — set both, as documented.
- A Stripe webhook with a bad signature now answers **401** (was 500) on both `POST /stripe` and `POST /payments/webhooks/stripe`; Stripe retries any non-2xx, so delivery behaviour is unchanged — adjust alerting keyed on 5xx.
- Purchase conversion tracking no longer substitutes the plan list price when the provider does not report the charged amount; those payments are simply not tracked.
- Stripe's proration preview no longer requires the price nickname to match (the four other lookups never did); prices are still matched by product name, interval and amount.

### Deprecated

- `POST /stripe` — the Stripe webhook now lives at `POST /payments/webhooks/stripe`. The old route forwards to the same handler and will be removed in a later release; re-point the Stripe dashboard webhook.

### Fixed

- Payment providers: a lapsed app-store subscriber whose expiry webhook was missed (a zombie row with lapsed dunning grace or a scheduled end in the past) can resubscribe again, and the re-bind resets the stale grace marker and deferred downgrade so the new purchase is honoured. Apple: transient verification failures now answer 500 (Apple retries) instead of 401, notifications for another app or the other store environment are acknowledged without action, free introductory offers are reported as trials, and a notification without a UUID gets a deterministic id. Google: a native purchase is verified with one Play read, a push whose token Play now rejects is acknowledged instead of retried for a week, and a push without a message id gets a deterministic id.
- `POST /billing/apply-discount` applied the coupon without waiting for the eligibility check (the check was never awaited); it now honours it.
- Budget-exceeded responses from `/copilot/chat` and the post generator now carry `{ error: 'BudgetExceeded', message }` so the UI shows a friendly message instead of the raw reason string; the message no longer claims the cap is monthly and resets on the 1st.

- Provider errors are attributed to the provider. Every AI/media upstream failure (bad key, quota or billing limit, rate limit, invalid request, outage) is now a typed `ProviderUpstreamError` → HTTP **502** with `{ provider, providerName, kind, upstreamStatus, message, settingsUrl }`, and the UI names the provider ("Google AI Studio reports the account's quota or billing limit was reached…") instead of showing `{"statusCode":500,"message":"Internal server error"}`. Previously a raw AI-SDK error also made Nest replay the provider's HTTP status as Postmill's own — a provider 401 logged the user out, a provider 429 showed Postmill's rate-limit toast. All 36 media adapters, the LLM facade (`generateText`/`generateObject`/`*WithModel`/`languageModel`), the AI routes' catch-alls, the studio render queue and the dashboard/analytics/generator toasts are covered. Sentry only sees provider outages (warning level), not users' key/plan problems.
- AI: system prompts were sent as a parts array instead of a string (LanguageModelV2 shape), which Gemini rejects with `Unknown name "text" at 'system_instruction.parts[0]'` — dashboard brief, structured output and every `system`-prompted call on Google models failed. `generateTextWithModel` / `generateObjectWithModel` also silently dropped their `system` argument, and alt-text vision used the SDK v1 `{type:'image'}` part.
- Copilot `/copilot/chat` crashed with an unhandled `CopilotApiDiscoveryError` for every LangChain-backed provider (Cohere, Together AI, Azure, Fireworks, DeepSeek, xAI, Bedrock, Perplexity, Vertex, Mistral) since `@copilotkit/runtime` 1.69. The chat now runs an explicit agent on the organization's governed model, so the AI budget gate, prompt guardrails and spend telemetry actually apply again (they had been bypassed), and Google organizations use their own credentials instead of an env key. `/copilot/agent` no longer 500s for Azure, Bedrock and Vertex.
- Dates: 57 translated date-format strings (de, fr, it, ru, tr, es, pt, vi) had translated format tokens or unescaped literal words that dayjs could not parse; they now use valid tokens in each language's natural order.
- Signing in from a signed-out browser via an OAuth or Postmill ID consent link now returns to the consent screen after login instead of dropping the user on the dashboard.

### Security

- `POST /billing/native/verify` (mobile store-purchase verification) now carries a 10/min per-IP `@Throttle` instead of relying on the global hourly limit alone — each call costs an outbound App Store / Play verification round-trip.
- Dependency updates close newly published high/critical advisories in undici, brace-expansion, engine.io, `@xhmikosr/decompress`, nodemailer (now v10) and `@nestjs/microservices` (Nest core packages moved together to 11.2.7).
- The Sentry scrubber redacts Postmill ID secrets (`id_token`, `code_verifier`, `posf_` tokens), and tests pin that a `posf_` federation token can never be used as an organization API key.

## [1.0.0] - 2026-09-16

### Added

- Initial public release.
