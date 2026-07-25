# Agent development docs

This folder is the documentation set for **AI coding agents** working on the Postmill monorepo. It is
written for LLMs: dense, path/symbol-exact, no prose padding. Read the doc for your task **before**
writing code — every recipe here was verified against the codebase.

`docs/` (VitePress site) is for **humans** (users, self-hosters, human contributors). Do not look
there for development guidance; if this folder and `docs/` disagree, this folder wins — and fix the
drift.

Root companions:

- [`AGENTS.md`](../AGENTS.md) — entry point: golden rules, commands, invariants. Read first.
- [`ARCHITECTURE.md`](../ARCHITECTURE.md) — system architecture: layout, request lifecycle, provider
  kernel, data flows, RBAC/sessions.

## Doc index

| Doc | Read this when… |
|---|---|
| [`providers/overview.md`](./providers/overview.md) | Adding or touching **any** provider — kernel essentials + the universal add-a-provider recipe. Read before the domain doc. |
| [`providers/ai.md`](./providers/ai.md) | Adding an AI/LLM provider (OpenAI-compatible fast path or bespoke). |
| [`providers/social.md`](./providers/social.md) | Adding a social channel (OAuth, posting, capabilities matrix, composer component). |
| [`providers/media.md`](./providers/media.md) | Adding a media-generation provider + studio (descriptor, CI registry gate). |
| [`providers/storage.md`](./providers/storage.md) | Adding a storage provider (S3 factory; `StorageProviderType` enum migration). |
| [`providers/shortlink.md`](./providers/shortlink.md) | Adding a short-link provider. |
| [`providers/vpn.md`](./providers/vpn.md) | Adding a VPN/proxy provider. |
| [`providers/contentpack.md`](./providers/contentpack.md) | Adding a premium content pack (BYOK stock media). |
| [`providers/email.md`](./providers/email.md) | Adding an email provider (env-selected, not per-org). |
| [`providers/auth.md`](./providers/auth.md) | Adding a login/auth provider (platform-level, rare). |
| [`ui-standards.md`](./ui-standards.md) | Writing **any** frontend UI — tokens, primitives, modals, toasts, icons, states. |
| [`frontend.md`](./frontend.md) | Frontend structure: routing, SWR/`useFetch`, contexts, error boundaries, dashboard widgets. |
| [`backend.md`](./backend.md) | Any server-side change — layering rules + recipes (controller, DTO, repository, Inngest function). |
| [`libraries.md`](./libraries.md) | Unsure where code lives — import aliases + per-directory tour + "where does new code go". |
| [`database.md`](./database.md) | Changing `schema.prisma` — migration workflow, safety rules, enum additions. |
| [`testing.md`](./testing.md) | Writing/running tests, provider conformance specs, lint, e2e. |
| [`security.md`](./security.md) | Touching auth, encryption, outbound HTTP, secrets — the invariants you must not break. |
| [`jobs.md`](./jobs.md) | Adding or modifying a background job (Inngest function catalog + recipe). |
| [`notifications.md`](./notifications.md) | Sending user-facing email/in-app/push — the `NotificationService` chokepoint. |
| [`campaigns.md`](./campaigns.md) | Working on Campaign Hub (models, services, UTM, share reports). |
| [`billing.md`](./billing.md) | Gating features behind plans, Stripe, metering (402 gate). |
| [`video-rendering.md`](./video-rendering.md) | Touching the video render pipeline. |

## Reading order for common tasks

- **New provider (any domain):** `providers/overview.md` → the domain doc → `database.md` (if an
  enum/model changes) → `testing.md` (conformance specs).
- **New UI page/feature:** `ui-standards.md` → `frontend.md` → `backend.md` (for the endpoint).
- **New REST endpoint:** `backend.md` → `database.md` (if schema changes) → `security.md` (gates,
  DTO validation) → `frontend.md` (SWR consumption).
- **New background job:** `jobs.md` → `backend.md` (Inngest recipe) → `notifications.md` (if it
  notifies).
- **Schema change:** `database.md` → `backend.md` (repository convention).
- **Unfamiliar subsystem:** `ARCHITECTURE.md` → `libraries.md` → the subsystem doc.

## Skills

[`agents/skills/`](./skills/) holds executable **skills** — task-oriented procedures (`SKILL.md`
with YAML frontmatter) that wrap the docs above. When a request matches a skill, follow the skill;
it inlines the load-bearing rules and cites the docs for depth.

| Skill | Use when… |
|---|---|
| [`add-ai-provider`](./skills/add-ai-provider/SKILL.md) | Adding an AI/LLM provider (OpenAI-compatible or bespoke). |
| [`add-social-provider`](./skills/add-social-provider/SKILL.md) | Adding a social channel (OAuth, posting, composer). |
| [`add-media-provider`](./skills/add-media-provider/SKILL.md) | Adding a media-generation provider + studio. |
| [`add-storage-provider`](./skills/add-storage-provider/SKILL.md) | Adding a storage/S3 backend. |
| [`add-shortlink-provider`](./skills/add-shortlink-provider/SKILL.md) | Adding a URL shortener. |
| [`add-vpn-provider`](./skills/add-vpn-provider/SKILL.md) | Adding a VPN/proxy egress provider. |
| [`add-contentpack-provider`](./skills/add-contentpack-provider/SKILL.md) | Adding a premium stock content pack. |
| [`add-email-provider`](./skills/add-email-provider/SKILL.md) | Adding a transactional email provider. |
| [`add-auth-provider`](./skills/add-auth-provider/SKILL.md) | Adding a login/SSO provider (platform-level, rare). |
| [`new-endpoint`](./skills/new-endpoint/SKILL.md) | Adding a REST endpoint / controller. |
| [`new-inngest-job`](./skills/new-inngest-job/SKILL.md) | Adding a background/scheduled job. |
| [`schema-change`](./skills/schema-change/SKILL.md) | Changing `schema.prisma` (models, columns, enums). |
| [`new-ui`](./skills/new-ui/SKILL.md) | Building a UI page/component/form. |
| [`dashboard-widget`](./skills/dashboard-widget/SKILL.md) | Adding a `/dashboard` widget. |
| [`send-notification`](./skills/send-notification/SKILL.md) | Sending user-facing email/in-app/push, or adding a category. |
| [`write-tests`](./skills/write-tests/SKILL.md) | Writing specs, running suites, provider conformance tests. |

## Maintenance

These docs must stay in sync with the code. When you change a convention, contract, registration
step, or invariant described here, update the matching doc **and** any skill that inlines it in the
same change. Cite real paths and symbols; verify before writing.
