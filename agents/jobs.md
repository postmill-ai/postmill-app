# Background jobs: Inngest architecture & recipes

Inngest is **THE** background-job system in Postmill. The previous workflow orchestrator
(Temporal) was removed: there is **no `while(true)` poll loop, no `continueAsNew`, no
task-queue worker process**. All durable execution goes through the Inngest SDK against the
single served endpoint `/api/inngest`.

Cross-references: `agents/backend.md` (module wiring), `agents/database.md` (Prisma models),
`agents/security.md` (env/secrets invariants), `agents/testing.md` (Vitest setup),
`agents/notifications.md` (NotificationService chokepoint used by job side-effects).

## 1. Architecture

| Piece | Path | Role |
|---|---|---|
| Client singleton | `libraries/nestjs-libraries/src/inngest/inngest.client.ts` | `export const inngest = new Inngest({ id: 'postmill' })`; SDK reads `eventKey`/`signingKey`/`env`/`baseUrl` from env automatically (`INNGEST_DEV=1` selects dev mode — v4 defaults to cloud mode). Also exports `isInngestEnabled()` → `USE_INNGEST === 'true' \|\| USE_INNGEST === '1'`. |
| Event types | `libraries/nestjs-libraries/src/inngest/inngest.types.ts` | `InngestEvents` record (`'post/publish'`, `'email/send'`, `'analytics/sync-org'`, …) plus one exported `eventType(name, { schema: staticSchema<...>() })` per trigger event (v4 — the client-level `EventSchemas` was removed; the eventType is passed directly as the function trigger so handlers keep a typed `event.data`). **Add new events here first.** |
| Nest module | `libraries/nestjs-libraries/src/inngest/inngest.module.ts` | Registers all `*Activity` classes + `InngestRunService` + `InngestService` as providers/exports; imports `DatabaseModule`. |
| Function builder | `libraries/nestjs-libraries/src/inngest/inngest.service.ts` | `InngestService` constructor injects every activity and calls `createFunctions({...})`; `getFunctions()` returns the array. Built in the **constructor** (not `onModuleInit`) so `InngestController` (instantiated after) sees the populated list. |
| Function factories | `apps/backend/src/inngest/functions/*.ts` | Each exports `createX(activity, ...) => inngest.createFunction(optsWithTriggers, handler)` — v4 moves the trigger into options as `triggers: [...]`. Wired in `apps/backend/src/inngest/functions/index.ts` via `InngestActivities` interface + `createFunctions(activities)` array. |
| Serve handler | `apps/backend/src/inngest/serve.ts` | `createInngestServeHandler(functions)` → `serve({ client: inngest, functions })` from `inngest/express`. |
| HTTP endpoint | `apps/backend/src/api/controllers/inngest.controller.ts` | `@Controller('/api/inngest')`, `@All()` delegating `req,res` to the handler built in its constructor. Registered in `apps/backend/src/app.module.ts`. |
| Domain logic | `libraries/nestjs-libraries/src/inngest/activities/*.activity.ts` | One `@Injectable()` per domain (`PostActivity`, `AnalyticsActivity`, `CommentsActivity`, `EmailActivity`, `IntegrationsActivity`, `AutopostActivity`, `MediaJobsActivity`, `DigestActivity`, `CampaignActivity`, `RetentionActivity`, `AgentDigestActivity`). Activities use repositories/services; function files contain **zero** Prisma. |
| Run ledger | `libraries/nestjs-libraries/src/inngest/inngest-run.service.ts` | `InngestRunService` → `InngestRunRepository` (`libraries/nestjs-libraries/src/database/prisma/inngest-runs/inngest-run.repository.ts`). See §4. |
| Errors | `libraries/nestjs-libraries/src/inngest/errors/` | `RefreshTokenError` (retryable `Error`), `BadBodyError` (extends `NonRetriableError`), barrel `index.ts`. |
| Test helpers | `apps/backend/src/inngest/test/step.mock.ts` | `createMockStep()`, `captureFunctionHandler()`. See §8. |

**Enable gate:** feature code only sends events when `isInngestEnabled()` is true
(`USE_INNGEST=true` or `'1'`). Emitters check it inline, e.g.
`posts.service.ts:847,887,908`, `email.service.ts:32`, `autopost.service.ts:104`,
`refresh.integration.service.ts:101`, `video-render.service.ts:187`. When disabled,
sends are skipped (email logs and returns `undefined`; no fallback worker).

