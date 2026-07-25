---
name: new-inngest-job
description: Add a background job, scheduled task, cron job, Inngest function, or event-driven worker to Postmill. Use when asked to create periodic sweeps, per-org fan-outs, delayed/scheduled work, or handlers for Inngest events.
---

# New Inngest Job

Wire a new durable background function into Postmill's Inngest pipeline: activity (logic) → factory (trigger) → module/service registration.

## Read first
- `agents/jobs.md` — the full rulebook: architecture, function catalog, idempotency patterns, testing recipe (§4 is this skill's source).
- `agents/backend.md` § 5 — the same 5-step recipe in brief, plus layering rules activities must obey.
- `agents/testing.md` — Vitest conventions for the specs you will add.

## Procedure
1. **Domain logic in an activity.** Add/extend a method on the matching `@Injectable()` in
   `libraries/nestjs-libraries/src/inngest/activities/<domain>.activity.ts` (e.g. `PostActivity`,
   `AnalyticsActivity`). New domain → new `*.activity.ts`. Activities call repositories/services —
   never Prisma directly; new services the activity needs go in the **activity's** constructor.
2. **Event schema (event-triggered only).** Add the event to `InngestEvents` in
   `libraries/nestjs-libraries/src/inngest/inngest.types.ts` — the client is schema-validated
   (`new EventSchemas().fromRecord<InngestEvents>()`), so unknown event names fail to compile.
3. **Factory.** Create `apps/backend/src/inngest/functions/<name>.ts` exporting
   `createX(activity, runRepo?)` that returns
   `inngest.createFunction({ id: '<new-unique-id>', concurrency }, trigger, handler)`.
   - Cron trigger: `{ cron: 'TZ=<IANA> <expr>' }` string (e.g. `'TZ=UTC 0 2 * * *'`).
     Event trigger: `{ event: 'my/job' }`.
   - The factory is thin — handler delegates to `step.run('<unique-step-id>', () => activity.method(...))`.
     Zero Prisma/provider calls in `apps/backend/src/inngest/functions/`.
   - Cron sweeps fan out: `step.run('get-org-ids', ...)` then
     `step.sendEvent('fan-out-*', orgIds.map(...))` to a separate event function with its own
     `concurrency` cap. Canonical example: `apps/backend/src/inngest/functions/analytics-collection.ts`.
   - Wrap cron work in `trackRun(step, runRepo, '<functionId>', work)` from
     `apps/backend/src/inngest/functions/track-run.ts` (feeds `/health`); keep trailing
     `step.sleep` outside the wrapped work.
4. **Register the activity** in `libraries/nestjs-libraries/src/inngest/inngest.module.ts`
   `providers` **and** `exports` (lists kept identical).
5. **Thread through wiring.** In `apps/backend/src/inngest/functions/index.ts`: add the activity
   to the `InngestActivities` interface and append `createX(activities.xActivity, ...)` to the
   `createFunctions` array. Then add the activity as a constructor parameter in `InngestService`
   (`libraries/nestjs-libraries/src/inngest/inngest.service.ts`) and pass it into the
   `createFunctions({...})` object — functions are built in the **constructor**, so constructor
   injection is the only path.

Rules that bite:
- **Idempotency ids must be event-unique.** A constant `id` on `inngest.send`/`step.sendEvent`
  lands in the dedupe store and black-holes every later send. Recurring loops and cron fan-outs
  send **no id** (`autopost-process`, `analytics-collection`); once-per-period work uses a
  deterministic content key — `` `email_${sha256(to:subject:html).slice(0,32)}_${minuteBucket}` ``,
  `` `post_${post.id}_repeat_${currentIndex}_${post.createdAt.getTime()}` ``
  (detail: `agents/jobs.md` § 5).
- Emitters in feature code must gate on `isInngestEnabled()`
  (`libraries/nestjs-libraries/src/inngest/inngest.client.ts:11`): events only fire when
  `USE_INNGEST=true` or `'1'`; otherwise sends are silently skipped.
- Errors: `BadBodyError extends NonRetriableError` stops retries;
  `RefreshTokenError extends Error` retries
  (`libraries/nestjs-libraries/src/inngest/errors/`). No function sets a `retries:` option.
- **No `while(true)` poll loops, no `continueAsNew`** — the old orchestrator was removed; loops
  are durable `step.sleep` + self re-emit. Prefer Inngest over `@nestjs/schedule` for anything
  new (sole exception: `SessionCleanupService`).
- Write a factory spec next to the file (`<name>.spec.ts`): `vi.mock` the
  `inngest.client` module, use `captureFunctionHandler` + `createMockStep` from
  `apps/backend/src/inngest/test/step.mock.ts`; assert id, trigger, step ids, activity calls
  (canonical: `analytics-collection.spec.ts`).

## Verify
```bash
vitest run --root apps/backend                          # factory specs
vitest run --root libraries/nestjs-libraries            # activity specs
docker compose -f docker-compose.dev.yaml --profile jobs up -d   # Inngest dev server, UI on :8288
# set USE_INNGEST=true in backend env, restart backend, confirm the function appears at http://localhost:8288
```

## Pitfalls
- Constant event `id` on a recurring/fan-out send → every later emit dedupes into the first and
  reschedules silently never fire.
- Putting logic in the function factory instead of an activity → layering violation and
  untestable; factories contain zero Prisma.
- Forgetting the `InngestEvents` entry in `inngest.types.ts` → schema-validated client rejects
  the event name at compile time.
- Unbounded fan-out: cron does per-org work inline, or the per-org handler has no `concurrency`
  cap → one slow org blocks the whole sweep.
- Registering the activity in `inngest.module.ts` but not threading `InngestActivities` /
  `createFunctions` / the `InngestService` constructor → function never syncs to `/api/inngest`.
- Reaching for `@nestjs/schedule` `@Cron` — Inngest cron is the scheduling path;
  `SessionCleanupService` is the only sanctioned exception.
