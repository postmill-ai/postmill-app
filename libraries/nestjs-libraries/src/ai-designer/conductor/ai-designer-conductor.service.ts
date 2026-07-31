import '@postmill-ai/nestjs-libraries/ai-designer/agent-mesh/agent-mesh-env.shim';
import { Injectable, Logger } from '@nestjs/common';
import { dispatchToAgent } from '@reaatech/agent-mesh-router';
import { registryState } from '@reaatech/agent-mesh-registry';
import type { AgentResponse } from '@reaatech/agent-mesh';
import { DesignService } from '@postmill-ai/nestjs-libraries/database/prisma/design/design.service';
import { FileService } from '@postmill-ai/nestjs-libraries/database/prisma/file/file.service';
import type {
  DesignerDoc,
  DesignerOutput,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import { DesignerDocService } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.service';
import type { DesignerDocOp } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc-ops.schema';
import { CHANNEL_PRESETS } from '@postmill-ai/nestjs-libraries/integrations/social/channel-presets';
import { GuardrailViolation } from '@postmill-ai/nestjs-libraries/ai/governance/errors';
import { AiDesignerService } from '../ai-designer.service';
import {
  MAX_INTENT_LENGTH,
  mergeBriefValues,
  sanitizeBriefValues,
} from './brief-values';
import { AiDesignerSaverService } from '../ai-designer-saver.service';
import { AiDesignerComposerService } from '../agents/composer/ai-designer-composer.service';
import { AiDesignerBudgetGuard } from '../guards/ai-designer-budget.guard';
import { AiDesignerSkillRouter } from '../skills/ai-designer-skill-router.service';
import { getDesignSkill } from '../skills/design-skill.registry';
import { AiDesignerInputPolicyService } from '../ai-designer-input-policy.service';
import { raceWithTimeout } from '../util/race-with-timeout';
import { aspectClass, assetKey } from '../util/aspect';
import { DEGENERATE_VIOLATION_PREFIX } from '../util/doc-validator';
import { matchSlotTexts, normalizeSlotText } from '../util/slot-keys';
import { isDeliveredAccept } from '../util/accept-phrases';
import type {
  AiDesignerAgentContext,
  AiDesignerConfig,
  AiDesignerRenderResult,
  AiDesignerRevisePayload,
  AiDesignerSessionState,
  AssetNeedRequest,
  AssetResult,
  DesignBrief,
  DesignPlan,
  FormField,
  RevisionRequest,
  SlotTextMap,
  VisionFinding,
} from '../ai-designer.types';
import { isCopySlot } from '../ai-designer.types';

export interface AiDesignerEmitter {
  toSession(event: string, payload: unknown): void;
  progress(agent: string, phase: string, pct?: number, note?: string): void;
  preview(result: AiDesignerRenderResult): void;
  error(code: string, message?: string, nonce?: string): void;
}

/** Thrown between pipeline steps when the user cancelled the session's run. */
class PipelineCancelledError extends Error {
  constructor() {
    super('Pipeline cancelled');
  }
}

@Injectable()
export class AiDesignerConductorService {
  private readonly _logger = new Logger(AiDesignerConductorService.name);
  // Circuit breaker per (org, agent): one tenant's broken AI provider must
  // never disable AI Designer for other orgs. Half-opens after BREAKER_RESET_MS
  // (a single trial dispatch; success closes, failure re-opens the window).
  // Failure counts only accumulate within BREAKER_FAILURE_WINDOW_MS of the
  // last failure — a stale entry is reset/pruned on the next dispatch, so
  // sporadic failures spread over days never open the breaker and the map
  // cannot grow without bound.
  private static readonly BREAKER_THRESHOLD = 5;
  private static readonly BREAKER_RESET_MS = 60_000;
  private static readonly BREAKER_FAILURE_WINDOW_MS = 10 * 60_000;
  private readonly _breakers = new Map<
    string,
    { failures: number; openedAt: number; lastFailureAt: number }
  >();
  // Per-session pipeline mutex: a second accept/revise while one is executing
  // would race the session-state writes and double the LLM/render spend.
  private readonly _inFlight = new Set<string>();
  // Degradation notes collected by the in-flight pipeline, consumed (and
  // cleared) by handleAcceptPlan so delivery can tell the user what fell
  // back. Keyed by session — concurrent sessions never share notes.
  private readonly _degradationNotes = new Map<string, string[]>();
  // Variant×slot keys already sent to asset regeneration this session (the
  // critic's regenerateAsset fix). ONE attempt per slot: a critic that keeps
  // disliking the imagery must never loop image-generation spend. Keyed by
  // session like _degradationNotes; cleared with the pipeline in _release.
  private readonly _regeneratedSlots = new Map<string, Set<string>>();
  // Per-session abort controller for the in-flight pipeline, so `cancel`
  // actually stops the run (between steps) instead of only rolling back the
  // session state while the pipeline keeps dispatching and rendering.
  private readonly _aborts = new Map<string, AbortController>();
  // Outstanding interactive prompt (form/plan) id per session. The conductor
  // only advances when the reply's `replyTo` matches (plan §5 correlation); a
  // late/duplicate reply to an already-answered prompt is dropped. Entries for
  // abandoned sessions are swept by age once the map grows large (a session
  // resumed later just loses correlation, which `_isStaleReply` treats as
  // "allow" — same as after a process restart).
  private static readonly OUTSTANDING_SWEEP_SIZE = 10_000;
  private static readonly OUTSTANDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
  private readonly _outstanding = new Map<
    string,
    { promptId: string; at: number }
  >();

  private _setOutstanding(sessionId: string, promptId: string) {
    if (
      this._outstanding.size > AiDesignerConductorService.OUTSTANDING_SWEEP_SIZE
    ) {
      const cutoff =
        Date.now() - AiDesignerConductorService.OUTSTANDING_MAX_AGE_MS;
      for (const [key, entry] of this._outstanding) {
        if (entry.at < cutoff) {
          this._outstanding.delete(key);
        }
      }
    }
    this._outstanding.set(sessionId, { promptId, at: Date.now() });
  }

  /** True when `replyTo` does not match the session's outstanding prompt. */
  private _isStaleReply(sessionId: string, replyTo?: string): boolean {
    const outstanding = this._outstanding.get(sessionId);
    if (!outstanding) return false; // nothing tracked (e.g. after resume) → allow
    if (!replyTo || replyTo !== outstanding.promptId) return true;
    return false;
  }

  private _clearOutstanding(sessionId: string) {
    this._outstanding.delete(sessionId);
  }

  /**
   * Cancel the session's outstanding interactive prompt (plan §5 `cancel`) and
   * abort the in-flight pipeline, if any — the next step boundary throws
   * `PipelineCancelledError` instead of continuing to spend.
   */
  cancelOutstanding(sessionId: string) {
    this._clearOutstanding(sessionId);
    this._aborts.get(sessionId)?.abort();
  }

  constructor(
    private readonly _service: AiDesignerService,
    private readonly _saver: AiDesignerSaverService,
    private readonly _skillRouter: AiDesignerSkillRouter,
    private readonly _designService: DesignService,
    private readonly _composer: AiDesignerComposerService,
    private readonly _budgetGuard: AiDesignerBudgetGuard,
    private readonly _fileService: FileService,
    private readonly _policy: AiDesignerInputPolicyService,
    private readonly _docService: DesignerDocService
  ) {}

  private _config(session: { config?: unknown }): AiDesignerConfig {
    return (session.config ?? {}) as unknown as AiDesignerConfig;
  }

  private _brief(session: { brief?: unknown }): DesignBrief {
    return (session.brief ?? { intent: '' }) as unknown as DesignBrief;
  }

  async handleStart(
    sessionId: string,
    ctx: AiDesignerAgentContext,
    config: AiDesignerConfig,
    prompt: string | undefined,
    emitter: AiDesignerEmitter,
    mode: 'chat' | 'prompt' = 'prompt'
  ) {
    const policy = await this._policy.check(
      { values: {}, instruction: prompt },
      ctx.orgId
    );
    if (policy.ok === false) {
      this._emitPolicyError(emitter, policy.reason, policy.message);
      return;
    }
    prompt = policy.instruction;

    // Intake/planning is mutex- and abort-guarded like accept/revise: a
    // concurrent start/message for the same session must not double the
    // planning LLM spend, and `cancel` must genuinely stop the run.
    if (!this._tryAcquire(sessionId)) {
      await this._emitBusy(sessionId, ctx, emitter);
      return;
    }
    try {
      if (mode === 'prompt' && prompt) {
        await this._runPromptMode(sessionId, ctx, config, prompt, emitter);
      } else {
        await this._runChatIntake(sessionId, ctx, config, emitter, prompt);
      }
    } catch (err) {
      if (this._wasCancelled(err)) {
        this._logger.log(`AI Designer intake cancelled for session ${sessionId}`);
      } else {
        // A provider failure must not strand the session in `planning` with no
        // user-visible message (the gateway only surfaces a generic exception).
        await this._recoverFromFailure(sessionId, ctx, emitter, err, 'intake');
      }
    } finally {
      this._release(sessionId);
    }
  }

  async handleMessage(
    sessionId: string,
    ctx: AiDesignerAgentContext,
    text: string,
    emitter: AiDesignerEmitter
  ) {
    const policy = await this._policy.check(
      { values: {}, instruction: text },
      ctx.orgId
    );
    if (policy.ok === false) {
      this._emitPolicyError(emitter, policy.reason, policy.message);
      return;
    }
    text = policy.instruction as string;

    const session = await this._service.getSessionForUser(sessionId, ctx.orgId, ctx.userId);
    if (!session) return;

    const config = this._config(session);

    if (session.state === 'intake') {
      if (!this._tryAcquire(sessionId)) {
        await this._emitBusy(sessionId, ctx, emitter);
        return;
      }
      try {
        if (session.mode === 'chat') {
          await this._runChatIntake(sessionId, ctx, config, emitter, text);
        } else {
          // A prompt-mode session recovered back to `intake` (failed start)
          // has no chat-intake path — treat the message as a fresh prompt so
          // the session is not stranded behind the revise-only default reply.
          await this._runPromptMode(sessionId, ctx, config, text, emitter);
        }
      } catch (err) {
        if (this._wasCancelled(err)) {
          this._logger.log(
            `AI Designer intake cancelled for session ${sessionId}`
          );
        } else {
          await this._recoverFromFailure(sessionId, ctx, emitter, err, 'intake');
        }
      } finally {
        this._release(sessionId);
      }
      return;
    }

    if (session.state === 'delivered' || session.state === 'revising') {
      const activeDesignIds = (session.activeDesignIds ?? []) as string[];
      const targetDesignId = activeDesignIds[0];
      if (targetDesignId) {
        await this.handleRevise(sessionId, ctx, {
          instruction: text,
          targetDesignId,
          nonce: '',
        }, emitter);
        return;
      }
    }

    // Default reply for unsupported free-text mid-session.
    await this._emitText(
      sessionId,
      ctx,
      emitter,
      'conversationalist',
      'I can help revise the design — just describe the change you want.'
    );
  }

  /**
   * Cancel the session's in-flight work and roll only in-flight states back.
   * A delivered (or intake/awaiting_plan) session keeps its state — cancelling
   * after delivery must not orphan `activeDesignIds` semantics by
   * "un-delivering" the session. Returns false when the session does not
   * belong to (org, user).
   */
  async handleCancel(
    sessionId: string,
    ctx: AiDesignerAgentContext,
    emitter: AiDesignerEmitter
  ): Promise<boolean> {
    const session = await this._service.getSessionForUser(
      sessionId,
      ctx.orgId,
      ctx.userId
    );
    if (!session) return false;

    // An intake-phase run (chat classification) is in flight without a state
    // change — remember it so the reply below doesn't claim nothing ran.
    const wasRunning = this._inFlight.has(sessionId);
    this.cancelOutstanding(sessionId);

    const rollback: Record<string, AiDesignerSessionState> = {
      planning: 'intake',
      executing: 'awaiting_plan',
      revising: 'delivered',
    };
    const nextState = rollback[session.state as string];
    if (nextState) {
      await this._service.updateSession(sessionId, ctx.orgId, ctx.userId, {
        state: nextState,
      });
    }

    await this._emitText(
      sessionId,
      ctx,
      emitter,
      'conversationalist',
      nextState || wasRunning
        ? 'Cancelled the current step.'
        : 'Nothing is in progress to cancel.'
    );
    return true;
  }

  async handleFormSubmit(
    sessionId: string,
    ctx: AiDesignerAgentContext,
    replyTo: string,
    values: Record<string, unknown>,
    emitter: AiDesignerEmitter
  ) {
    const session = await this._service.getSessionForUser(sessionId, ctx.orgId, ctx.userId);
    if (!session) return;

    // Correlation: drop a late/duplicate reply to an already-answered prompt.
    if (this._isStaleReply(sessionId, replyTo)) return;
    this._clearOutstanding(sessionId);

    // Shared input policy: size/depth bounds, key validation, and the org's
    // guardrail chain run before anything is persisted or dispatched.
    const policy = await this._policy.check({ values }, ctx.orgId);
    if (policy.ok === false) {
      this._emitPolicyError(emitter, policy.reason, policy.message);
      return;
    }
    values = policy.values;

    const config = this._config(session);

    if (session.state === 'delivered' || session.state === 'revising') {
      // Delivery is conversational now — there is no delivery form to answer,
      // and intake forms are long past. A late submit is a no-op.
      return;
    }

    if (session.mode === 'chat') {
      // Same mutex/abort guard as handleStart: a second form submit while the
      // previous one is planning must not double-dispatch.
      if (!this._tryAcquire(sessionId)) {
        await this._emitBusy(sessionId, ctx, emitter);
        return;
      }
      try {
        // Persist the merged brief only after acquiring the mutex: a rejected
        // busy path must not write the brief (plan §4.5). `questionsAsked`
        // records the submitted FIELD NAMES, not the form's message id — the
        // list drives the stall counter and rides into agent prompts.
        const safeValues = sanitizeBriefValues(values);
        const existing = (session.brief ?? {}) as DesignBrief;
        const brief = mergeBriefValues(existing, safeValues, Object.keys(safeValues));
        await this._service.updateSession(sessionId, ctx.orgId, ctx.userId, { brief });
        await this._runChatIntake(sessionId, ctx, config, emitter);
      } catch (err) {
        if (this._wasCancelled(err)) {
          this._logger.log(
            `AI Designer intake cancelled for session ${sessionId}`
          );
        } else {
          await this._recoverFromFailure(sessionId, ctx, emitter, err, 'intake');
        }
      } finally {
        this._release(sessionId);
      }
    }
  }

  async handleAcceptPlan(
    sessionId: string,
    ctx: AiDesignerAgentContext,
    replyTo: string,
    variantId: string | undefined,
    saveTemplate: boolean | undefined,
    texts: Record<string, Record<string, string>> | undefined,
    emitter: AiDesignerEmitter
  ) {
    const session = await this._service.getSessionForUser(sessionId, ctx.orgId, ctx.userId);
    if (!session) return;

    // Correlation: drop a stale/duplicate accept for an already-answered plan.
    if (this._isStaleReply(sessionId, replyTo)) return;

    // State guard: only a session actually awaiting a plan may execute. After
    // a restart the outstanding-prompt map is empty, so without this a
    // replayed accept on a *delivered* session would re-execute the whole
    // pipeline (duplicate spend + duplicate designs).
    if (session.state !== 'awaiting_plan') {
      await this._emitText(
        sessionId,
        ctx,
        emitter,
        'conversationalist',
        'There is no plan awaiting acceptance for this session.'
      );
      return;
    }

    const brief = this._brief(session);
    const config = this._config(session);

    // Execute the plans the user actually accepted (persisted at plan
    // presentation) — re-dispatching the art director here would generate
    // different plans than the ones shown. `variantId` narrows to one.
    const storedPlans = (brief.lastPlans as DesignPlan[] | undefined) ?? [];
    let acceptedPlans = variantId
      ? storedPlans.filter((p) => p.variantId === variantId)
      : storedPlans;

    if (variantId && acceptedPlans.length === 0) {
      await this._emitText(
        sessionId,
        ctx,
        emitter,
        'conversationalist',
        'That variant is no longer available — please re-request plans.'
      );
      return;
    }

    // Copy the user edited on the plan card. Only entries that match the
    // persisted plans survive — a forged variantId or slot key is dropped
    // silently — and the survivors run through the same input policy as form
    // values before anything is persisted or rendered.
    let editedBrief: DesignBrief | undefined;
    if (texts && typeof texts === 'object' && !Array.isArray(texts)) {
      const kept = await this._validatePlanTexts(texts, storedPlans, ctx.orgId);
      if (Object.keys(kept).length > 0) {
        const mergeInto = (plans: DesignPlan[]) =>
          plans.map((plan) =>
            kept[plan.variantId]
              ? { ...plan, texts: { ...(plan.texts ?? {}), ...kept[plan.variantId] } }
              : plan
          );
        const nextStoredPlans = mergeInto(storedPlans);
        acceptedPlans = mergeInto(acceptedPlans);
        editedBrief = { ...brief, lastPlans: nextStoredPlans };
      }
    }

    if (!this._tryAcquire(sessionId)) {
      await this._emitBusy(sessionId, ctx, emitter);
      return;
    }
    this._clearOutstanding(sessionId);

    await this._service.updateSession(sessionId, ctx.orgId, ctx.userId, {
      state: 'executing',
      // Persist the merged plans so a reload (and the pipeline's own brief
      // write below) keeps the approved copy.
      ...(editedBrief ? { brief: editedBrief } : {}),
    });
    await this._emitText(
      sessionId,
      ctx,
      emitter,
      'conversationalist',
      'Plan accepted. Executing the design (this may take a moment).'
    );

    // Persisted progress row for the gap before the pipeline's first note.
    await this._appendProgress(sessionId, 'composer', 'Starting production…', emitter);

    try {
      const results = await this._executePipeline(
        sessionId,
        ctx,
        config,
        editedBrief ?? brief,
        emitter,
        acceptedPlans.length > 0 ? acceptedPlans : undefined
      );

      // One consolidated degradation note, posted with the delivery below.
      const notes = this._degradationNotes.get(sessionId) ?? [];
      this._degradationNotes.delete(sessionId);

      const activeDesignIds = results.map((r) => r.designId);
      await this._service.updateSession(sessionId, ctx.orgId, ctx.userId, {
        state: 'delivered',
        activeDesignIds,
        // Server-owned record of exactly what this delivery presented — the
        // accept flow's template auto-save scopes to these ids.
        brief: {
          ...(editedBrief ?? brief),
          lastDeliveredDesignIds: activeDesignIds,
        },
      });

      await this._emitDelivery(sessionId, ctx, emitter, results, notes);

      // Explicit plan-level opt-in (the conversational accept flow handles
      // the default auto-save with its own opt-out).
      if (saveTemplate && results.length > 0) {
        const genre = (brief.skillId as string | undefined) ?? undefined;
        const saved = await this._createTemplate(
          ctx.orgId,
          results[0].designId,
          results[0].designId.slice(0, 8),
          genre
        );
        await this._emitText(
          sessionId,
          ctx,
          emitter,
          'conversationalist',
          saved
            ? 'Template saved.'
            : "Couldn't save the template — the design is still available; try again in a moment."
        );
      }
    } catch (err) {
      if (this._wasCancelled(err)) {
        this._logger.log(`AI Designer pipeline cancelled for session ${sessionId}`);
      } else {
        // When every accepted variant failed (the pipeline rethrows the last
        // error), the recovery message carries a sanitized human reason when
        // the cause is recognizable — never the raw error.
        await this._recoverFromFailure(
          sessionId,
          ctx,
          emitter,
          err,
          'awaiting_plan',
          this._renderFailureHint(err)
        );
      }
    } finally {
      this._release(sessionId);
    }
  }

  /**
   * Keep only the plan-card copy edits that match the persisted plans: the
   * variantId must exist in `brief.lastPlans`, the slot key must be one of
   * that plan's copy slots, and each value is bounded (entries capped — the
   * whole map rides into the brief and later prompts). Survivors then run
   * through the shared input policy like any other user free text; a policy
   * rejection drops the edits (the plans execute as presented), it does not
   * block the accept.
   */
  private static readonly MAX_TEXT_EDIT_VARIANTS = 10;
  private static readonly MAX_TEXT_EDIT_SLOTS = 50;
  private static readonly MAX_TEXT_EDIT_LENGTH = 500;

  private async _validatePlanTexts(
    texts: Record<string, Record<string, string>>,
    storedPlans: DesignPlan[],
    orgId: string
  ): Promise<Record<string, Record<string, string>>> {
    const kept: Record<string, Record<string, string>> = {};
    for (const [variantKey, slotMap] of Object.entries(texts).slice(
      0,
      AiDesignerConductorService.MAX_TEXT_EDIT_VARIANTS
    )) {
      const plan = storedPlans.find((p) => p.variantId === variantKey);
      if (!plan || !slotMap || typeof slotMap !== 'object' || Array.isArray(slotMap)) {
        continue;
      }
      const copySlotIds = new Set(
        (plan.slots ?? []).filter(isCopySlot).map((slot) => slot.id)
      );
      const slots: Record<string, string> = {};
      for (const [slotId, value] of Object.entries(slotMap).slice(
        0,
        AiDesignerConductorService.MAX_TEXT_EDIT_SLOTS
      )) {
        if (!copySlotIds.has(slotId) || typeof value !== 'string') continue;
        const trimmed = value.trim();
        if (!trimmed || trimmed.length > AiDesignerConductorService.MAX_TEXT_EDIT_LENGTH) {
          continue;
        }
        slots[slotId] = trimmed;
      }
      if (Object.keys(slots).length > 0) {
        kept[variantKey] = slots;
      }
    }
    if (Object.keys(kept).length === 0) {
      return {};
    }

    const policy = await this._policy.check({ values: kept }, orgId);
    if (policy.ok === false) {
      this._logger.warn(
        `Plan-card copy edits failed the input policy (${policy.reason}); executing the plans as presented.`,
        AiDesignerConductorService.name
      );
      return {};
    }
    return policy.values as Record<string, Record<string, string>>;
  }

  async handleRevise(
    sessionId: string,
    ctx: AiDesignerAgentContext,
    payload: AiDesignerRevisePayload,
    emitter: AiDesignerEmitter
  ) {
    const session = await this._service.getSessionForUser(sessionId, ctx.orgId, ctx.userId);
    if (!session) return;

    // Plan-stage revision: the plan message's Revise button arrives while the
    // session still awaits plan acceptance. Re-run the art director with the
    // instruction instead of rejecting the event.
    if (session.state === 'awaiting_plan') {
      await this._revisePlans(sessionId, ctx, session, payload.instruction, emitter);
      return;
    }

    if (session.state !== 'delivered' && session.state !== 'revising') {
      await this._emitText(
        sessionId,
        ctx,
        emitter,
        'conversationalist',
        'This design is not available for revision right now.'
      );
      return;
    }

    // The instruction is guardrail-checked here so every entry point
    // (websocket, HTTP, MCP, Inngest) gets the same enforcement.
    const policy = await this._policy.check(
      { values: {}, instruction: payload.instruction },
      ctx.orgId
    );
    if (policy.ok === false) {
      this._emitPolicyError(emitter, policy.reason, policy.message);
      return;
    }
    const instruction = policy.instruction as string;

    const activeDesignIds = (session.activeDesignIds ?? []) as string[];
    let targetDesignId = payload.targetDesignId || activeDesignIds[0];
    if (payload.targetDesignId && !activeDesignIds.includes(payload.targetDesignId)) {
      this._logger.warn(
        `Revise target ${payload.targetDesignId} is not in session active designs; falling back to ${activeDesignIds[0]}.`,
        AiDesignerConductorService.name
      );
      targetDesignId = activeDesignIds[0];
    }
    if (!targetDesignId) {
      await this._emitText(
        sessionId,
        ctx,
        emitter,
        'conversationalist',
        'No design is available to revise yet.'
      );
      return;
    }

    if (!this._tryAcquire(sessionId)) {
      await this._emitBusy(sessionId, ctx, emitter);
      return;
    }

    try {
      // Live marker for the classification dispatch — the frontend shows its
      // own instant bubble on send; this replaces it for the silent gap
      // before the conversationalist answers.
      emitter.progress('conversationalist', 'Thinking…');

      const intent = await this._classifyDeliveredChat(
        ctx,
        instruction,
        activeDesignIds,
        session.mode
      );

      // Conversational accept (the removed delivery form's "Looks good"):
      // auto-save reusable templates unless the user asked not to.
      if (intent.kind === 'accept') {
        await this._acceptDelivered(
          sessionId,
          ctx,
          emitter,
          activeDesignIds,
          this._brief(session),
          instruction,
          intent.text
        );
        return;
      }

      await this._service.updateSession(sessionId, ctx.orgId, ctx.userId, { state: 'revising' });

      await this._emitText(
        sessionId,
        ctx,
        emitter,
        'conversationalist',
        `Revising: ${instruction}`
      );

      // The conversationalist's extracted target wins when it names an active
      // design ("make the headline bigger on variant 2"); otherwise the
      // payload target / first active design stands.
      const revisionTarget =
        intent.revision.targetDesignId &&
        activeDesignIds.includes(intent.revision.targetDesignId)
          ? intent.revision.targetDesignId
          : targetDesignId;

      const revised = await this._reviseDesign(
        sessionId,
        ctx,
        revisionTarget,
        intent.revision,
        emitter
      );

      if (!revised) {
        await this._service.updateSession(sessionId, ctx.orgId, ctx.userId, {
          state: 'delivered',
        });
        await this._emitText(
          sessionId,
          ctx,
          emitter,
          'conversationalist',
          'I could not apply that revision.'
        );
        return;
      }

      const results = [revised];
      // Merge, don't replace: the other delivered variants must stay
      // available in the chat. A re-revision of the same design keeps its slot.
      const nextActiveDesignIds = activeDesignIds.includes(revised.designId)
        ? activeDesignIds
        : [...activeDesignIds, revised.designId];
      await this._service.updateSession(sessionId, ctx.orgId, ctx.userId, {
        state: 'delivered',
        activeDesignIds: nextActiveDesignIds,
        // This delivery presented only the revision — a later accept saves a
        // template for it alone, not for every still-active superseded id.
        brief: {
          ...this._brief(session),
          lastDeliveredDesignIds: [revised.designId],
        },
      });
      await this._emitDelivery(sessionId, ctx, emitter, results);
    } catch (err) {
      if (this._wasCancelled(err)) {
        this._logger.log(`AI Designer revise cancelled for session ${sessionId}`);
      } else {
        await this._recoverFromFailure(sessionId, ctx, emitter, err, 'delivered');
      }
    } finally {
      this._release(sessionId);
    }
  }

  /**
   * Plan-stage revision (`awaiting_plan`): re-run the art director with the
   * user's instruction on top of the current brief (which already carries
   * `lastPlans` as context), persist and present the new plans, and stay in
   * `awaiting_plan` — no design exists to revise at this stage.
   */
  private async _revisePlans(
    sessionId: string,
    ctx: AiDesignerAgentContext,
    session: { brief?: unknown; config?: unknown; mode?: unknown },
    rawInstruction: string,
    emitter: AiDesignerEmitter
  ) {
    // Same guardrail enforcement as the delivered/revising path below.
    const policy = await this._policy.check(
      { values: {}, instruction: rawInstruction },
      ctx.orgId
    );
    if (policy.ok === false) {
      this._emitPolicyError(emitter, policy.reason, policy.message);
      return;
    }
    const instruction = policy.instruction as string;

    if (!this._tryAcquire(sessionId)) {
      await this._emitBusy(sessionId, ctx, emitter);
      return;
    }

    try {
      const config = this._config(session);
      const brief = this._brief(session);
      const revisionBrief: DesignBrief = { ...brief, revisionInstruction: instruction };

      await this._emitText(
        sessionId,
        ctx,
        emitter,
        'conversationalist',
        `Revising the plans: ${instruction}`
      );

      // Persisted progress row for the otherwise silent re-planning gap.
      await this._appendProgress(
        sessionId,
        'art-director',
        'Sketching new directions…',
        emitter
      );

      const planResponse = await this._dispatchAgent(ctx, 'art-director', {
        type: 'plan-request',
        brief: revisionBrief,
        config,
        mode: (session.mode as 'chat' | 'prompt') ?? 'prompt',
      });
      const plans = this._parsePlans(planResponse, config);
      if (plans.length === 0) {
        throw new Error('No design plans were generated');
      }

      // Persists lastPlans + a fresh plan message and stays in awaiting_plan.
      await this._emitPlan(sessionId, ctx, emitter, revisionBrief, plans);
    } catch (err) {
      if (this._wasCancelled(err)) {
        this._logger.log(`AI Designer plan revise cancelled for session ${sessionId}`);
      } else {
        await this._recoverFromFailure(
          sessionId,
          ctx,
          emitter,
          err,
          'awaiting_plan'
        );
      }
    } finally {
      this._release(sessionId);
    }
  }

  private async _runPromptMode(
    sessionId: string,
    ctx: AiDesignerAgentContext,
    config: AiDesignerConfig,
    prompt: string,
    emitter: AiDesignerEmitter
  ) {
    await this._service.updateSession(sessionId, ctx.orgId, ctx.userId, { state: 'planning' });
    await this._appendProgress(sessionId, 'art-director', 'planning', emitter);
    const referenceCues = await this._interpretReferences(
      ctx,
      config.referenceFileIds
    );
    const brief: DesignBrief = {
      intent: prompt,
      referenceCues,
      styleId: config.styleId,
    };
    await this._service.updateSession(sessionId, ctx.orgId, ctx.userId, { brief });

    const planResponse = await this._dispatchAgent(ctx, 'art-director', {
      type: 'plan-request',
      brief,
      config,
      mode: 'prompt',
    });

    const plans = this._parsePlans(planResponse, config);
    await this._emitPlan(sessionId, ctx, emitter, brief, plans);
  }

  private async _runChatIntake(
    sessionId: string,
    ctx: AiDesignerAgentContext,
    config: AiDesignerConfig,
    emitter: AiDesignerEmitter,
    text?: string
  ) {
    const session = await this._service.getSessionForUser(sessionId, ctx.orgId, ctx.userId);
    const brief = ((session?.brief ?? { intent: '' }) as DesignBrief);
    const questionsAsked = brief.questionsAsked ?? [];

    // Never auto-advance from intake on a merely-complete brief: extraction
    // can lose specifics the user would only catch on review ("Labor Day
    // Sale, coupon LABOR26" compressed to "social media post"), so planning
    // always waits for the user's green light AFTER the conversationalist's
    // recap (a chat-turn with `recap: true`, persisted as the server-owned
    // `recapShown` gate, then a confirmed turn below). A low-confidence
    // route still goes through the conversationalist's skill-picker form.

    // Persisted progress row for the otherwise silent classification gap
    // (plan §5: progress rows survive reload).
    await this._appendProgress(sessionId, 'conversationalist', 'Thinking…', emitter);

    // The classifier only sees the current message — a one-word answer like
    // "followers" is meaningless without the question it answers. Give it the
    // last assistant message as conversational context (free-text turns only;
    // the form path passes no `text`).
    const lastQuestion = text
      ? await this._lastAssistantQuestion(sessionId)
      : undefined;

    const convResponse = await this._dispatchAgent(ctx, 'conversationalist', {
      type: 'chat',
      text: text ?? '',
      ...(lastQuestion ? { lastQuestion } : {}),
      session: {
        mode: 'chat',
        state: (session?.state ?? 'intake') as any,
        brief,
        questionsAsked,
      },
    });

    const parsed = this._safeJson(convResponse.content) as any;

    // Step boundary: a cancel that landed while the dispatch was resolving
    // must not post a new form/reply for a run the user already stopped.
    this._throwIfCancelled(sessionId);

    if (parsed?.type === 'chat-turn') {
      // Conversational intake: merge the fields the conversationalist
      // extracted from the free text through the same sanitize/merge path as
      // form submits (never trust raw keys), remember which question was just
      // asked (the conversationalist falls back to the form when the same
      // question stalls), then advance or keep the conversation going.
      const safeValues = sanitizeBriefValues(
        (parsed.fields && typeof parsed.fields === 'object'
          ? parsed.fields
          : {}) as Record<string, unknown>
      );
      // Deterministic first-turn intent preservation: when no intent is
      // stored yet and the classifier recognized this free-text turn as a
      // brief (it extracted a non-empty intent), keep the user's RAW message
      // as the intent instead of the classifier's compressed rewrite. The
      // prompt already forbids compression, but that guarantee is
      // probabilistic — a compressed intent silently drops mandated copy,
      // badge instructions, and URLs before the quoted-span / offer-token
      // fidelity checks (which run on intent + fixedCopy) can protect them.
      // The raw text rides the normal merge below, so spoken-URL
      // normalization and quoted-span → fixedCopy extraction apply to the
      // full brief. Later turns answer questions rather than restate the
      // brief, so an existing intent is never overwritten; a turn the
      // classifier did not read as a brief (no extracted intent — greetings,
      // smalltalk) must not become the brief either.
      if (
        !brief.intent &&
        typeof text === 'string' &&
        text.trim() &&
        typeof safeValues.intent === 'string' &&
        safeValues.intent.trim()
      ) {
        safeValues.intent = text.trim().slice(0, MAX_INTENT_LENGTH);
      }
      const asked = this._missingBriefFields({
        ...brief,
        ...safeValues,
      } as DesignBrief)[0];
      const merged = mergeBriefValues(brief, safeValues, asked);
      // The recap gate is server-owned: the conversationalist marks its recap
      // turn with `recap: true`, and only that turn persists `recapShown`
      // (a forged value in client/form input is stripped upstream by
      // sanitizeBriefValues).
      if (parsed.recap === true) {
        merged.recapShown = true;
      }
      // Server-owned degradation counter: consecutive classification failures
      // (`classifierFailed` set by the conversationalist's catch path) mean
      // the org's LLM is likely dead — after three in a row, tell the user
      // ONCE instead of silently looping the same intake turn forever. Both
      // keys are reserved (sanitizeBriefValues strips forged client values).
      const failures =
        parsed.classifierFailed === true
          ? (typeof brief.classifierFailures === 'number'
              ? brief.classifierFailures
              : 0) + 1
          : 0;
      if (failures > 0) merged.classifierFailures = failures;
      else delete merged.classifierFailures;
      const warnLlmDown = failures >= 3 && merged.llmWarningShown !== true;
      if (warnLlmDown) merged.llmWarningShown = true;
      await this._service.updateSession(sessionId, ctx.orgId, ctx.userId, {
        brief: merged,
      });
      if (warnLlmDown) {
        await this._emitText(
          sessionId,
          ctx,
          emitter,
          'conversationalist',
          "I'm having trouble reaching your AI provider — check Settings → AI providers if this keeps happening."
        );
      }

      // Advance to planning ONLY on the user's explicit green light AFTER the
      // recap was shown — a complete-but-unconfirmed brief keeps the
      // conversation going (the recap reply below is the checkpoint).
      if (parsed.confirmed === true && merged.recapShown) {
        await this._runPlanPresentation(sessionId, ctx, config, merged, emitter);
        return;
      }

      if (typeof parsed.reply === 'string' && parsed.reply) {
        await this._emitText(
          sessionId,
          ctx,
          emitter,
          'conversationalist',
          parsed.reply
        );
      }
      return;
    }

    if (parsed?.type === 'form') {
      // A form turn can still carry brief fields the conversationalist
      // extracted from the user's text (e.g. they answered the audience
      // question and the low-confidence skill picker came back in the same
      // turn). Merge them first — dropping them re-asks the very question the
      // user just answered once the form is submitted.
      const safeValues = sanitizeBriefValues(
        (parsed.extracted && typeof parsed.extracted === 'object'
          ? parsed.extracted
          : {}) as Record<string, unknown>
      );
      if (Object.keys(safeValues).length > 0) {
        const asked = this._missingBriefFields({
          ...brief,
          ...safeValues,
        } as DesignBrief)[0];
        const merged = mergeBriefValues(brief, safeValues, asked);
        await this._service.updateSession(sessionId, ctx.orgId, ctx.userId, {
          brief: merged,
        });
      }
      const msg = await this._service.appendMessage({
        sessionId,
        role: 'assistant',
        agent: 'conversationalist',
        kind: 'form',
        content: {
          kind: 'form',
          prompt: parsed.prompt || 'Help me understand what you want.',
          fields: (parsed.fields || []) as FormField[],
          submitLabel: parsed.submitLabel || 'Submit',
        },
      });
      emitter.toSession('message', msg);
      this._setOutstanding(sessionId, msg.id);
      return;
    }

    if (parsed?.type === 'reply') {
      await this._emitText(
        sessionId,
        ctx,
        emitter,
        'conversationalist',
        parsed.text
      );
    }
  }

  /**
   * Required intake fields still missing from the brief: the base three
   * (intent, audience, tone) plus whatever the routed skill demands — a
   * skill's `requiredBriefFields` are collected during intake, not after
   * planning. Returned in ask order.
   */
  private _missingBriefFields(brief: DesignBrief): string[] {
    const routed = this._skillRouter.route(brief);
    const skill = getDesignSkill(routed.skillId);
    const required = [
      ...new Set([
        'intent',
        'audience',
        'tone',
        ...(skill?.requiredBriefFields ?? []),
      ]),
    ];
    return required.filter((field) => !brief[field]);
  }

  /** The most recent assistant text — the question a free-text reply is
   *  answering. Skips forms/plans/progress rows (only plain text carries an
   *  intake question). */
  private async _lastAssistantQuestion(
    sessionId: string
  ): Promise<string | undefined> {
    const messages = await this._service.getMessages(sessionId);
    for (let i = messages.length - 1; i >= 0; i--) {
      const content = messages[i]?.content;
      if (
        messages[i].role === 'assistant' &&
        content?.kind === 'text' &&
        content.text
      ) {
        return content.text;
      }
    }
    return undefined;
  }

  private async _runPlanPresentation(
    sessionId: string,
    ctx: AiDesignerAgentContext,
    config: AiDesignerConfig,
    brief: DesignBrief,
    emitter: AiDesignerEmitter
  ) {
    await this._service.updateSession(sessionId, ctx.orgId, ctx.userId, { state: 'planning' });

    const referenceCues = await this._interpretReferences(
      ctx,
      config.referenceFileIds
    );
    const enriched: DesignBrief = {
      ...brief,
      referenceCues,
      styleId: brief.styleId ?? config.styleId,
    };
    await this._service.updateSession(sessionId, ctx.orgId, ctx.userId, { brief: enriched });

    // Persisted progress row for the otherwise silent planning gap.
    await this._appendProgress(sessionId, 'art-director', 'Sketching concepts…', emitter);

    const planResponse = await this._dispatchAgent(ctx, 'art-director', {
      type: 'plan-request',
      brief: enriched,
      config,
      mode: 'chat',
    });
    const plans = this._parsePlans(planResponse, config);

    await this._emitPlan(sessionId, ctx, emitter, enriched, plans);
  }

  private async _executePipeline(
    sessionId: string,
    ctx: AiDesignerAgentContext,
    config: AiDesignerConfig,
    brief: DesignBrief,
    emitter: AiDesignerEmitter,
    presetPlans?: DesignPlan[]
  ): Promise<AiDesignerRenderResult[]> {
    let plans = presetPlans;
    if (!plans || plans.length === 0) {
      const planResponse = await this._dispatchAgent(ctx, 'art-director', {
        type: 'plan-request',
        brief,
        config,
        mode: 'prompt',
      });
      plans = this._parsePlans(planResponse, config);
    }
    if (plans.length === 0) {
      throw new Error('No design plans were generated');
    }

    // Hard ceiling on executed plans, regardless of where they came from: the
    // DTO caps config.variants at 10, but `brief.lastPlans` is stored JSON —
    // never execute more plans than the session legitimately requested.
    const maxPlans = Math.min(10, Math.max(1, config.variants ?? 1));
    plans = plans.slice(0, maxPlans);

    // Honest-degradation trail: everything that silently fell back below gets
    // one user-facing note at delivery (never one message per note).
    const notes: string[] = [];
    const fallbackCount = plans.filter((p) => p.fallback).length;
    if (fallbackCount > 0 && fallbackCount === plans.length) {
      notes.push('planning ran in fallback mode, so the concepts are generic');
    } else if (!presetPlans && plans.length < maxPlans) {
      // Only a genuine planning shortfall (art-director returned fewer plans
      // than requested) earns this note — a deliberate subset accept
      // (presetPlans present) is not a planning failure.
      notes.push(
        `only ${plans.length} of the ${maxPlans} requested variants could be planned`
      );
    }

    const outputs = this._resolveOutputs(config);
    if (outputs.length === 0) {
      throw new Error('No valid output formats');
    }

    // Persist the routed genre so template tagging (category + doc metadata) and
    // the revise vision re-check can resolve it later.
    await this._service.updateSession(sessionId, ctx.orgId, ctx.userId, {
      brief: { ...brief, skillId: plans[0]?.skill },
    });

    const saveFolderId = await this._resolveSaveFolder(ctx.orgId, config);

    // Persisted phase transition (plan §5: progress rows survive reload).
    await this._appendProgress(sessionId, 'composer', 'executing', emitter);

    emitter.progress('asset', 'Generating shared assets', undefined, 'Generating imagery');

    const assetNeeds = this._collectAssetNeeds(plans, outputs);
    if (assetNeeds.dropped > 0) {
      notes.push(
        `only the ${AiDesignerConductorService.MAX_ASSET_NEEDS} most-needed images were generated — the remaining slots have no generated imagery`
      );
    }
    const assetResponse = await this._dispatchAgent(ctx, 'asset', {
      type: 'asset-request',
      assetNeeds: assetNeeds.needs,
      referenceFileIds: config.referenceFileIds,
    });
    const { assets, wellFormed: assetsWellFormed } =
      this._parseAssets(assetResponse);
    emitter.progress('asset', 'Assets ready');

    // Compare what each asset actually is against what the plan asked for:
    // stock-instead-of-generated and gradient placeholders are degradations
    // the user should hear about. One note per slot — needs are keyed by the
    // variant-scoped slotId, so each plan×slot reports once.
    if (!assetsWellFormed && assetNeeds.needs.length > 0) {
      // The asset agent errored out entirely (non-assets payload) — every need
      // is missing, so one umbrella note instead of one per slot.
      notes.push(
        'imagery generation failed outright — the designs use fallback styling'
      );
    } else {
      const notedSlots = new Set<string>();
      for (const need of assetNeeds.needs) {
        if (notedSlots.has(need.slotId)) continue;
        const asset = assets[assetKey(need.slotId, need.aspect)];
        const briefLabel = need.brief.slice(0, 60);
        if (!asset?.source) {
          // Missing from the map entirely (generate + stock + gradient all
          // failed) — until now this slot vanished with zero user signal.
          // Multi-aspect needs share the slotId: only note it when no aspect
          // of the slot produced an asset at all.
          const anyAspect = assetNeeds.needs.some(
            (other) =>
              other.slotId === need.slotId &&
              assets[assetKey(other.slotId, other.aspect)]?.source
          );
          if (anyAspect) continue;
          notedSlots.add(need.slotId);
          notes.push(
            `no imagery could be generated for "${briefLabel}" — the design uses fallback styling`
          );
          continue;
        }
        notedSlots.add(need.slotId);
        if (asset.source === 'gradient') {
          notes.push(
            `no imagery was available for "${briefLabel}" — a gradient placeholder was used`
          );
        } else if (asset.source === 'stock' && need.prefer === 'generate') {
          notes.push(
            `image generation was unavailable for "${briefLabel}" — a stock photo was used`
          );
        }
      }
    }

    const results: AiDesignerRenderResult[] = [];
    // The composed doc per variant, kept so the critique dispatch can carry
    // authoritative element data (fills/geometry) without a re-read.
    const composedDocs = new Map<string, DesignerDoc>();
    const total = plans.length;
    let done = 0;
    let lastError: unknown;

    for (const plan of plans) {
      try {
        this._throwIfCancelled(sessionId);
        done++;
        emitter.progress(
          'composer',
          `Composing variant ${plan.variantId}`,
          Math.round((done / total) * 100),
          `Variant ${done}/${total}`
        );

        // The plan's texts are the copy the user saw (and possibly edited) on
        // the plan card — locked for the copywriter, never rewritten. When
        // every copy slot is locked the dispatch is skipped entirely: there
        // is nothing left to write.
        const copySlotIds = (plan.slots ?? [])
          .filter(isCopySlot)
          .map((slot) => slot.id);
        const planTexts =
          plan.texts && typeof plan.texts === 'object' ? plan.texts : {};
        // Plan texts may be keyed by role or a case variant rather than the
        // exact slot id — an exact-only lookup then silently misses, the lock
        // is dropped, and the copywriter rewrites approved copy from the
        // concept alone. Align keys to slot ids first (same matcher the
        // copywriter uses on model output). Pipe compounds are normalized
        // HERE, before the value becomes the lock — a render-side cleanup
        // would be reverted by the copy-lock on the next fix loop.
        const lockedTexts: Record<string, string> = Object.fromEntries(
          Object.entries(
            matchSlotTexts(planTexts, (plan.slots ?? []).filter(isCopySlot))
          ).map(([slotId, text]) => [slotId, normalizeSlotText(text)])
        );
        let copy: SlotTextMap;
        if (
          copySlotIds.length > 0 &&
          copySlotIds.every((slotId) => slotId in lockedTexts)
        ) {
          copy = lockedTexts;
        } else {
          const copyResponse = await this._dispatchAgent(ctx, 'copywriter', {
            type: 'copy-request',
            plan,
            brand: null,
            ...(Object.keys(lockedTexts).length > 0 ? { lockedTexts } : {}),
          });
          copy = this._parseCopy(copyResponse);
          if (Object.keys(copy).length === 0 && copySlotIds.length > 0) {
            notes.push(`copy for variant ${done} fell back to placeholder text`);
          }
        }

        // ONE original per plan: the composer only ever sees the primary
        // format (with a single output it emits no addOutput ops and the
        // per-channel layout passes are no-ops). The other formats are added
        // to the saved doc afterwards by `_expandVariants` (designer-doc
        // addOutput auto-seed + per-variant quality passes).
        const composerResponse = await this._dispatchAgent(ctx, 'composer', {
          type: 'compose-request',
          plan,
          copy,
          assets,
          outputs: outputs.slice(0, 1),
          orgId: ctx.orgId,
          userId: ctx.userId,
        });
        // The composer returns the doc without persisting — the saver is the
        // single Design writer (one row per variant, no orphans).
        const composedDoc = this._parseDesignDoc(composerResponse);
        composedDocs.set(plan.variantId, composedDoc);
        // The composer's total-fallback doc means the planned layout failed
        // doc validation — the variant ships simplified and the user should
        // hear about it (same honest-degradation trail as the other notes).
        if (
          (this._safeJson(composerResponse.content) as any)?.fallback === true
        ) {
          notes.push(`variant ${done} used a simplified fallback layout`);
        }

        this._throwIfCancelled(sessionId);
        let render = await this._saver.saveDesign(
          ctx.orgId,
          ctx.userId,
          plan.variantId,
          composedDoc,
          {
            name: `${plan.skill}-${plan.variantId}`,
            saveFolderId,
          }
        );
        // Deterministic contrast repair over imagery (no LLM): flip the fill
        // or back the failing text with a scrim, then ONE re-render.
        const contrastFixed = await this._fixContrastOverImagery(
          ctx,
          render.designId,
          composedDoc,
          render,
          `${plan.skill}-${plan.variantId}`,
          saveFolderId,
          notes,
          `variant ${done}`
        );
        render = contrastFixed.render;
        composedDocs.set(plan.variantId, contrastFixed.doc);

        results.push(render);
        emitter.preview(render);
      } catch (err) {
        if (this._wasCancelled(err)) throw err;
        lastError = err;
        this._logger.warn(
          `Variant ${plan.variantId} failed: ${(err as Error).message}`,
          AiDesignerConductorService.name
        );
        notes.push(`variant ${done} of ${total} failed to generate`);
        emitter.progress(
          'composer',
          `Variant ${plan.variantId} failed — continuing`,
          undefined,
          `variant ${plan.variantId} failed`
        );
      }
    }

    if (results.length === 0 && lastError) {
      throw lastError;
    }

    // K=1 auto-revision: run Vision Critic on each contact sheet and re-render
    // once. The whole step — INCLUDING the critic dispatch — is non-fatal: the
    // variants above are already rendered, saved, and previewed, so a vision
    // provider failure here must deliver the un-critiqued result, never roll
    // the session back and orphan the saved designs.
    for (let i = 0; i < results.length; i++) {
      this._throwIfCancelled(sessionId);
      const result = results[i];
      if (!result.contactSheetUrl) {
        notes.push(`the automatic quality pass was skipped for variant ${i + 1}`);
        continue;
      }

      try {
        const planForVariant = plans.find((p) => p.variantId === result.variantId);
        emitter.progress(
          'vision-critic',
          `Reviewing variant ${i + 1}/${results.length}`,
          Math.round(((i + 1) / results.length) * 100)
        );
        const docForVariant = composedDocs.get(result.variantId);
        const criticResponse = await this._dispatchAgent(ctx, 'vision-critic', {
          type: 'critique-request',
          // Single-output doc: send the output's own full-res preview — the
          // contact sheet downscales to ≤400px, hiding badge-sized text and
          // contrast/occlusion defects. Multi-page docs keep the sheet.
          contactSheetUrl:
            result.outputPreviews.length === 1
              ? result.outputPreviews[0].url
              : result.contactSheetUrl,
          plans,
          // The doc holds only the primary format at this point (variants are
          // expanded later) — the critic must critique what is on the sheet.
          outputs: outputs.slice(0, 1),
          rubric: this._skillRouter.getRubric(planForVariant?.skill ?? plans[0]?.skill ?? 'meme'),
          outputPreviews: result.outputPreviews.map((o) => ({
            formatId: o.formatId,
            url: o.url,
          })),
          ...(docForVariant
            ? { docSummary: this._critiqueDocSummary(docForVariant) }
            : {}),
        });
        const { findings, skipped } = this._parseFindings(criticResponse);
        if (skipped) {
          notes.push(
            `the automatic quality pass was skipped for variant ${i + 1}`
          );
          continue;
        }
        if (findings.length === 0) continue;

        this._logger.log(
          `Vision Critic found ${findings.length} issues for ${result.variantId}; auto-revising once.`
        );

        const doc = await this._loadDesignDoc(ctx.orgId, result.designId);
        emitter.progress('composer', 'Applying fixes');
        // Imagery-regeneration fixes run deterministically here (asset agent
        // re-dispatch + src/fileId swap); the rest go through applyFixes.
        const { regenerate, rest } = this._partitionRegenerateFindings(findings);
        const regeneratedDoc = await this._regenerateFlaggedAssets(
          sessionId,
          ctx,
          doc,
          regenerate,
          planForVariant,
          notes
        );
        if (rest.length === 0 && regeneratedDoc === doc) {
          // Every finding was a regeneration that failed or was capped —
          // nothing changed, so skip the pointless re-render.
          continue;
        }
        const revisedDoc = await this._composer.applyFixes(
          regeneratedDoc,
          rest,
          ctx.orgId,
          this._aborts.get(sessionId)?.signal,
          undefined,
          this._lockedTextsFor([planForVariant])
        );
        // Update the SAME Design row (+ preview) — a second saveDesign here
        // would orphan the pre-fix row and its preview files, the exact leak
        // the manual revise path avoids via updateDesign.
        let revised = await this._saver.updateDesign(
          ctx.orgId,
          result.designId,
          `${result.variantId}-revised`,
          revisedDoc,
          {
            name: `${plans[0]?.skill ?? 'ai-design'}-${result.variantId}-revised`,
            saveFolderId,
          }
        );
        const revisedFixed = await this._fixContrastOverImagery(
          ctx,
          result.designId,
          revisedDoc,
          { ...revised, variantId: result.variantId },
          `${plans[0]?.skill ?? 'ai-design'}-${result.variantId}-revised`,
          saveFolderId,
          notes,
          `variant ${i + 1}`
        );
        revised = revisedFixed.render;
        results[i] = { ...revised, variantId: result.variantId };
        emitter.preview(results[i]);
      } catch (err) {
        if (this._wasCancelled(err)) throw err;
        this._logger.warn(
          `Vision critique/auto-revise failed for ${result.variantId}: ${
            (err as Error).message
          }`,
          AiDesignerConductorService.name
        );
        notes.push(`the automatic quality pass failed for variant ${i + 1}`);
      }
    }

    // Variant expansion: each saved original holds only the primary format.
    // The remaining formats are auto-created on the SAME Design row
    // (designer-doc addOutput seed from the primary), then every variant gets
    // its own scoped quality passes.
    await this._expandVariants(
      sessionId,
      ctx,
      emitter,
      results,
      plans,
      outputs,
      saveFolderId,
      notes
    );

    if (notes.length > 0) {
      this._degradationNotes.set(sessionId, notes);
    } else {
      this._degradationNotes.delete(sessionId);
    }

    return results;
  }

  /**
   * Expand each saved single-format original into the remaining formats: a
   * designer-doc `addOutput` op auto-seeds each new output from the primary
   * (seedCopy/smartReflow, shared originIds — the manual designer's
   * auto-create, never a fresh recompose), then every non-primary output gets
   * up to two scoped vision-critic passes (critique → format-pinned fixes →
   * one re-check). All writes ride `updateDesign` on the SAME Design row — no
   * per-variant rows. Non-fatal like the original's quality pass: a failure
   * delivers the un-expanded original with a degradation note.
   */
  private async _expandVariants(
    sessionId: string,
    ctx: AiDesignerAgentContext,
    emitter: AiDesignerEmitter,
    results: AiDesignerRenderResult[],
    plans: DesignPlan[],
    outputs: { formatId: string; width: number; height: number; name?: string }[],
    saveFolderId: string | null,
    notes: string[]
  ) {
    const secondaryOutputs = outputs.slice(1);
    if (secondaryOutputs.length === 0) return;

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const plan = plans.find((p) => p.variantId === result.variantId);
      if (!plan) continue;

      try {
        this._throwIfCancelled(sessionId);

        let doc = await this._loadDesignDoc(ctx.orgId, result.designId);
        doc = this._docService.applyOps(
          doc,
          secondaryOutputs.map((out) => ({
            op: 'addOutput' as const,
            preset: {
              formatId: out.formatId,
              name: out.name || out.formatId,
              width: out.width,
              height: out.height,
            },
          }))
        );
        // The seeded outputs stay faithful copies of the original: same
        // fileIds, same elements. The renderer cover-crops the shared asset
        // per format (computeCoverCrop + focalPoint), so no per-aspect asset
        // swap is needed — the passes below only align/resize/reposition.

        // Seeded outputs otherwise get zero geometric QC: run the composer's
        // deterministic sanitizer (text-fit clamp, overlap guard, doc
        // validator) on the whole expanded doc before it renders.
        const sanitized = this._composer.sanitizeDoc(doc, plan);
        doc = sanitized.doc;
        if (sanitized.violations.length > 0) {
          const degenerate = sanitized.violations.some((v) =>
            v.startsWith(DEGENERATE_VIOLATION_PREFIX)
          );
          notes.push(
            degenerate
              ? `variant ${i + 1}'s expanded formats could not be fully repaired automatically`
              : `variant ${i + 1}'s expanded formats needed automatic layout repairs`
          );
        }

        // Render the expanded doc once so every output has a preview for the
        // per-format critiques below and for delivery.
        let render = await this._saver.updateDesign(
          ctx.orgId,
          result.designId,
          `${result.variantId}-expanded`,
          doc,
          {
            name: `${plan.skill}-${result.variantId}`,
            saveFolderId,
          }
        );
        const expandedFixed = await this._fixContrastOverImagery(
          ctx,
          result.designId,
          doc,
          render,
          `${plan.skill}-${result.variantId}`,
          saveFolderId,
          notes,
          `variant ${i + 1}`
        );
        render = expandedFixed.render;
        doc = expandedFixed.doc;

        for (let f = 0; f < secondaryOutputs.length; f++) {
          const out = secondaryOutputs[f];
          const pct = Math.round(((f + 1) / secondaryOutputs.length) * 100);
          const progressNote = `Format ${f + 1}/${secondaryOutputs.length}`;
          emitter.progress('composer', `Adapting to ${out.formatId}`, pct, progressNote);

          // Up to two vision-critic passes per variant: critique → scoped
          // fixes → ONE re-check when fixes were applied.
          for (let pass = 1; pass <= 2; pass++) {
            this._throwIfCancelled(sessionId);
            const preview = render.outputPreviews.find(
              (p) => p.formatId === out.formatId
            );
            if (!preview) break;

            emitter.progress('vision-critic', `Reviewing ${out.formatId}`, pct, progressNote);
            const criticResponse = await this._dispatchAgent(ctx, 'vision-critic', {
              type: 'critique-request',
              // Scoped to this one format: the output's own preview stands in
              // for the contact sheet, and only its safe zones/preview ride
              // along — the findings (and their escalation) stay per-format.
              contactSheetUrl: preview.url,
              plans: [plan],
              outputs: [out],
              rubric: this._skillRouter.getRubric(plan.skill),
              outputPreviews: [{ formatId: out.formatId, url: preview.url }],
              docSummary: this._critiqueDocSummary(doc, [out.formatId]),
            });
            const { findings, skipped } = this._parseFindings(criticResponse);
            if (skipped) {
              notes.push(
                `the automatic quality pass was skipped for variant ${i + 1} (${out.formatId})`
              );
              break;
            }
            if (findings.length === 0) break;

            emitter.progress('composer', 'Applying fixes', pct, progressNote);
            // Regeneration swaps the asset on EVERY output sharing it (the
            // variant-fidelity invariant), so it is NOT format-pinned like
            // the applyFixes pass below.
            const { regenerate, rest } =
              this._partitionRegenerateFindings(findings);
            doc = await this._regenerateFlaggedAssets(
              sessionId,
              ctx,
              doc,
              regenerate,
              plan,
              notes
            );
            doc = await this._composer.applyFixes(
              doc,
              rest,
              ctx.orgId,
              this._aborts.get(sessionId)?.signal,
              [out.formatId],
              this._lockedTextsFor([plan])
            );
            render = await this._saver.updateDesign(
              ctx.orgId,
              result.designId,
              `${result.variantId}-expanded`,
              doc,
              {
                name: `${plan.skill}-${result.variantId}`,
                saveFolderId,
              }
            );
            const passFixed = await this._fixContrastOverImagery(
              ctx,
              result.designId,
              doc,
              render,
              `${plan.skill}-${result.variantId}`,
              saveFolderId,
              notes,
              `variant ${i + 1} (${out.formatId})`
            );
            render = passFixed.render;
            doc = passFixed.doc;
          }
        }

        results[i] = { ...render, variantId: result.variantId };
        emitter.preview(results[i]);
      } catch (err) {
        if (this._wasCancelled(err)) throw err;
        this._logger.warn(
          `Variant expansion failed for ${result.variantId}: ${(err as Error).message}`,
          AiDesignerConductorService.name
        );
        notes.push(
          `variant ${i + 1} could only be delivered in its original format`
        );
      }
    }
  }

  /**
   * Deterministic text-over-imagery contrast repair after a save/update:
   * when the saver's render-time audit flagged violations, the composer's
   * `fixContrast` (NO LLM — fill flip or a subtle scrim) repairs them and
   * the design is re-rendered ONCE. Bounded and non-fatal: any failure
   * delivers the un-fixed render with the original doc. A degradation note
   * is added whenever the fix had to intervene.
   */
  private async _fixContrastOverImagery(
    ctx: AiDesignerAgentContext,
    designId: string,
    doc: DesignerDoc,
    render: AiDesignerRenderResult,
    name: string,
    saveFolderId: string | null,
    notes: string[],
    label: string
  ): Promise<{ doc: DesignerDoc; render: AiDesignerRenderResult }> {
    if (!render.contrastViolations?.length) return { doc, render };
    try {
      const fixed = this._composer.fixContrast(doc, render.contrastViolations);
      if (fixed.notes.length === 0 || fixed.doc === doc) {
        return { doc, render };
      }
      this._logger.log(
        `Contrast fix over imagery for ${label}: ${fixed.notes.join('; ')}.`
      );
      notes.push(`${label} needed an automatic contrast fix over the imagery`);
      const reRendered = await this._saver.updateDesign(
        ctx.orgId,
        designId,
        `${render.variantId}-contrast`,
        fixed.doc,
        { name, saveFolderId }
      );
      return {
        doc: fixed.doc,
        render: { ...reRendered, variantId: render.variantId },
      };
    } catch (err) {
      this._logger.warn(
        `Contrast fix over imagery failed for ${label}: ${(err as Error).message}`
      );
      return { doc, render };
    }
  }

  /**
   * The user-approved plan texts for the given plans' copy slots — locked
   * copy that fix loops must never rewrite (passed to the composer's
   * applyFixes guard). Returns undefined when nothing is locked.
   */
  private _lockedTextsFor(
    plans: (DesignPlan | undefined)[]
  ): Record<string, string> | undefined {
    const locked: Record<string, string> = {};
    for (const plan of plans) {
      if (!plan) continue;
      const texts =
        plan.texts && typeof plan.texts === 'object' ? plan.texts : {};
      for (const slot of plan.slots ?? []) {
        if (!isCopySlot(slot)) continue;
        const text = texts[slot.id];
        if (typeof text === 'string' && text.trim()) {
          // Same pipe normalization as the compose-time lock seam — every
          // fix loop must see the identical pipe-free locked value or the
          // "kept over the rewrite" branch fires on the machine separator.
          locked[slot.id] = normalizeSlotText(text);
        }
      }
    }
    return Object.keys(locked).length > 0 ? locked : undefined;
  }

  private async _interpretReferences(
    ctx: AiDesignerAgentContext,
    referenceFileIds: string[] | undefined
  ): Promise<string[] | undefined> {
    if (!referenceFileIds || referenceFileIds.length === 0) return undefined;

    try {
      const response = await this._dispatchAgent(ctx, 'vision-critic', {
        type: 'interpret-request',
        fileIds: referenceFileIds,
      });
      const parsed = this._safeJson(response.content) as any;
      if (parsed?.type === 'interpretations' && Array.isArray(parsed.cues)) {
        return parsed.cues as string[];
      }
    } catch (err) {
      // A user cancel must stop the run, not be swallowed as a soft failure.
      if (this._wasCancelled(err)) throw err;
      this._logger.warn(
        `Reference interpretation failed: ${(err as Error).message}`,
        AiDesignerConductorService.name
      );
    }
    return undefined;
  }

  // Hard ceiling on asset generation per accepted plan set. Plans are
  // LLM-shaped JSON — without a cap a single response could request hundreds
  // of parallel text-to-image generations (the asset agent fans out over
  // every need), turning one accepted plan into unbounded spend. Each
  // plan×slot need counts toward the cap.
  private static readonly MAX_ASSET_NEEDS = 8;

  // Layouts where the imagery carries the design (copy overlays or abuts it).
  // Image slots in these get text-space guidance appended to the generation
  // prompt; minimal-centered imagery sits clear of copy and goes without.
  private static readonly HERO_LAYOUTS = new Set([
    'hero-top',
    'stacked',
    'side-by-side',
    'hero-fullbleed',
    'top-bottom',
    'split-panel',
    'badge-burst',
    'editorial-sidebar',
  ]);

  // ONE need per plan×slot: the slotId is scoped by the plan's variantId
  // (`${variantId}:${slotId}`) so every plan's `asset:<slot>` resolves to its
  // OWN generated image — keying by the bare slotId used to dedupe every plan
  // onto the first plan's asset, making all originals share one picture. Each
  // need targets a single aspect (the primary output's class): variants are
  // seeded from the original on the same Design row and the renderer
  // cover-crops per format, so per-aspect fan-out is unnecessary.
  private _collectAssetNeeds(
    plans: DesignPlan[],
    outputs: { formatId: string; width: number; height: number }[]
  ): { needs: AssetNeedRequest[]; dropped: number } {
    const primaryAspect = outputs[0]
      ? aspectClass(outputs[0].width, outputs[0].height)
      : 'square';
    const dominantFormatId = outputs[0]?.formatId;

    // Dedupe within a plan (first occurrence wins), keeping the plan so
    // hero/background slots can carry layout intent into the image prompt.
    const seen = new Set<string>();
    const needs: AssetNeedRequest[] = [];
    for (const plan of plans) {
      for (const need of plan.assetNeeds ?? []) {
        const key = `${plan.variantId}:${need.slotId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        needs.push({
          slotId: key,
          brief: need.brief,
          prefer: need.prefer,
          aspect: primaryAspect,
          heroLayout: this._heroLayoutForNeed(plan, need.slotId, dominantFormatId),
        });
      }
    }

    if (needs.length > AiDesignerConductorService.MAX_ASSET_NEEDS) {
      this._logger.warn(
        `Plans requested ${needs.length} plan×slot assets; capping to ${AiDesignerConductorService.MAX_ASSET_NEEDS}.`,
        AiDesignerConductorService.name
      );
      return {
        needs: needs.slice(0, AiDesignerConductorService.MAX_ASSET_NEEDS),
        dropped: needs.length - AiDesignerConductorService.MAX_ASSET_NEEDS,
      };
    }
    return { needs, dropped: 0 };
  }

  // Layout intent for the generation prompt's text-space guidance, resolved
  // from the plan's intent for the dominant (primary) channel. Only
  // background/hero slots get one — imagery sitting clear of copy needs no
  // guidance.
  private _heroLayoutForNeed(
    plan: DesignPlan,
    slotId: string,
    dominantFormatId?: string
  ): string | undefined {
    const layout =
      (dominantFormatId ? plan.channelLayouts?.[dominantFormatId] : undefined) ??
      plan.formatTemplate;
    if (!layout || !AiDesignerConductorService.HERO_LAYOUTS.has(layout)) {
      return undefined;
    }
    const isBackground =
      plan.background?.kind === 'image' && plan.background.ref === `asset:${slotId}`;
    const isImageSlot = plan.slots.some(
      (s) => s.id === slotId && (s.kind === 'image' || s.role === 'image')
    );
    return isBackground || isImageSlot ? layout : undefined;
  }

  /**
   * Split critique findings into imagery-regeneration fixes (handled
   * deterministically here) and everything else (the composer's applyFixes,
   * as before). A finding carrying regenerateAsset routes whole to the
   * regeneration path — its other fields never reach applyFixes.
   */
  private _partitionRegenerateFindings(findings: VisionFinding[]): {
    regenerate: VisionFinding[];
    rest: VisionFinding[];
  } {
    const regenerate: VisionFinding[] = [];
    const rest: VisionFinding[] = [];
    for (const finding of findings) {
      (finding.fix?.regenerateAsset ? regenerate : rest).push(finding);
    }
    return { regenerate, rest };
  }

  /**
   * Execute regenerateAsset fixes for one variant's doc: rebuild the slot's
   * asset need (plan brief + the critic's extra guidance), dispatch the asset
   * agent with the regenerate flag — the same plumbing (and budget gate) as
   * initial compose — and on success swap the new src/fileId onto EVERY
   * output that used the old asset, preserving the same-fileId-across-formats
   * variant invariant. ONE attempt per variant×slot per pipeline run; a cap
   * hit or any failure keeps the old image and pushes a degradation note.
   * Non-fatal except for user cancels.
   */
  private async _regenerateFlaggedAssets(
    sessionId: string,
    ctx: AiDesignerAgentContext,
    doc: DesignerDoc,
    findings: VisionFinding[],
    plan: DesignPlan | undefined,
    notes: string[]
  ): Promise<DesignerDoc> {
    if (findings.length === 0) return doc;
    const attempted =
      this._regeneratedSlots.get(sessionId) ?? new Set<string>();
    this._regeneratedSlots.set(sessionId, attempted);
    // One dispatch per slot even when several findings flag it.
    const seen = new Set<string>();

    for (const finding of findings) {
      const regen = finding.fix?.regenerateAsset;
      if (!regen) continue;
      const slotId = regen.slotId;
      if (seen.has(slotId)) continue;
      seen.add(slotId);
      const failNote = `couldn't regenerate the ${slotId} image — the original may contain unwanted text`;
      if (!plan) {
        notes.push(failNote);
        continue;
      }
      const slotKey = `${plan.variantId}:${slotId}`;
      if (attempted.has(slotKey)) {
        this._logger.warn(
          `Refusing repeat asset regeneration for ${slotKey} — one attempt per slot per run.`,
          AiDesignerConductorService.name
        );
        notes.push(failNote);
        continue;
      }
      attempted.add(slotKey);

      try {
        const primary = doc.outputs[0];
        const planNeed = (plan.assetNeeds ?? []).find(
          (n) => n.slotId === slotId
        );
        // Same shape _collectAssetNeeds builds at compose (variant-scoped
        // key, primary aspect, hero layout intent), with the critic's brief
        // appended as extra guidance.
        const need: AssetNeedRequest = {
          slotId: slotKey,
          brief: [planNeed?.brief ?? plan.concept, regen.brief]
            .filter(Boolean)
            .join('. '),
          prefer: planNeed?.prefer ?? 'generate',
          aspect: primary
            ? aspectClass(primary.width, primary.height)
            : 'square',
          heroLayout: this._heroLayoutForNeed(plan, slotId, primary?.formatId),
        };
        const response = await this._dispatchAgent(ctx, 'asset', {
          type: 'asset-request',
          assetNeeds: [need],
          regenerate: true,
        });
        const { assets } = this._parseAssets(response);
        const asset = assets[assetKey(need.slotId, need.aspect)];
        // A gradient placeholder is not a usable replacement for a photo the
        // critic disliked — keep the original imagery instead.
        if (!asset?.fileId || !asset.path || asset.source === 'gradient') {
          notes.push(failNote);
          continue;
        }
        const patched = this._replaceSlotImagery(doc, plan, slotId, asset);
        if (!patched) {
          notes.push(failNote);
          continue;
        }
        doc = patched;
        this._logger.log(
          `Regenerated imagery for ${slotKey} (source=${asset.source}).`,
          AiDesignerConductorService.name
        );
      } catch (err) {
        if (this._wasCancelled(err)) throw err;
        this._logger.warn(
          `Asset regeneration failed for ${slotKey}: ${(err as Error).message}`,
          AiDesignerConductorService.name
        );
        notes.push(failNote);
      }
    }
    return doc;
  }

  /**
   * Deterministically swap a slot's imagery to the regenerated asset across
   * every output of the variant's doc — output-level bg images and child
   * image elements both — through the doc service's ops path. This is the
   * conductor's own patch, NOT an LLM op: it must not ride the composer's
   * `_filterReviseOps`, which (correctly) blocks src/fileId on imagery.
   * Returns null when nothing matched.
   */
  private _replaceSlotImagery(
    doc: DesignerDoc,
    plan: DesignPlan,
    slotId: string,
    asset: AssetResult
  ): DesignerDoc | null {
    const bgIsSlot =
      plan.background?.kind === 'image' &&
      plan.background.ref === `asset:${slotId}`;
    // The variant shares ONE asset per slot across its formats — collect the
    // old fileIds so seeded copies match even without the originId.
    const oldFileIds = new Set<string>();
    for (const out of doc.outputs) {
      if (!('children' in out)) continue;
      if (bgIsSlot && out.bg?.type === 'image' && out.bg.fileId) {
        oldFileIds.add(out.bg.fileId);
      }
      for (const el of out.children) {
        if (
          el.type === 'image' &&
          (el.originId === slotId || el.id === slotId) &&
          el.fileId
        ) {
          oldFileIds.add(el.fileId);
        }
      }
    }

    const ops: DesignerDocOp[] = [];
    doc.outputs.forEach((out, outputIndex) => {
      if (!('children' in out)) return;
      if (
        out.bg?.type === 'image' &&
        (bgIsSlot || (out.bg.fileId && oldFileIds.has(out.bg.fileId)))
      ) {
        ops.push({
          op: 'setOutputBackground',
          outputIndex,
          background: {
            type: 'image',
            src: asset.path,
            fileId: asset.fileId,
            focalPoint:
              asset.focalPoint ?? out.bg.focalPoint ?? { x: 0.5, y: 0.5 },
          },
        });
      }
      for (const el of out.children) {
        if (el.type !== 'image') continue;
        if (
          el.originId !== slotId &&
          el.id !== slotId &&
          !(el.fileId && oldFileIds.has(el.fileId))
        ) {
          continue;
        }
        ops.push({
          op: 'updateElement',
          outputIndex,
          elementId: el.id,
          scope: 'format-only',
          patch: {
            src: asset.path,
            fileId: asset.fileId,
            ...(asset.focalPoint ? { focalPoint: asset.focalPoint } : {}),
          },
        });
      }
    });

    if (ops.length === 0) return null;
    return this._docService.applyOps(doc, ops);
  }

  private async _loadDesignDoc(
    orgId: string,
    designId: string
  ): Promise<DesignerDoc> {
    const design = await this._designService.getDesign(orgId, designId);
    if (!design || !design.doc) {
      throw new Error(`Design ${designId} not found or has no doc`);
    }
    return design.doc as unknown as DesignerDoc;
  }

  private _resolveOutputs(
    config: AiDesignerConfig
  ): { formatId: string; width: number; height: number; name?: string }[] {
    const outs = (config.channels || [])
      .map((id) => {
        const preset = CHANNEL_PRESETS.find((p: any) => p.id === id);
        return preset
          ? {
              formatId: preset.id,
              width: preset.width,
              height: preset.height,
              name: preset.name,
            }
          : null;
      })
      .filter(Boolean) as { formatId: string; width: number; height: number; name?: string }[];

    for (const custom of config.customSizes ?? []) {
      outs.push({
        formatId: `custom-${custom.width}x${custom.height}`,
        width: custom.width,
        height: custom.height,
        name: custom.name || `${custom.width}×${custom.height}`,
      });
    }

    return outs;
  }

  private async _emitDelivery(
    sessionId: string,
    _ctx: AiDesignerAgentContext,
    emitter: AiDesignerEmitter,
    results: AiDesignerRenderResult[],
    notes: string[] = []
  ) {
    // One honest heads-up for everything that degraded during the pipeline —
    // never a message per note.
    if (notes.length > 0) {
      const noteMsg = await this._service.appendMessage({
        sessionId,
        role: 'assistant',
        agent: 'conversationalist',
        kind: 'markdown',
        content: {
          kind: 'markdown',
          md: `Heads up — a few things didn't go fully to plan:\n${notes
            .map((n) => `- ${n}`)
            .join('\n')}`,
        },
      });
      emitter.toSession('message', noteMsg);
    }

    const mediaItems = results.flatMap((r, index) =>
      r.outputPreviews.map((o) => ({
        url: o.url,
        type: 'image' as const,
        caption: `Variant ${index + 1} · ${o.formatId}`,
        designId: r.designId,
        fileId: o.fileId,
      }))
    );

    const msg = await this._service.appendMessage({
      sessionId,
      role: 'assistant',
      agent: 'composer',
      kind: 'media',
      content: {
        kind: 'media',
        items: mediaItems,
      },
    });
    emitter.toSession('message', msg);

    // Delivery is conversational: no form. Tell the user what they can ask
    // for and how to finish — the accept path (`_acceptDelivered`) auto-saves
    // a reusable template unless they opt out, so it is not saved here (that
    // would double-save and ignore the opt-out, plan §10).
    const doneMsg = await this._service.appendMessage({
      sessionId,
      role: 'assistant',
      agent: 'conversationalist',
      kind: 'markdown',
      content: {
        kind: 'markdown',
        md: 'Your designs are saved. Want a change? Just say so — for example `make the headline bigger on variant 2`.\n\nSay `looks good` to finish — I\'ll save it as a reusable template (say `looks good, no template` to skip that).',
      },
    });
    emitter.toSession('message', doneMsg);
  }

  private async _createTemplate(
    orgId: string,
    designId: string,
    label: string,
    genre?: string
  ): Promise<boolean> {
    try {
      const design = await this._designService.getDesign(orgId, designId);
      if (!design || !design.doc) return false;
      // Tag by genre in the indexed `category` (filterable), and stamp the
      // AI-Designer source markers into the doc metadata (Json, no migration —
      // plan §10 / F-002). No `source`/`genre` column exists or is added.
      const doc = {
        ...(design.doc as Record<string, unknown>),
        metadata: {
          ...(((design.doc as Record<string, unknown>).metadata as
            | Record<string, unknown>
            | undefined) ?? {}),
          source: 'ai-designer',
          genre: genre ?? null,
          skillId: genre ?? null,
        },
      };
      await this._designService.createTemplate({
        organizationId: orgId,
        name: `AI Design ${label}`,
        category: genre || 'ai-designer',
        doc,
      });
      return true;
    } catch (err) {
      this._logger.warn(
        `Template creation failed: ${(err as Error).message}`,
        AiDesignerConductorService.name
      );
      return false;
    }
  }

  private async _appendProgress(
    sessionId: string,
    agent: string,
    phase: string,
    emitter: AiDesignerEmitter
  ) {
    // Persisted phase-transition row so progress survives reload (plan §5).
    await this._service.appendMessage({
      sessionId,
      role: 'agent',
      agent,
      kind: 'progress',
      content: { kind: 'progress', agent, phase },
    });
    // The persisted row stays DB-only (hydration path) — the live bubble is a
    // separate ephemeral event so connected clients see the phase change now.
    emitter.progress(agent, phase);
  }

  /**
   * Deterministic whole-message accept match for the delivered/revising
   * state — the shared `isDeliveredAccept` helper (also used by the
   * conversationalist's intake confirmation).
   */
  private _isDeliveredAccept(text: string): boolean {
    return isDeliveredAccept(text);
  }

  /**
   * Classify a free-text message from a delivered/revising session: a revision
   * request, or an accept ("looks good"). Anything unparseable keeps the
   * historical fallback — treat the raw text as a shared-scope revision.
   */
  private async _classifyDeliveredChat(
    ctx: AiDesignerAgentContext,
    instruction: string,
    activeDesignIds: string[],
    mode: string
  ): Promise<
    | { kind: 'revise'; revision: RevisionRequest }
    | { kind: 'accept'; text?: string }
  > {
    // Deterministic accept first: a whole-message accept phrase never needs
    // the classifier (and the classifier must never get to misread "looks
    // good" as a revision — the S1 misfire).
    if (this._isDeliveredAccept(instruction)) {
      return { kind: 'accept' };
    }

    if (mode === 'chat') {
      const convResponse = await this._dispatchAgent(ctx, 'conversationalist', {
        type: 'chat',
        text: instruction,
        session: {
          mode: 'chat',
          state: 'revising',
          brief: { intent: instruction },
          questionsAsked: [],
          activeDesignIds,
        },
      });
      const parsed = this._safeJson(convResponse.content) as any;
      if (parsed?.type === 'revision' && parsed.revision) {
        return { kind: 'revise', revision: parsed.revision as RevisionRequest };
      }
      if (parsed?.type === 'accept') {
        return {
          kind: 'accept',
          text: typeof parsed.text === 'string' ? parsed.text : undefined,
        };
      }
    }

    return {
      kind: 'revise',
      revision: {
        instruction,
        targetDesignId: activeDesignIds[0],
        scope: 'shared',
      },
    };
  }

  /**
   * Conversational accept in the delivered state: save a reusable template per
   * design in the LATEST delivery (server-owned `lastDeliveredDesignIds` —
   * superseded revisions stay active but are not re-saved) unless the user's
   * accept text opts out ("no template", "don't save"), then confirm. Ported
   * from the removed delivery form's action=accept flow.
   */
  private async _acceptDelivered(
    sessionId: string,
    ctx: AiDesignerAgentContext,
    emitter: AiDesignerEmitter,
    activeDesignIds: string[],
    brief: DesignBrief,
    instruction: string,
    replyText?: string
  ) {
    const optedOut = /no template|don'?t save/i.test(instruction);
    // Sessions delivered before this field existed fall back to every active
    // id — the old behavior.
    const lastDelivered = (brief.lastDeliveredDesignIds ?? []).filter((id) =>
      activeDesignIds.includes(id)
    );
    const saveIds =
      lastDelivered.length > 0 ? lastDelivered : activeDesignIds;
    if (!optedOut && saveIds.length > 0) {
      const genre = brief.skillId as string | undefined;
      let saved = 0;
      for (const designId of saveIds) {
        const ok = await this._createTemplate(
          ctx.orgId,
          designId,
          designId.slice(0, 8),
          genre
        );
        if (ok) saved++;
      }
      await this._emitText(
        sessionId,
        ctx,
        emitter,
        'conversationalist',
        saved === saveIds.length
          ? saveIds.length > 1
            ? 'Templates saved.'
            : 'Template saved.'
          : "Couldn't save the template — the design is still available; try again in a moment."
      );
      return;
    }

    await this._emitText(
      sessionId,
      ctx,
      emitter,
      'conversationalist',
      replyText || 'Great! Let me know if you need any other changes.'
    );
  }

  private async _reviseDesign(
    sessionId: string,
    ctx: AiDesignerAgentContext,
    targetDesignId: string,
    revision: RevisionRequest,
    emitter: AiDesignerEmitter
  ): Promise<AiDesignerRenderResult | null> {
    const doc = await this._loadDesignDoc(ctx.orgId, targetDesignId);

    emitter.progress('composer', 'Applying revision', undefined, revision.instruction);
    // Real LLM re-emit of updateElement ops (not a note-only no-op): honors
    // scope (shared vs format-only), so the revised design actually changes.
    let revisedDoc = await this._composer.reviseByInstruction(
      doc,
      revision.instruction,
      revision.scope,
      ctx.orgId,
      revision.targetOutputs,
      revision.targetSlots,
      this._aborts.get(sessionId)?.signal
    );

    const session = await this._service.getSessionForUser(sessionId, ctx.orgId, ctx.userId);
    const config = this._config(session ?? {});
    const sessionBrief = this._brief(session ?? {});
    const genre = (sessionBrief.skillId as string | undefined) ?? 'meme';
    const lastPlans = (sessionBrief.lastPlans as DesignPlan[] | undefined) ?? [];
    const saveFolderId = await this._resolveSaveFolder(ctx.orgId, config);

    this._throwIfCancelled(sessionId);
    emitter.progress('composer', 'Saving');
    // One clean base name per revision — the saver uses it verbatim, so the
    // timestamp rides the name (not a re-appended variantId) and re-renders
    // after the critic pass below keep the same base.
    const revisionName = `ai-design-revised-${Date.now()}`;
    let render = await this._saver.saveDesign(
      ctx.orgId,
      ctx.userId,
      `revised-${Date.now()}`,
      revisedDoc,
      {
        name: revisionName,
        saveFolderId,
      }
    );

    // Vision-Critic re-check (up to 2 passes: critique → fixes → one
    // re-check) before re-delivery (plan §10).
    if (render.contactSheetUrl) {
      try {
        for (let pass = 1; pass <= 2; pass++) {
          this._throwIfCancelled(sessionId);
          emitter.progress('vision-critic', 'Reviewing the revision');
          const criticResponse = await this._dispatchAgent(ctx, 'vision-critic', {
            type: 'critique-request',
            contactSheetUrl: render.contactSheetUrl,
            plans: lastPlans,
            outputs: this._resolveOutputs(config),
            rubric: this._skillRouter.getRubric(genre),
            outputPreviews: render.outputPreviews.map((o) => ({
              formatId: o.formatId,
              url: o.url,
            })),
            docSummary: this._critiqueDocSummary(revisedDoc),
          });
          // A skipped re-check (no image, unparseable reply) is not a clean
          // pass — stop the loop rather than re-dispatching.
          const { findings, skipped } = this._parseFindings(criticResponse);
          if (skipped || findings.length === 0) break;
          revisedDoc = await this._composer.applyFixes(
            revisedDoc,
            findings,
            ctx.orgId,
            this._aborts.get(sessionId)?.signal,
            undefined,
            this._lockedTextsFor(lastPlans)
          );
          // Re-render the SAME Design row — a second saveDesign here would
          // orphan the pre-fix row (+ its preview files) on every revise.
          emitter.progress('composer', 'Saving');
          render = await this._saver.updateDesign(
            ctx.orgId,
            render.designId,
            `revised-${Date.now()}`,
            revisedDoc,
            {
              name: revisionName,
              saveFolderId,
            }
          );
        }
      } catch (err) {
        if (this._wasCancelled(err)) throw err;
        this._logger.warn(
          `Revise vision re-check failed: ${(err as Error).message}`,
          AiDesignerConductorService.name
        );
      }
    }

    // Show the revision immediately (mirrors the pipeline's preview emit) —
    // the persisted delivery message replaces it below.
    emitter.preview(render);
    return render;
  }

  private async _dispatchAgent(
    ctx: AiDesignerAgentContext,
    agentId: string,
    payload: Record<string, unknown>
  ): Promise<AgentResponse> {
    const breakerKey = `${ctx.orgId}:${agentId}`;
    const breaker = this._breakers.get(breakerKey);
    if (breaker) {
      if (
        Date.now() - breaker.lastFailureAt >
        AiDesignerConductorService.BREAKER_FAILURE_WINDOW_MS
      ) {
        // Stale: no failure within the window — prune so counts never
        // accumulate across quiet days and the map stays bounded.
        this._breakers.delete(breakerKey);
      } else if (
        breaker.failures >= AiDesignerConductorService.BREAKER_THRESHOLD &&
        Date.now() - breaker.openedAt <
          AiDesignerConductorService.BREAKER_RESET_MS
      ) {
        // Open, and the half-open window hasn't elapsed. Past the window the
        // next dispatch is the trial call: success closes, failure re-opens.
        throw new Error(`Circuit open for agent ${agentId}`);
      }
    }

    const budget = await this._budgetGuard.checkStartBudget(ctx.orgId);
    if (!budget.allowed) {
      throw new Error(budget.reason || 'AI Designer budget exceeded');
    }

    const agent = registryState.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found in registry`);
    }

    const timeoutMs = this._agentTimeoutMs();
    const signal = this._aborts.get(ctx.sessionId)?.signal;
    // NOTE: a lost race (timeout/cancel) ABANDONS the dispatch, it does not
    // abort it — dispatchToAgent accepts no signal, so the underlying
    // agent/LLM call keeps running (and billing) in the background; only
    // subsequent steps stop.
    try {
      const response = await raceWithTimeout(
        dispatchToAgent(agent, {
          sessionId: ctx.sessionId,
          employeeId: ctx.userId,
          displayName: 'AI Designer User',
          rawInput: JSON.stringify(payload),
          intentSummary: `dispatch to ${agentId}`,
          entities: {},
          detectedLanguage: 'en',
          turnHistory: [],
          workflowState: {},
          metadata: {
            orgId: ctx.orgId,
            userId: ctx.userId,
            sessionId: ctx.sessionId,
          },
        }),
        timeoutMs,
        { signal, label: `Agent ${agentId}` }
      );
      this._breakers.delete(breakerKey);
      return response;
    } catch (err) {
      // The helper rejects with a generic cancellation message; promote it to
      // the conductor's own error type so the rest of the pipeline recognises
      // a user cancel and the breaker logic stays intact.
      const isCancel =
        err instanceof Error && err.message === 'Cancelled';
      if (isCancel) {
        throw new PipelineCancelledError();
      }
      // A user cancel is not a provider failure — it must not trip the breaker.
      if (!(err instanceof PipelineCancelledError)) {
        const prev = this._breakers.get(breakerKey);
        const withinWindow =
          prev &&
          Date.now() - prev.lastFailureAt <=
            AiDesignerConductorService.BREAKER_FAILURE_WINDOW_MS;
        const failures = (withinWindow ? prev.failures : 0) + 1;
        this._breakers.set(breakerKey, {
          failures,
          lastFailureAt: Date.now(),
          openedAt:
            failures >= AiDesignerConductorService.BREAKER_THRESHOLD
              ? Date.now()
              : 0,
        });
      }
      throw err;
    }
  }

  private _agentTimeoutMs(): number {
    const raw = Number(process.env.AI_DESIGNER_AGENT_TIMEOUT_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : 120_000;
  }

  /**
   * Resolve where rendered previews land in `/files`. A client-supplied
   * `saveFolderId` only counts when the folder belongs to this org
   * (`getFolder` throws otherwise); else `savePath` ("/campaigns/summer") is
   * resolved segment-by-segment, creating missing folders. Falls back to the
   * `/files` root — a bad folder must never fail the render.
   */
  private async _resolveSaveFolder(
    orgId: string,
    config: AiDesignerConfig
  ): Promise<string | null> {
    if (config.saveFolderId) {
      try {
        await this._fileService.getFolder(orgId, config.saveFolderId);
        return config.saveFolderId;
      } catch {
        this._logger.warn(
          `AI Designer saveFolderId ${config.saveFolderId} is not a folder of org ${orgId}; ignoring.`,
          AiDesignerConductorService.name
        );
      }
    }
    if (config.savePath) {
      try {
        return await this._fileService.resolveFolderPath(orgId, config.savePath);
      } catch (err) {
        this._logger.warn(
          `AI Designer savePath resolution failed: ${(err as Error).message}`,
          AiDesignerConductorService.name
        );
      }
    }
    return null;
  }

  private _tryAcquire(sessionId: string): boolean {
    if (this._inFlight.has(sessionId)) {
      return false;
    }
    this._inFlight.add(sessionId);
    this._aborts.set(sessionId, new AbortController());
    return true;
  }

  private _release(sessionId: string) {
    this._inFlight.delete(sessionId);
    this._aborts.delete(sessionId);
    this._regeneratedSlots.delete(sessionId);
  }

  private _throwIfCancelled(sessionId: string) {
    if (this._aborts.get(sessionId)?.signal.aborted) {
      throw new PipelineCancelledError();
    }
  }

  /**
   * True when the failure is a user cancel: the gateway's cancel handler has
   * already rolled the state back and messaged the user, so the pipeline must
   * only stop — not "recover" (which would overwrite that rollback).
   */
  private _wasCancelled(err: unknown): boolean {
    return err instanceof PipelineCancelledError;
  }

  private _emitPolicyError(
    emitter: AiDesignerEmitter,
    reason: 'guardrail_blocked' | 'value_bounds' | 'invalid_key',
    message: string
  ) {
    const code =
      reason === 'guardrail_blocked' ? 'guardrail_blocked' : 'invalid_payload';
    emitter.error(code, message);
  }

  private async _emitBusy(
    sessionId: string,
    ctx: AiDesignerAgentContext,
    emitter: AiDesignerEmitter
  ) {
    await this._emitText(
      sessionId,
      ctx,
      emitter,
      'conversationalist',
      "I'm still working on the previous request for this design — give me a moment."
    );
  }

  /**
   * Log the raw failure, put the session back into a recoverable state, and
   * tell the user in sanitized terms (no raw provider/error bodies in chat —
   * they persist; 3AK/3AL posture). `hint` is an optional vague-but-useful
   * human reason (e.g. the design couldn't be rendered) that wins over the
   * generic message — never pass raw error text as the hint.
   */
  private async _recoverFromFailure(
    sessionId: string,
    ctx: AiDesignerAgentContext,
    emitter: AiDesignerEmitter,
    err: unknown,
    recoveryState: AiDesignerSessionState,
    hint?: string
  ) {
    const text = hint ?? this._failureText(err);
    this._logger.warn(
      `AI Designer step failed for session ${sessionId}: ${
        (err as Error).message
      }`,
      AiDesignerConductorService.name
    );
    try {
      await this._service.updateSession(sessionId, ctx.orgId, ctx.userId, {
        state: recoveryState,
      });
      await this._emitText(
        sessionId,
        ctx,
        emitter,
        'conversationalist',
        text
      );
    } catch (recoverErr) {
      this._logger.warn(
        `AI Designer failure recovery failed for session ${sessionId}: ${
          (recoverErr as Error).message
        }`,
        AiDesignerConductorService.name
      );
    }
    emitter.error('agent_failed', text);
  }

  /**
   * Vague-but-useful hint for an execution failure whose raw message names a
   * render-side cause (an unparseable color, a bad gradient). Returns
   * undefined for anything else so the generic recovery text applies — the
   * raw error/stack never reaches chat.
   */
  private _renderFailureHint(err: unknown): string | undefined {
    const message = ((err as Error)?.message ?? '').toLowerCase();
    if (/parse color|invalid color|color failed|gradient/.test(message)) {
      return "The generated design couldn't be rendered — one of its colors was invalid. Please try again.";
    }
    return undefined;
  }

  private _failureText(err: unknown): string {
    if (err instanceof GuardrailViolation) {
      return "That request was blocked by this workspace's content guardrails.";
    }
    const message = (err as Error)?.message ?? '';
    if (/budget/i.test(message)) {
      return 'The AI budget for this workspace is exhausted — an admin can raise it under Settings → AI.';
    }
    if (/circuit open/i.test(message)) {
      return 'AI Designer is briefly paused after repeated provider failures — please try again in a minute.';
    }
    if (/timed out/i.test(message)) {
      return 'The AI provider took too long to respond — please try again.';
    }
    return 'I hit a problem while working on this — please try again.';
  }

  private _safeJson(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  // Plans are stored JSON and ride into later prompts, so both count and
  // serialized size must be bounded. 64 KB matches the brief-value byte guard.
  private static readonly MAX_PLANS_BYTES = 64 * 1024;

  private _parsePlans(
    response: AgentResponse,
    config: AiDesignerConfig
  ): DesignPlan[] {
    const parsed = this._safeJson(response.content) as any;
    let raw: DesignPlan[] = [];
    if (parsed?.type === 'plans' && Array.isArray(parsed.plans)) {
      raw = parsed.plans as DesignPlan[];
    } else if (Array.isArray(parsed)) {
      raw = parsed as DesignPlan[];
    }

    const validPlans: DesignPlan[] = [];
    for (const plan of raw) {
      if (
        plan &&
        typeof plan.variantId === 'string' &&
        plan.variantId &&
        typeof plan.skill === 'string' &&
        plan.skill
      ) {
        validPlans.push(plan);
      } else {
        this._logger.warn(
          'Dropping invalid plan item missing variantId or skill.',
          AiDesignerConductorService.name
        );
      }
    }

    const maxPlans = Math.min(config.variants ?? 10, 10);
    const kept = validPlans.slice(0, maxPlans);

    while (
      kept.length > 1 &&
      JSON.stringify(kept).length > AiDesignerConductorService.MAX_PLANS_BYTES
    ) {
      kept.pop();
    }
    if (
      kept.length > 0 &&
      JSON.stringify(kept).length > AiDesignerConductorService.MAX_PLANS_BYTES
    ) {
      this._logger.warn(
        'A single plan exceeded the 64 KB brief limit; keeping it for inspection.',
        AiDesignerConductorService.name
      );
    }

    return kept;
  }

  private _parseAssets(response: AgentResponse): {
    assets: Record<string, AssetResult>;
    wellFormed: boolean;
  } {
    const parsed = this._safeJson(response.content) as any;
    if (parsed?.type !== 'assets') {
      this._logger.warn(
        `Asset agent returned non-asset response (type=${parsed?.type ?? 'unparseable'}); composing without imagery.`
      );
      return { assets: {}, wellFormed: false };
    }
    if (!parsed.assets || Object.keys(parsed.assets).length === 0) {
      this._logger.warn('Asset agent returned zero assets; composing without imagery.');
    }
    return { assets: parsed.assets ?? {}, wellFormed: true };
  }

  private _parseCopy(response: AgentResponse): SlotTextMap {
    const parsed = this._safeJson(response.content) as any;
    if (parsed?.type !== 'copy') {
      this._logger.warn(
        `Copywriter returned non-copy response (type=${parsed?.type ?? 'unparseable'}); composing without copy.`
      );
      return {};
    }
    if (!parsed.texts || Object.keys(parsed.texts).length === 0) {
      this._logger.warn('Copywriter returned zero texts; composing without copy.');
    }
    return parsed.texts ?? {};
  }

  private _parseDesignDoc(response: AgentResponse): DesignerDoc {
    const parsed = this._safeJson(response.content) as any;
    if (parsed?.type === 'doc' && parsed.doc && typeof parsed.doc === 'object') {
      return parsed.doc as DesignerDoc;
    }
    throw new Error('Composer did not return a design doc');
  }

  // Hard ceiling on findings processed per critique pass. Findings are
  // LLM-shaped JSON and each freeform-note fix costs its own LLM re-emit in
  // the composer — without a cap one critic response could fan out into
  // dozens of sequential model calls.
  private static readonly MAX_FINDINGS_PER_CRITIQUE = 10;

  private _parseFindings(response: AgentResponse): {
    findings: VisionFinding[];
    skipped: boolean;
  } {
    const parsed = this._safeJson(response.content) as any;
    if (parsed?.type === 'error') {
      throw new Error(parsed.message || 'Vision critic returned an error');
    }
    // `skipped` marks a pass that never happened (image not inlinable,
    // unparseable reply) — it must not read as a clean zero-finding pass.
    const skipped = parsed?.skipped === true;
    const findings =
      parsed?.type === 'findings' && Array.isArray(parsed.findings)
        ? (parsed.findings as VisionFinding[])
        : [];
    if (findings.length > AiDesignerConductorService.MAX_FINDINGS_PER_CRITIQUE) {
      this._logger.warn(
        `Vision Critic returned ${findings.length} findings; capping to ${AiDesignerConductorService.MAX_FINDINGS_PER_CRITIQUE}.`,
        AiDesignerConductorService.name
      );
      return {
        findings: findings.slice(
          0,
          AiDesignerConductorService.MAX_FINDINGS_PER_CRITIQUE
        ),
        skipped,
      };
    }
    return { findings, skipped };
  }

  /**
   * Per-output element data (geometry, fills, z-order, truncated text) sent
   * with the critique dispatch — the critic uses it to catch low-contrast or
   * occluded elements the rendered pixels (or a downscaled contact sheet)
   * hide. `formatIds` scopes the summary to specific outputs.
   */
  private _critiqueDocSummary(doc: DesignerDoc, formatIds?: string[]) {
    const wanted = formatIds?.length ? new Set(formatIds) : undefined;
    return ((doc.outputs ?? []) as DesignerOutput[])
      .filter(
        (out) =>
          Array.isArray(out.children) &&
          (!wanted || wanted.has(out.formatId))
      )
      .map((out) => ({
        formatId: out.formatId,
        width: out.width,
        height: out.height,
        elements: out.children.map((el, z) => ({
          originId: el.originId,
          type: el.type,
          // Imagery carries no copy: a corrupted doc (text patched onto an
          // image by an old fix loop) must never echo marker strings back
          // into the critique prompt.
          text:
            el.type !== 'image' &&
            el.type !== 'icon' &&
            typeof el.text === 'string' &&
            el.text.trim()
              ? el.text.slice(0, 80)
              : undefined,
          fill: el.fill,
          x: el.x,
          y: el.y,
          width: el.width,
          height: el.height,
          z,
        })),
      }));
  }

  private async _emitText(
    sessionId: string,
    ctx: AiDesignerAgentContext,
    emitter: AiDesignerEmitter,
    agent: string,
    text: string
  ) {
    const msg = await this._service.appendMessage({
      sessionId,
      role: 'assistant',
      agent,
      kind: 'text',
      content: { kind: 'text', text },
    });
    emitter.toSession('message', msg);
  }

  private async _emitPlan(
    sessionId: string,
    ctx: AiDesignerAgentContext,
    emitter: AiDesignerEmitter,
    brief: DesignBrief,
    plans: DesignPlan[]
  ) {
    // A cancelled planning run must not write `awaiting_plan` (which would
    // resurrect the session the user just cancelled) or post the plan.
    this._throwIfCancelled(sessionId);
    // Persist the presented plans so accept executes exactly what the user saw
    // (and the revise vision re-check can reference them) — a re-dispatch
    // would generate different plans.
    await this._service.updateSession(sessionId, ctx.orgId, ctx.userId, {
      state: 'awaiting_plan',
      brief: { ...brief, lastPlans: plans },
    });
    const msg = await this._service.appendMessage({
      sessionId,
      role: 'assistant',
      agent: 'art-director',
      kind: 'plan',
      content: {
        kind: 'plan',
        // After a plan-stage revise the intent line shows what the user asked
        // for, not the stale pre-revision intent. The persisted brief (above)
        // keeps the real intent.
        brief: brief.revisionInstruction
          ? { ...brief, intent: brief.revisionInstruction as string }
          : brief,
        plans,
        actions: ['accept', 'revise'],
      },
    });
    emitter.toSession('message', msg);
    this._setOutstanding(sessionId, msg.id);
  }
}