## 2. Function catalog

All ids below are copied verbatim from `inngest.createFunction({ id: ... })` calls in
`apps/backend/src/inngest/functions/`. Do **not** use the stale ids `post/publish` or
`streak/start` as function ids — those are **event names**; the function ids are
`post-publish-${taskQueue}` and `streak-tracker`.

### Cron functions

| id | Trigger | Concurrency | Purpose |
|---|---|---|---|
| `analytics-collection` | `TZ=UTC 0 2 * * *` | 1 | Daily sweep: fans out `analytics/sync-org` per org, then prunes email logs. |
| `analytics-sync-org`* | event | 5 | *(event-triggered, listed below)* |
| `comments-collection` | `TZ=UTC * * * * *` (minutely) | 1 | Fans out `comments/sync-org` per org; `concurrency:1` + trailing `step.sleep('wait-interval', '${intervalMinutes}m')` throttles to one sweep per configured interval. |
| `missing-post-finder` | `TZ=UTC 0 * * * *` (hourly) | 1 | Finds posts stuck in QUEUE and re-emits publish events. |
| `media-jobs-poll` | `TZ=UTC * * * * *` (minutely) | 1 | Polls pending media-generation jobs; fans out `media/poll-job` per job. |
| `digest-email-daily` | `TZ=America/New_York 0 9 * * *` | — | Fans out `digest/send-one` per opted-in user (id `digest:daily:{userId}:{orgId}:{today}`). |
| `digest-email-weekly` | `TZ=America/New_York 0 9 * * 1` | — | Same, weekly (id `digest:weekly:...`). |
| `agent-digest` | `TZ=America/New_York 0 7 * * 1` | 1 | Weekly agent digest fan-out (`agent/digest-org` per org). Skips unless `AGENT_DIGEST_ENABLED === 'true'`. |
| `campaign-tag-purge` | `TZ=UTC 0 3 * * *` | — | Purges expired campaign tags. |
| `retention-purge` | `TZ=UTC 30 3 * * *` | — | Data-retention purge. |

### Event-triggered functions

| id | Event | Config | Purpose |
|---|---|---|---|
| `analytics-sync-org` | `analytics/sync-org` | concurrency 5 | Per-org analytics: fans out `analytics/sync-integration` per channel (id `analytics:channel:{orgId}:{integrationId}:{today}`), then post snapshots (cursor-paginated durable steps), prune/rollup, shortlink snapshots, side-effects. |
| `analytics-sync-integration` | `analytics/sync-integration` | concurrency 10 | Per-integration channel snapshot, 7 days back (`INTEGRATION_DAYS_BACK`). |
| `analytics-backfill` | `analytics/backfill` | — | Backfill one integration's history. |
| `comments-sync-org` | `comments/sync-org` | concurrency 5 | Per-org comment sync; each webhook/notify step is its own `step.run` (no double-send on retry). |
| `media-jobs-poll-job` | `media/poll-job` | concurrency 15 | Poll one provider media job. |
| `media-render` | `media/render` | `concurrency: { limit: getRenderConcurrency() }` (`VIDEO_RENDER_CONCURRENCY`, default 3) | Local video render (Designer timeline + clip-merge) in a resource-capped Podman container. |
| `send-email` | `email/send` | `rateLimit: { limit: 1, period: '1s' }` (no `key` — one global bucket; a literal key fails CEL registration) | Send one email via `EmailActivity.sendEmail`. |
| `digest-send-one` | `digest/send-one` | — | Send one digest email. |
| `agent-digest-org` | `agent/digest-org` | concurrency 2 | Generate + notify one org's agent digest (two `step.run`s so an ack-loss retry never re-spends on the LLM). |
| `autopost-process` | `autopost/process` | `cancelOn: [{ event: 'autopost/cancel', if: 'async.data.id == event.data.id' }]` | Process autopost, `step.sleep('wait-1h','1h')`, re-emit `autopost/process` (self-loop, **no event id** — a constant id would kill recurrence). |
| `refresh-token` | `integration/refresh-token` | `cancelOn: [{ event: 'integration/refresh-token/cancel', ... }]` | Refresh one integration token; self-chains with `retries` counter in event data, capped at `MAX_REFRESH_RETRIES = 5`; next cycle id `` `refresh_${integrationId}_${randomUUID()}` `` (unique per cycle — a constant id lands in the dedupe store and black-holes the chain). |
| `streak-tracker` | `streak/start` | `cancelOn: [{ event: 'streak/cancel', if: 'async.data.organizationId == event.data.organizationId' }]` | 22h sleep → streak reminder via `postActivity.notifyStreakReminder` (NotificationService, category `streak`) → 2h sleep → streak end. |
| `post-publish-${taskQueue}` | `post/publish` with `if: event.data.taskQueue == "${taskQueue}"` | `concurrency: { limit, key: 'event.data.organizationId' }`; `cancelOn: [{ event: 'post/cancel', if: 'async.data.postId == event.data.postId' }]` | One function per unique provider task-queue (base identifier, e.g. `post-publish-instagram`). Limits derived from `providerModules` (`apps/backend/src/providers.generated`) — the most conservative `maxConcurrentJob` wins when variants share a queue. Handles sleep-until-publish, atomic `claimForPublish`, per-channel publishing, plugs, repeat-post re-emission (id `` `post_${post.id}_repeat_${currentIndex}_${post.createdAt.getTime()}` ``). |

