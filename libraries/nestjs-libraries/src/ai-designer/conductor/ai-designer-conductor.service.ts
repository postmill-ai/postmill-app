import '@gitroom/nestjs-libraries/ai-designer/agent-mesh/agent-mesh-env.shim';
import { Injectable, Logger } from '@nestjs/common';
import { dispatchToAgent } from '@reaatech/agent-mesh-router';
import { registryState } from '@reaatech/agent-mesh-registry';
import type { AgentResponse } from '@reaatech/agent-mesh';
import { DesignService } from '@gitroom/nestjs-libraries/database/prisma/design/design.service';
import { FileService } from '@gitroom/nestjs-libraries/database/prisma/file/file.service';
import type { DesignerDoc } from '@gitroom/nestjs-libraries/media/designer-doc/designer-doc.schema';
import { CHANNEL_PRESETS } from '@gitroom/nestjs-libraries/integrations/social/channel-presets';
import { GuardrailViolation } from '@gitroom/nestjs-libraries/ai/governance/errors';
import { AiDesignerService } from '../ai-designer.service';
import { mergeBriefValues, sanitizeBriefValues } from './brief-values';
import { AiDesignerSaverService } from '../ai-designer-saver.service';
import { AiDesignerComposerService } from '../agents/composer/ai-designer-composer.service';
import { AiDesignerBudgetGuard } from '../guards/ai-designer-budget.guard';
import { AiDesignerSkillRouter } from '../skills/ai-designer-skill-router.service';
import { AiDesignerInputPolicyService } from '../ai-designer-input-policy.service';
import { raceWithTimeout } from '../util/race-with-timeout';
import type {
  AiDesignerAgentContext,
  AiDesignerConfig,
  AiDesignerRenderResult,
  AiDesignerRevisePayload,
  AiDesignerSessionState,
  AssetResult,
  DesignBrief,
  DesignPlan,
  FormField,
  RevisionRequest,
  SlotTextMap,
  VisionFinding,
} from '../ai-designer.types';

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
    private readonly _policy: AiDesignerInputPolicyService
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
    const brief = this._brief(session);

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
      const targetDesignId =
        (brief.pendingReviseTarget as string | undefined) ||
        activeDesignIds[0];
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
      'I can help revise the design. Use the revise form below the previews, or describe the change you want.'
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
      // Server-owned brief keys (lastPlans, pendingReviseTarget, …) must never
      // come from the client — a forged `lastPlans` would let accept:plan
      // execute an unbounded, attacker-shaped plan list. The merge is also
      // size-bounded (a brief rides into every later agent prompt).
      const safeValues = sanitizeBriefValues(values);
      const existing = (session.brief ?? {}) as DesignBrief;
      const brief = mergeBriefValues(existing, safeValues, replyTo);
      await this._service.updateSession(sessionId, ctx.orgId, ctx.userId, { brief });
      await this._handleDeliveryFormSubmit(
        sessionId,
        ctx,
        replyTo,
        values,
        emitter
      );
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
        // busy path must not write the brief (plan §4.5).
        const safeValues = sanitizeBriefValues(values);
        const existing = (session.brief ?? {}) as DesignBrief;
        const brief = mergeBriefValues(existing, safeValues, replyTo);
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

  private async _handleDeliveryFormSubmit(
    sessionId: string,
    ctx: AiDesignerAgentContext,
    replyTo: string,
    values: Record<string, unknown>,
    emitter: AiDesignerEmitter
  ) {
    const session = await this._service.getSessionForUser(sessionId, ctx.orgId, ctx.userId);
    if (!session) return;

    const activeDesignIds = (session.activeDesignIds ?? []) as string[];
    const brief = this._brief(session);
    const answeredPromptIds = (brief.answeredPromptIds ?? []) as string[];

    // A double-submit of the same delivery form (e.g. double-click) carries a
    // fresh nonce, so Redis idempotency does not dedupe it. Track answered
    // prompt ids on the brief so the second submit is a silent no-op.
    if (answeredPromptIds.includes(replyTo)) {
      await this._emitText(
        sessionId,
        ctx,
        emitter,
        'conversationalist',
        'That request was already submitted.'
      );
      return;
    }

    // Mark this prompt answered immediately so a concurrent duplicate cannot
    // create duplicate templates/revisions. Keep the last ~20 ids.
    const nextBrief: DesignBrief = {
      ...brief,
      answeredPromptIds: [...answeredPromptIds, replyTo].slice(-20),
    };
    await this._service.updateSession(sessionId, ctx.orgId, ctx.userId, {
      brief: nextBrief,
    });

    const instruction = String(values.instruction || '').trim();
    if (instruction) {
      const targetDesignId =
        (brief.pendingReviseTarget as string | undefined) ||
        activeDesignIds[0];
      if (targetDesignId) {
        await this.handleRevise(
          sessionId,
          ctx,
          { instruction, targetDesignId, nonce: '' },
          emitter
        );
      }
      return;
    }

    const action = String(values.action || '');
    const selectedVariant = String(values.variantId || '');
    const chosenDesignId = selectedVariant || activeDesignIds[0];

    if (!activeDesignIds.includes(chosenDesignId)) {
      await this._emitText(
        sessionId,
        ctx,
        emitter,
        'conversationalist',
        'That variant is no longer available.'
      );
      return;
    }

    const optedOut =
      Array.isArray(values.dontSaveTemplate) &&
      values.dontSaveTemplate.includes('yes');

    // Auto-save on accept unless the user opted out (plan §10).
    if (action === 'accept' && !optedOut && activeDesignIds.length > 0) {
      const genre = brief.skillId as string | undefined;
      const saved = await this._createTemplate(
        ctx.orgId,
        chosenDesignId,
        chosenDesignId.slice(0, 8),
        genre
      );
      await this._emitText(
        sessionId,
        ctx,
        emitter,
        'conversationalist',
        saved
          ? 'Template saved.'
          : "Couldn't save the template — the design is still available; try again from the delivery form."
      );
    }

    if (action === 'revise') {
      const msg = await this._service.appendMessage({
        sessionId,
        role: 'assistant',
        agent: 'conversationalist',
        kind: 'form',
        content: {
          kind: 'form',
          prompt: 'What would you like to change?',
          fields: [
            {
              name: 'instruction',
              type: 'text',
              label: 'Revision instruction',
              placeholder: 'e.g. Make the headline bigger',
            },
          ],
          submitLabel: 'Revise',
        },
      });
      emitter.toSession('message', msg);
      this._setOutstanding(sessionId, msg.id);

      // Store the target design id on the session brief so the next turn can use it.
      await this._service.updateSession(sessionId, ctx.orgId, ctx.userId, {
        brief: { ...nextBrief, pendingReviseTarget: chosenDesignId },
      });
      return;
    }

    if (action === 'accept') {
      await this._emitText(
        sessionId,
        ctx,
        emitter,
        'conversationalist',
        'Great! Let me know if you need any other changes.'
      );
    }
  }

  async handleAcceptPlan(
    sessionId: string,
    ctx: AiDesignerAgentContext,
    replyTo: string,
    variantId: string | undefined,
    saveTemplate: boolean | undefined,
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
    const acceptedPlans = variantId
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

    if (!this._tryAcquire(sessionId)) {
      await this._emitBusy(sessionId, ctx, emitter);
      return;
    }
    this._clearOutstanding(sessionId);

    await this._service.updateSession(sessionId, ctx.orgId, ctx.userId, { state: 'executing' });
    await this._emitText(
      sessionId,
      ctx,
      emitter,
      'conversationalist',
      'Plan accepted. Executing the design (this may take a moment).'
    );

    try {
      const results = await this._executePipeline(
        sessionId,
        ctx,
        config,
        brief,
        emitter,
        acceptedPlans.length > 0 ? acceptedPlans : undefined
      );

      const activeDesignIds = results.map((r) => r.designId);
      await this._service.updateSession(sessionId, ctx.orgId, ctx.userId, {
        state: 'delivered',
        activeDesignIds,
      });

      await this._emitDelivery(sessionId, ctx, emitter, results);

      // Explicit plan-level opt-in (the delivery form's accept flow handles
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
            : "Couldn't save the template — the design is still available; try again from the delivery form."
        );
      }
    } catch (err) {
      if (this._wasCancelled(err)) {
        this._logger.log(`AI Designer pipeline cancelled for session ${sessionId}`);
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

  async handleRevise(
    sessionId: string,
    ctx: AiDesignerAgentContext,
    payload: AiDesignerRevisePayload,
    emitter: AiDesignerEmitter
  ) {
    const session = await this._service.getSessionForUser(sessionId, ctx.orgId, ctx.userId);
    if (!session) return;

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

    await this._service.updateSession(sessionId, ctx.orgId, ctx.userId, { state: 'revising' });

    await this._emitText(
      sessionId,
      ctx,
      emitter,
      'conversationalist',
      `Revising: ${instruction}`
    );

    try {
      const revision = await this._extractRevision(
        ctx,
        instruction,
        activeDesignIds,
        session.mode
      );
      const revised = await this._reviseDesign(
        sessionId,
        ctx,
        targetDesignId,
        revision,
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
      await this._service.updateSession(sessionId, ctx.orgId, ctx.userId, {
        state: 'delivered',
        activeDesignIds: [revised.designId],
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

  private async _runPromptMode(
    sessionId: string,
    ctx: AiDesignerAgentContext,
    config: AiDesignerConfig,
    prompt: string,
    emitter: AiDesignerEmitter
  ) {
    await this._service.updateSession(sessionId, ctx.orgId, ctx.userId, { state: 'planning' });
    await this._appendProgress(sessionId, 'art-director', 'planning');
    const referenceCues = await this._interpretReferences(
      ctx,
      config.referenceFileIds
    );
    const brief: DesignBrief = { intent: prompt, referenceCues };
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

    // Once the brief has the required fields, present plans — regardless of
    // whether this turn came from free text or a completed intake form (the
    // form path passes no `text`; it must still advance the session).
    const required = ['intent', 'audience', 'tone'];
    const hasRequired = required.every((k) => Boolean((brief as any)[k]));
    if (hasRequired && (session?.state ?? 'intake') === 'intake') {
      await this._runPlanPresentation(sessionId, ctx, config, brief, emitter);
      return;
    }

    const convResponse = await this._dispatchAgent(ctx, 'conversationalist', {
      type: 'chat',
      text: text ?? '',
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

    if (parsed?.type === 'form') {
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
    const enriched: DesignBrief = { ...brief, referenceCues };
    await this._service.updateSession(sessionId, ctx.orgId, ctx.userId, { brief: enriched });

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
    await this._appendProgress(sessionId, 'composer', 'executing');

    emitter.progress('asset', 'Generating shared assets', undefined, 'Generating imagery');

    const assetResponse = await this._dispatchAgent(ctx, 'asset', {
      type: 'asset-request',
      assetNeeds: this._collectAssetNeeds(plans),
      referenceFileIds: config.referenceFileIds,
    });
    const assets = this._parseAssets(assetResponse);

    const results: AiDesignerRenderResult[] = [];
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

        const copyResponse = await this._dispatchAgent(ctx, 'copywriter', {
          type: 'copy-request',
          plan,
          brand: null,
        });
        const copy = this._parseCopy(copyResponse);

        const composerResponse = await this._dispatchAgent(ctx, 'composer', {
          type: 'compose-request',
          plan,
          copy,
          assets,
          outputs,
          orgId: ctx.orgId,
          userId: ctx.userId,
        });
        // The composer returns the doc without persisting — the saver is the
        // single Design writer (one row per variant, no orphans).
        const composedDoc = this._parseDesignDoc(composerResponse);

        this._throwIfCancelled(sessionId);
        const render = await this._saver.saveDesign(
          ctx.orgId,
          ctx.userId,
          plan.variantId,
          composedDoc,
          {
            name: `${plan.skill}-${plan.variantId}`,
            saveFolderId,
          }
        );

        results.push(render);
        emitter.preview(render);
      } catch (err) {
        if (this._wasCancelled(err)) throw err;
        lastError = err;
        this._logger.warn(
          `Variant ${plan.variantId} failed: ${(err as Error).message}`,
          AiDesignerConductorService.name
        );
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
      if (!result.contactSheetUrl) continue;

      try {
        const planForVariant = plans.find((p) => p.variantId === result.variantId);
        const criticResponse = await this._dispatchAgent(ctx, 'vision-critic', {
          type: 'critique-request',
          contactSheetUrl: result.contactSheetUrl,
          plans,
          outputs,
          rubric: this._skillRouter.getRubric(planForVariant?.skill ?? plans[0]?.skill ?? 'meme'),
          outputPreviews: result.outputPreviews.map((o) => ({
            formatId: o.formatId,
            url: o.url,
          })),
        });
        const findings = this._parseFindings(criticResponse);
        if (findings.length === 0) continue;

        this._logger.log(
          `Vision Critic found ${findings.length} issues for ${result.variantId}; auto-revising once.`
        );

        const doc = await this._loadDesignDoc(ctx.orgId, result.designId);
        const revisedDoc = await this._composer.applyFixes(
          doc,
          findings,
          ctx.orgId,
          this._aborts.get(sessionId)?.signal
        );
        const revised = await this._saver.saveDesign(
          ctx.orgId,
          ctx.userId,
          `${result.variantId}-revised`,
          revisedDoc,
          {
            name: `${plans[0]?.skill ?? 'ai-design'}-${result.variantId}-revised`,
            saveFolderId,
          }
        );
        results[i] = revised;
        emitter.preview(revised);
      } catch (err) {
        if (this._wasCancelled(err)) throw err;
        this._logger.warn(
          `Vision critique/auto-revise failed for ${result.variantId}: ${
            (err as Error).message
          }`,
          AiDesignerConductorService.name
        );
      }
    }

    return results;
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
  // every need), turning one accepted plan into unbounded spend.
  private static readonly MAX_ASSET_NEEDS = 8;

  private _collectAssetNeeds(
    plans: DesignPlan[]
  ): { slotId: string; brief: string; prefer: 'generate' | 'stock' | 'either' }[] {
    const seen = new Set<string>();
    const needs: { slotId: string; brief: string; prefer: 'generate' | 'stock' | 'either' }[] = [];
    for (const plan of plans) {
      for (const need of plan.assetNeeds ?? []) {
        if (!seen.has(need.slotId)) {
          seen.add(need.slotId);
          needs.push(need);
        }
      }
    }
    if (needs.length > AiDesignerConductorService.MAX_ASSET_NEEDS) {
      this._logger.warn(
        `Plans requested ${needs.length} assets; capping to ${AiDesignerConductorService.MAX_ASSET_NEEDS}.`,
        AiDesignerConductorService.name
      );
      return needs.slice(0, AiDesignerConductorService.MAX_ASSET_NEEDS);
    }
    return needs;
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
    results: AiDesignerRenderResult[]
  ) {
    const mediaItems = results.flatMap((r) =>
      r.outputPreviews.map((o) => ({
        url: o.url,
        type: 'image' as const,
        caption: `${r.variantId} · ${o.formatId}`,
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

    const fields: FormField[] = [];

    if (results.length > 1) {
      fields.push({
        name: 'variantId',
        type: 'radio',
        label: 'Choose a variant',
        options: results.map((r, i) => ({
          value: r.designId,
          label: `Variant ${i + 1}`,
        })),
      });
    }

    fields.push(
      {
        // Auto-save on accept (plan §10); this is the "don't save" opt-out.
        name: 'dontSaveTemplate',
        type: 'checkbox',
        label: 'Template',
        options: [
          { value: 'yes', label: "Don't save this design as a reusable template" },
        ],
      },
      {
        name: 'action',
        type: 'radio',
        label: 'Action',
        options: [
          { value: 'accept', label: 'Looks good' },
          { value: 'revise', label: 'Request changes' },
        ],
      }
    );

    const formMsg = await this._service.appendMessage({
      sessionId,
      role: 'assistant',
      agent: 'conversationalist',
      kind: 'form',
      content: {
        kind: 'form',
        prompt: 'Choose what to do next.',
        fields,
        submitLabel: 'Submit',
      },
    });
    emitter.toSession('message', formMsg);
    this._setOutstanding(sessionId, formMsg.id);
    // Template auto-save happens when the user accepts the delivered design
    // (`_handleDeliveryFormSubmit`, action=accept), so it can honor the
    // "don't save" opt-out. Not saved here — that would double-save and ignore
    // the opt-out (plan §10).
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
    phase: string
  ) {
    // Persisted phase-transition row so progress survives reload (plan §5).
    await this._service.appendMessage({
      sessionId,
      role: 'agent',
      agent,
      kind: 'progress',
      content: { kind: 'progress', agent, phase },
    });
  }

  private async _extractRevision(
    ctx: AiDesignerAgentContext,
    instruction: string,
    activeDesignIds: string[],
    mode: string
  ): Promise<RevisionRequest> {
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
        return parsed.revision as RevisionRequest;
      }
    }

    return {
      instruction,
      targetDesignId: activeDesignIds[0],
      scope: 'shared',
    };
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
    let render = await this._saver.saveDesign(
      ctx.orgId,
      ctx.userId,
      `revised-${Date.now()}`,
      revisedDoc,
      {
        name: `ai-design-revised`,
        saveFolderId,
      }
    );

    // Vision-Critic re-check (K=1) before re-delivery (plan §10).
    if (render.contactSheetUrl) {
      this._throwIfCancelled(sessionId);
      try {
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
        });
        const findings = this._parseFindings(criticResponse);
        if (findings.length > 0) {
          revisedDoc = await this._composer.applyFixes(
            revisedDoc,
            findings,
            ctx.orgId,
            this._aborts.get(sessionId)?.signal
          );
          // Re-render the SAME Design row — a second saveDesign here would
          // orphan the pre-fix row (+ its preview files) on every revise.
          render = await this._saver.updateDesign(
            ctx.orgId,
            render.designId,
            `revised-${Date.now()}`,
            revisedDoc,
            {
              name: `ai-design-revised`,
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
   * they persist; 3AK/3AL posture).
   */
  private async _recoverFromFailure(
    sessionId: string,
    ctx: AiDesignerAgentContext,
    emitter: AiDesignerEmitter,
    err: unknown,
    recoveryState: AiDesignerSessionState
  ) {
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
        this._failureText(err)
      );
    } catch (recoverErr) {
      this._logger.warn(
        `AI Designer failure recovery failed for session ${sessionId}: ${
          (recoverErr as Error).message
        }`,
        AiDesignerConductorService.name
      );
    }
    emitter.error('agent_failed', this._failureText(err));
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

  private _parseAssets(response: AgentResponse): Record<string, AssetResult> {
    const parsed = this._safeJson(response.content) as any;
    return parsed?.type === 'assets' ? parsed.assets : {};
  }

  private _parseCopy(response: AgentResponse): SlotTextMap {
    const parsed = this._safeJson(response.content) as any;
    return parsed?.type === 'copy' ? parsed.texts : {};
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

  private _parseFindings(response: AgentResponse): VisionFinding[] {
    const parsed = this._safeJson(response.content) as any;
    if (parsed?.type === 'error') {
      throw new Error(parsed.message || 'Vision critic returned an error');
    }
    const findings =
      parsed?.type === 'findings' && Array.isArray(parsed.findings)
        ? (parsed.findings as VisionFinding[])
        : [];
    if (findings.length > AiDesignerConductorService.MAX_FINDINGS_PER_CRITIQUE) {
      this._logger.warn(
        `Vision Critic returned ${findings.length} findings; capping to ${AiDesignerConductorService.MAX_FINDINGS_PER_CRITIQUE}.`,
        AiDesignerConductorService.name
      );
      return findings.slice(
        0,
        AiDesignerConductorService.MAX_FINDINGS_PER_CRITIQUE
      );
    }
    return findings;
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
        brief,
        plans,
        actions: ['accept', 'revise'],
      },
    });
    emitter.toSession('message', msg);
    this._setOutstanding(sessionId, msg.id);
  }
}