## 3. Patterns

### 3.1 Cron fan-out

Cron does **no per-org work**. It reads org ids in one `step.run('get-org-ids', ...)`, then
`step.sendEvent('fan-out-*', orgIds.map(organizationId => ({ name: '<domain>/sync-org', data: { organizationId } })))`.
The per-org event function runs with its own concurrency cap, so a slow org never blocks the
sweep. Canonical example: `analytics-collection.ts` (mirrored by `comments-collection.ts`,
`agent-digest.ts`, `media-jobs-poll.ts`).

### 3.2 Steps & retries

- Every side effect gets its **own** `step.run('<unique-step-id>', fn)` — memoized, so a
  retry/resume skips completed steps (no double-send).
- **No `retries:` option is set in any function config.** Retry semantics come from:
  Inngest defaults; `BadBodyError extends NonRetriableError` (stop retrying);
  `RefreshTokenError extends Error` (retryable); self-chained loops carrying `retries` in
  event data (`refresh-token`).
- Non-fatal side-effect steps swallow errors: `await step.run(...).catch(() => {})`
  (e.g. `prune-email-logs`, the four side-effect steps in `analytics-sync-org`).
- `step.sleep` between steps is durable (autopost 1h loop, streak 22h/2h, post-publish
  wait-until-publish-date).
- Pure env parses are intentionally **not** wrapped in `step.run` (see `comments-collection`
  `getDaysBack`/`getSweepIntervalMinutes` comment).

### 3.3 Activity pattern

Function factories are thin: `createX(activity)` returns
`inngest.createFunction({ id, triggers: [...] }, ({ step, event }) => step.run(...activity.method...))`.
All domain logic (Prisma via repositories, provider calls, notifications) lives in
`libraries/nestjs-libraries/src/inngest/activities/*.activity.ts` `@Injectable()` classes.
Wiring in function files; logic in activities. Never import Prisma in
`apps/backend/src/inngest/functions/`.

### 3.4 Run ledger

`trackRun(step, runRepo, functionId, work)` (`apps/backend/src/inngest/functions/track-run.ts`)
wraps a **cron** function's work in three memoized steps: `${functionId}:track-start` →
`recordStart` (returns `startedAt` ISO), then on settle `track-complete` / `track-failed`
(the failure path re-throws so Inngest still sees the error). Keep trailing `step.sleep`
**outside** the wrapped `work` so sleep is excluded from the recorded duration.

Backed by Prisma model `InngestFunctionRun` (schema.prisma ~L1938): one row per function
(upsert on unique `functionId`), columns `startedAt`, `completedAt`, `durationMs`,
`status` (`running|completed|failed`), `error`. Bounded — never grows with run count.
Consumed by `HealthService` (`apps/backend/src/services/health.service.ts:131`,
`inngestRunRepository.getAllLatest()`) for `/health`. Used by: `analytics-collection`,
`comments-collection`, `media-jobs-poll`, `missing-post-finder`, `campaign-tag-purge`,
`retention-purge`.

## 4. Recipe: add a new function (5 steps)

Verified against `analytics-collection.ts`. Touch points in order:

1. **Domain logic** — add/extend a method on the matching activity in
   `libraries/nestjs-libraries/src/inngest/activities/<domain>.activity.ts` (e.g.
   `AnalyticsActivity.getAllOrganizationIds`). New domains: create a new `*.activity.ts`
   `@Injectable()`. Activities call repositories/services — never Prisma directly outside
   repositories (see `agents/backend.md`).
2. **Event type + factory** — if event-triggered, add the event to `InngestEvents` in
   `libraries/nestjs-libraries/src/inngest/inngest.types.ts` and export its
   `eventType(name, { schema: staticSchema<...>() })` (type-only schema; pass the eventType
   directly as the trigger). Create `apps/backend/src/inngest/functions/<name>.ts`:
   ```ts
   export const createMyJob = (myActivity: MyActivity, runRepo: InngestRunService) =>
     inngest.createFunction(
       { id: 'my-job', concurrency: 1, triggers: [{ cron: 'TZ=UTC 0 4 * * *' }] },
       // crons are 'TZ=<IANA> <expr>' strings; events: triggers: [myJobEvent]
       async ({ step }) =>
         trackRun(step, runRepo, 'my-job', async () => {
           const orgIds = await step.run('get-org-ids', () => myActivity.getAllIds());
           if (orgIds.length > 0) {
             await step.sendEvent('fan-out-my-job',
               orgIds.map((organizationId) => ({ name: 'my/job-org' as const, data: { organizationId } })));
           }
         })
     );
   ```
3. **Register the activity** in `libraries/nestjs-libraries/src/inngest/inngest.module.ts`
   `providers` **and** `exports` (both lists are kept identical).
4. **Thread through** `apps/backend/src/inngest/functions/index.ts`: add the activity to the
   `InngestActivities` interface and append `createMyJob(activities.myActivity, activities.inngestRunService)`
   to the `createFunctions` array.
5. **Inject in** `InngestService` (`libraries/nestjs-libraries/src/inngest/inngest.service.ts`):
   add the activity as a constructor parameter and pass it into the `createFunctions({...})`
   argument object. New services an activity needs are injected into the **activity's**
   constructor (registered via its own module or `InngestModule`), not the function factory.

If a new emitter sends the event from feature code, gate it: `if (isInngestEnabled()) { await inngest.send(...) }`.

## 5. Idempotency

**Event ids (the `id` field of `inngest.send`/`step.sendEvent`) must be event-unique or
deliberately deterministic — never a constant.** A constant id lands in Inngest's dedupe
store and black-holes every later send (reschedules silently never fire). Real patterns:

- **Recurring loops get NO id or a unique-per-cycle id.** `autopost-process` re-emits
  `autopost/process` with no `id` (comment: a constant id "would dedupe every hourly hop
  against the activation event, killing recurrence"). `refresh-token` uses
  `` `refresh_${integrationId}_${randomUUID()}` `` per cycle.
- **Cron fan-outs get NO id** — each sweep must produce a fresh sync; a stable id would
  dedupe all later sweeps into the first (`analytics-collection.ts:32`).
- **Once-per-period work gets a deterministic content key** so executor retries dedupe but
  later legit sends pass:
  - `email/send` enqueue (`email.service.ts:50`): `` `email_${sha256(to:subject:html).slice(0,32)}_${minuteBucket}` ``
    — body in the digest so two distinct same-minute mails (rotated reset tokens) are not collapsed.
  - Digest fan-out: `` `digest:daily:${userId}:${organizationId}:${today}` ``.
  - Per-integration analytics: `` `analytics:channel:${organizationId}:${integration.id}:${today}` ``.
  - Repeat-post re-emission: `` `post_${post.id}_repeat_${currentIndex}_${post.createdAt.getTime()}` ``
    (creation timestamp, not `startTime`, so the id is stable across retries/memoization).
- **Step ids** (`step.run('<id>', ...)`) must be unique within a function and stable across
  code versions — changing a step id re-runs that step on in-flight resumes.

## 6. Scheduling rule

**Inngest crons are the real scheduling path.** `@nestjs/schedule` exists as the exception:
`apps/backend/src/app.module.ts:37-40` loads `ScheduleModule.forRoot()` only when
`featureFlags.isEnabled('cron')` (`DEV_DISABLE_CRON` env, `feature-flags.service.ts:33`).
The sole `@Cron` user is `SessionCleanupService`
(`apps/backend/src/services/session-cleanup.service.ts`, `@Cron('0 3 * * *')`), which wraps
its sweep in a distributed Redis lock (`acquireLock('cron:session-cleanup', 3600)`) so only
one replica runs it. Prefer an Inngest cron function for anything new — it gives durable
steps, retries, the run ledger, and per-org fan-out for free.

## 7. Local dev

```bash
docker compose -f docker/docker-compose.dev.yaml --profile jobs up -d   # postgres + redis + Inngest dev server
```

- The `jobs` profile starts `postmill-inngest` (`inngest dev -u http://postmill-app:3000/api/inngest`),
  dev-server UI + event API on **http://localhost:8288**. It retries discovery until the
  backend is up, so start order doesn't matter.
- Set `USE_INNGEST=true` in the backend env or events are silently skipped at emit time
  (`isInngestEnabled()`).
- Functions **sync via the served endpoint**: the dev server hits `/api/inngest` (PUT) on
  connect/poll; restarting the backend (or hitting the endpoint) re-registers the current
  `getFunctions()` list. No separate worker process exists — the backend process executes steps.
- `DEV_DISABLE_CRON=true` disables the `@nestjs/schedule` module only; it has **no effect**
  on Inngest crons. To disable Inngest, unset `USE_INNGEST`.
- Health: `/health` surfaces per-cron latest-run status from the `InngestFunctionRun` ledger.

## 8. Testing

Specs live next to the code: `apps/backend/src/inngest/functions/*.spec.ts` (factories) and
`libraries/nestjs-libraries/src/inngest/activities/*.activity.spec.ts` (activities). Run with
`vitest run --root apps/backend` / `vitest run --root libraries/nestjs-libraries`
(see `agents/testing.md`).

Factory-spec pattern (canonical: `analytics-collection.spec.ts`):

1. Mock the client module so no real Inngest connection happens:
   ```ts
   vi.mock('@postmill-ai/nestjs-libraries/inngest/inngest.client', () => ({
     inngest: { send: vi.fn(), createFunction: vi.fn() },
   }));
   ```
2. Capture the handler and invoke it directly:
   `captureFunctionHandler(vi.mocked(inngest.createFunction))` (from
   `apps/backend/src/inngest/test/step.mock.ts`) stores the 2nd `createFunction` arg; call
   `createX(mockActivity, mockRunRepo)` then `getHandler()({ step, event })`.
3. `createMockStep()` executes `step.run(id, fn)` inline (`fn()` immediately), stubs
   `sleep`/`sendEvent`/`waitForEvent`.
4. Assert on three levels: registration (`expect(inngest.createFunction).toHaveBeenCalledWith(
   expect.objectContaining({ id: 'analytics-collection', concurrency: 1,
   triggers: [{ cron: 'TZ=UTC 0 2 * * *' }] }), expect.any(Function))`), step ids
   (`expect(step.run).toHaveBeenCalledWith('get-org-ids', ...)`), and activity calls
   (`expect(analyticsActivity.getAllOrganizationIds).toHaveBeenCalled()`).

Activity specs are plain service tests (mocked repositories); `inngest-run.repository`
has an integration spec (`inngest-run.repository.int-spec.ts`, run via
`pnpm run test:int`).

## Checklist

- [ ] Event added to `InngestEvents` in `inngest.types.ts` (event-triggered functions).
- [ ] Domain logic in `activities/*.activity.ts`; **no Prisma/provider calls in `apps/backend/src/inngest/functions/`**.
- [ ] Factory `createX(activity...)` in `apps/backend/src/inngest/functions/<name>.ts` with a **new unique function id** (never reuse `post/publish`-style event names as ids).
- [ ] Cron trigger uses `'TZ=<IANA-zone> <cron-expr>'` string form.
- [ ] Every side effect in its own `step.run('<unique-stable-step-id>', ...)`; trailing `step.sleep` outside `trackRun`.
- [ ] Event `id` field: absent for recurring/fan-out sends, or deterministic content key (`digest:...`, `email_<sha>_<bucket>`) — never a constant.
- [ ] Cron functions wrapped in `trackRun(step, runRepo, '<functionId>', ...)` (feeds `/health`).
- [ ] Activity registered in `inngest.module.ts` providers **and** exports.
- [ ] `InngestActivities` + `createFunctions` updated in `functions/index.ts`; constructor param added in `InngestService`.
- [ ] Emitters gated with `isInngestEnabled()`; `USE_INNGEST=true` set for local dev.
- [ ] Factory spec written with `vi.mock` on `inngest.client` + `captureFunctionHandler`/`createMockStep`; asserts id, trigger, step ids, activity calls.
- [ ] New function appears in the Inngest dev UI (http://localhost:8288) after backend restart.
- [ ] Did NOT add `@nestjs/schedule` `@Cron` for new work — Inngest cron instead.
