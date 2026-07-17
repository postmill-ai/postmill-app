import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  AuthContextResolver,
  AuthContextResult,
} from '@gitroom/nestjs-libraries/auth/auth-context.resolver';
import { RolesService } from '@gitroom/nestjs-libraries/database/prisma/roles/roles.service';
import { PermissionsService } from '@gitroom/backend/services/auth/permissions/permissions.service';
import { AiDesignerService } from '@gitroom/nestjs-libraries/ai-designer/ai-designer.service';
import { AiDesignerBudgetGuard } from '@gitroom/nestjs-libraries/ai-designer/guards/ai-designer-budget.guard';
import { AiDesignerDefaultsGate } from '@gitroom/nestjs-libraries/ai-designer/guards/ai-designer-defaults.gate';
import { AiDesignerIdempotencyService } from '@gitroom/nestjs-libraries/ai-designer/ai-designer-idempotency.service';
import { toAiDesignerSessionDto } from '@gitroom/nestjs-libraries/ai-designer/ai-designer.types';
import {
  StartAiDesignerSessionDto,
  AiDesignerMessageDto,
  AiDesignerFormSubmitDto,
  AiDesignerAcceptPlanDto,
  AiDesignerReviseDto,
} from '@gitroom/nestjs-libraries/dtos/ai-designer/start-ai-designer-session.dto';
import { AiDesignerConductorService } from '@gitroom/nestjs-libraries/ai-designer/conductor/ai-designer-conductor.service';
import { AiDesignerInputPolicyService } from '@gitroom/nestjs-libraries/ai-designer';
import { resolveClientIp } from '@gitroom/nestjs-libraries/utils/client-ip';

interface SocketContext {
  userId: string;
  orgId: string;
  isSuperAdmin: boolean;
  roleKey: string;
  orgCreatedAt: Date;
  sessionId?: string;
  lastAcked: number;
  lastAuthzAt: number;
}

const CSRF_COOKIE = 'csrf_token';
const CSRF_HEADER = 'x-csrf-token';
const ORG_HEADER = 'showorg';
const IMPERSONATE_COOKIE = 'impersonate';
const IMPERSONATE_HEADER = 'impersonate';

// How long a socket's membership/RBAC/billing snapshot stays trusted before a
// mutating event forces a re-check. HTTP re-runs its guards on every request;
// this keeps a long-lived socket within a minute of that.
const REAUTHZ_INTERVAL_MS = 60_000;

// Per-user, per-event fixed-window budgets. Every accepted mutating event
// can fan out into LLM dispatches and full renders, and the HTTP throttler
// does not cover gateways — this is the websocket equivalent. Keyed by user
// (not socket) so opening fresh sockets does not reset the window. Buckets
// reset fully at `resetAt`, matching the HTTP throttler's fixed-window style.
const RATE_LIMITS: Record<string, { limit: number; windowMs: number }> = {
  start: { limit: 5, windowMs: 60_000 },
  message: { limit: 20, windowMs: 60_000 },
  'form:submit': { limit: 10, windowMs: 60_000 },
  'accept:plan': { limit: 10, windowMs: 60_000 },
  revise: { limit: 10, windowMs: 60_000 },
  cancel: { limit: 10, windowMs: 60_000 },
};

// Sweep expired rate buckets when the map grows past this many entries.
const RATE_BUCKET_SWEEP_SIZE = 10_000;

// Per-IP budget on connection *attempts* (pre-authentication). Every handshake
// runs JWT verify + user/org lookups before it can be rejected, and neither
// the HTTP throttler nor the per-event RATE_LIMITS covers the connection
// itself. `TRUST_PROXY_HOPS` (env, int >= 1) opts into using the Nth-from-right
// entry of `x-forwarded-for` as the client IP; when unset we keep
// `handshake.address` to avoid spoofing regressions.
const CONNECT_RATE_LIMIT = { limit: 120, windowMs: 60_000 };

// Per-user budget on connection *attempts* (post-authentication). This is the
// bucket that actually stops authenticated abuse; the per-IP bucket is only a
// pre-auth backstop.
const USER_CONNECT_RATE_LIMIT = { limit: 30, windowMs: 60_000 };

// Default age at which a planning/executing session is considered stuck and
// rolled back to awaiting_plan on reconnect. Overridable via
// AI_DESIGNER_STUCK_SESSION_MINUTES (parsed defensively).
const DEFAULT_STUCK_SESSION_MINUTES = 15;

const ERROR_MESSAGES: Record<string, string> = {
  missing_auth: 'Authentication required.',
  auth_failed: 'Authentication failed — sign in again.',
  invalid_jwt: 'Your session is invalid or has expired — sign in again.',
  user_not_found: 'User not found or not activated.',
  no_org: 'No active organization for this user.',
  csrf_failed: 'Security check failed — refresh the page and try again.',
  rbac_membership: 'You are no longer a member of this workspace.',
  rbac_media_create:
    'You need the media-create permission to use the AI Designer.',
  billing_ai: 'Your plan does not include AI features.',
  invalid_payload: 'The request failed validation.',
  duplicate_nonce: 'Duplicate request ignored.',
  budget_exceeded: 'The AI budget for this workspace is exhausted.',
  guardrail_blocked:
    "Your message was blocked by this workspace's content guardrails.",
  no_session: 'No active design session.',
  not_ready: 'The connection is still authenticating — try again.',
  rate_limited: 'Too many requests — please slow down.',
  session_limit:
    'You have too many AI Designer sessions — delete some old ones and try again.',
  session_not_found: 'Design session not found.',
  internal_error: 'Something went wrong.',
};

async function validatePayload<T extends object>(
  cls: new () => T,
  raw: unknown
): Promise<T | null> {
  const instance = plainToInstance(cls, raw ?? {});
  const errors = await validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  if (errors.length > 0) {
    return null;
  }
  return instance;
}

@WebSocketGateway({
  namespace: '/ai-designer',
  cors: {
    // An unset FRONTEND_URL must not leave `undefined` in the list — the
    // polling handshake would then reject every origin with no clear signal.
    origin: [process.env.FRONTEND_URL, process.env.MAIN_URL].filter(
      (o): o is string => Boolean(o)
    ),
    credentials: true,
  },
})
export class AiDesignerGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(AiDesignerGateway.name);

  // Per-user rate buckets (`${userId}:${event}`), shared across that user's
  // sockets, plus per-IP and per-user connect buckets. Expired entries are
  // swept once the map grows large. In-process by design: the gateway assumes
  // a single instance (or sticky sessions), consistent with the in-memory
  // Socket.IO adapter — see the deployment note in docs/developer-docs/designer.md.
  private readonly _rateBuckets = new Map<
    string,
    { count: number; resetAt: number }
  >();

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly _service: AiDesignerService,
    private readonly _authContext: AuthContextResolver,
    private readonly _roles: RolesService,
    private readonly _permissions: PermissionsService,
    private readonly _budgetGuard: AiDesignerBudgetGuard,
    private readonly _defaultsGate: AiDesignerDefaultsGate,
    private readonly _idempotency: AiDesignerIdempotencyService,
    private readonly _conductor: AiDesignerConductorService,
    private readonly _policy: AiDesignerInputPolicyService
  ) {}

  onModuleInit() {
    if (!process.env.FRONTEND_URL && !process.env.MAIN_URL) {
      this.logger.warn(
        'Both FRONTEND_URL and MAIN_URL are unset: the /ai-designer namespace will accept ' +
          'polling-transport handshakes from no origin. Long-polling clients will be rejected.',
        AiDesignerGateway.name
      );
    }
  }

  async handleConnection(client: Socket) {
    try {
      // Cheapest check first: per-IP connection budget, before any JWT/DB work.
      if (!this._connectRateLimit(client)) {
        this._disconnect(client, 'rate_limited');
        return;
      }

      const auth = await this._authenticate(client);
      if (!auth) {
        return;
      }
      const { requestedSessionId, ctx } = auth;

      // Nest binds message handlers before handleConnection resolves, so ctx
      // must never carry an unvalidated sessionId: a handler racing this await
      // would otherwise write into a session the user doesn't own.
      client.data.ctx = ctx;

      if (requestedSessionId) {
        await this._joinSessionRoom(client, requestedSessionId, ctx);
      } else {
        client.emit('session:state', { session: null, messages: [] });
      }
    } catch (err) {
      this.logger.warn(
        `Connection error: ${(err as Error).message}`,
        AiDesignerGateway.name
      );
      this._disconnect(client, 'internal_error');
    }
  }

  handleDisconnect() {
    // Per-socket state (`lastAcked`) is intentionally ephemeral. The client
    // may send its last acked sequence on reconnect via handshake auth/query.
  }

  @SubscribeMessage('ack')
  handleAck(@ConnectedSocket() client: Socket, @MessageBody() payload: unknown) {
    const ctx = this._requireCtx(client);
    if (!ctx) {
      return;
    }
    const seq = Number((payload as { seq?: unknown } | null)?.seq);
    if (Number.isFinite(seq)) {
      ctx.lastAcked = Math.max(ctx.lastAcked, seq);
    }
  }

  @SubscribeMessage('start')
  async handleStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() raw: unknown
  ) {
    const ctx = await this._gate(client, 'start');
    if (!ctx) {
      return;
    }

    const payload = await validatePayload(StartAiDesignerSessionDto, raw);
    if (!payload) {
      this._emitError(client, 'invalid_payload');
      return;
    }

    const ok = await this._idempotency.start(
      payload.nonce,
      ctx.userId,
      ctx.orgId
    );
    if (!ok) {
      this._emitError(client, 'duplicate_nonce', { nonce: payload.nonce });
      return;
    }

    // Every rejection below releases the nonce — it was claimed but nothing
    // was created, so a legitimate retry with the same nonce must not be
    // locked out for the full idempotency TTL.
    const reject = async (code: string, opts?: { message?: string }) => {
      await this._idempotency.releaseStart(
        payload.nonce,
        ctx.userId,
        ctx.orgId
      );
      this._emitError(client, code, { ...opts, nonce: payload.nonce });
    };

    // The cap check-then-create can race: two parallel `start` events may both
    // see 99 sessions and both create. Worst case the user ends up with 101
    // instead of 100 — harmless, and a strict atomic check would require a
    // cross-request lock we do not yet have.
    let session: any;
    try {
      if (await this._service.atSessionCap(ctx.orgId, ctx.userId)) {
        await reject('session_limit');
        return;
      }

      const defaultsCheck = await this._defaultsGate.missingDefaults(
        ctx.orgId
      );
      if (defaultsCheck.blocked) {
        // Plan §11: post a markdown chat message naming the missing categories and
        // routing to Settings → AI → Model Defaults, then do not proceed. (The
        // error event is also emitted for programmatic clients.)
        client.emit('message', {
          id: 'missing-defaults',
          seq: -1,
          role: 'assistant',
          kind: 'markdown',
          content: {
            kind: 'markdown',
            md: this._defaultsGate.missingDefaultsMarkdown(
              defaultsCheck.missing
            ),
          },
        });
        await reject(`missing_defaults:${defaultsCheck.missing.join(',')}`, {
          message: `AI Designer needs these model defaults configured: ${defaultsCheck.missing.join(
            ', '
          )}. Set them under Settings → AI → Model Defaults.`,
        });
        return;
      }

      const budgetCheck = await this._budgetGuard.checkStartBudget(ctx.orgId);
      if (!budgetCheck.allowed) {
        await reject(budgetCheck.reason ?? 'budget_exceeded');
        return;
      }

      // Input guardrails (org's @reaatech/guardrail-chain) run before anything
      // is persisted, so a blocked/redacted prompt never lands in the session.
      const promptCheck = await this._policy.check(
        { values: {}, instruction: payload.prompt },
        ctx.orgId
      );
      if (promptCheck.ok === false) {
        await reject(
          promptCheck.reason === 'guardrail_blocked'
            ? 'guardrail_blocked'
            : 'invalid_payload',
          { message: promptCheck.message }
        );
        return;
      }
      const prompt = promptCheck.instruction;

      session = await this._service.createSession({
        organizationId: ctx.orgId,
        userId: ctx.userId,
        mode: payload.mode,
        config: payload.config,
        brief: prompt ? { intent: prompt } : undefined,
      });

      if (ctx.sessionId && ctx.sessionId !== session.id) {
        client.leave(`session:${ctx.sessionId}`);
      }
      ctx.sessionId = session.id;
      await client.join(`session:${session.id}`);

      if (prompt) {
        const userMsg = await this._service.appendMessage({
          sessionId: session.id,
          role: 'user',
          kind: 'text',
          content: { kind: 'text', text: prompt },
        });
        this.server
          .to(`session:${session.id}`)
          .emit('message', { ...userMsg, nonce: payload.nonce });
      }

      await this._emitSessionState(client, ctx);

      const emitter = this._makeEmitter(client, ctx);
      await this._conductor.handleStart(
        session.id,
        { orgId: ctx.orgId, userId: ctx.userId, sessionId: session.id },
        payload.config,
        prompt,
        emitter,
        session.mode as 'chat' | 'prompt'
      );
    } catch (err) {
      // Unexpected throw after the claim (the reject paths above return
      // normally and have already released). Best-effort delete the row we may
      // have just created so it does not count toward the 100-session cap.
      if (session) {
        try {
          await this._service.deleteSession(
            session.id,
            ctx.orgId,
            ctx.userId
          );
        } catch (delErr) {
          this.logger.warn(
            `Failed to clean up orphaned session ${session.id}: ${
              (delErr as Error)?.message ?? delErr
            }`,
            AiDesignerGateway.name
          );
        }
      }
      await this._failClaimed(
        client,
        'start',
        payload.nonce,
        () =>
          this._idempotency.releaseStart(payload.nonce, ctx.userId, ctx.orgId),
        err
      );
    }
  }

  @SubscribeMessage('message')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() raw: unknown
  ) {
    const ctx = await this._gate(client, 'message');
    if (!ctx) {
      return;
    }
    if (!ctx.sessionId) {
      this._emitError(client, 'no_session');
      return;
    }

    const payload = await validatePayload(AiDesignerMessageDto, raw);
    if (!payload) {
      this._emitError(client, 'invalid_payload');
      return;
    }

    // Defense-in-depth: re-verify ownership before the only handler-side write
    // (`appendMessage` itself is sessionId-scoped, not org-scoped).
    const session = await this._service.getSessionForUser(
      ctx.sessionId,
      ctx.orgId,
      ctx.userId
    );
    if (!session) {
      this._emitError(client, 'session_not_found');
      return;
    }

    // Claimed after the ownership check so a session_not_found rejection
    // never burns the nonce. A resent `message` (reconnect/auto-retry) must
    // not append the chat row and dispatch the conductor twice.
    const ok = await this._idempotency.forSession(payload.nonce, ctx.sessionId);
    if (!ok) {
      this._emitError(client, 'duplicate_nonce', { nonce: payload.nonce });
      return;
    }

    try {
      // Input guardrails before persist — a blocked message never lands in chat.
      const textCheck = await this._policy.check(
        { values: {}, instruction: payload.text },
        ctx.orgId
      );
      if (textCheck.ok === false) {
        // Nothing was persisted — release the nonce so a corrected retry with
        // the same nonce is not locked out for the idempotency TTL.
        await this._idempotency.releaseForSession(
          payload.nonce,
          ctx.sessionId
        );
        this._emitError(
          client,
          textCheck.reason === 'guardrail_blocked'
            ? 'guardrail_blocked'
            : 'invalid_payload',
          { nonce: payload.nonce, message: textCheck.message }
        );
        return;
      }
      const text = textCheck.instruction as string;

      const userMsg = await this._service.appendMessage({
        sessionId: ctx.sessionId,
        role: 'user',
        kind: 'text',
        content: { kind: 'text', text },
      });
      this.server
        .to(`session:${ctx.sessionId}`)
        .emit('message', { ...userMsg, nonce: payload.nonce });

      const emitter = this._makeEmitter(client, ctx);
      await this._conductor.handleMessage(
        ctx.sessionId,
        { orgId: ctx.orgId, userId: ctx.userId, sessionId: ctx.sessionId },
        text,
        emitter
      );
    } catch (err) {
      const { sessionId } = ctx;
      await this._failClaimed(
        client,
        'message',
        payload.nonce,
        () => this._idempotency.releaseForSession(payload.nonce, sessionId),
        err
      );
    }
  }

  @SubscribeMessage('form:submit')
  async handleFormSubmit(
    @ConnectedSocket() client: Socket,
    @MessageBody() raw: unknown
  ) {
    const ctx = await this._gate(client, 'form:submit');
    if (!ctx) {
      return;
    }
    if (!ctx.sessionId) {
      this._emitError(client, 'no_session');
      return;
    }

    const payload = await validatePayload(AiDesignerFormSubmitDto, raw);
    if (!payload) {
      this._emitError(client, 'invalid_payload');
      return;
    }

    // Shared input policy: size/depth bounds, key validation, and the org's
    // guardrail chain run before anything is claimed or persisted. The
    // conductor re-runs the same check idempotently for non-websocket callers.
    const valuesCheck = await this._policy.check(
      { values: payload.values },
      ctx.orgId
    );
    if (valuesCheck.ok === false) {
      this._emitError(
        client,
        valuesCheck.reason === 'guardrail_blocked'
          ? 'guardrail_blocked'
          : 'invalid_payload',
        { nonce: payload.nonce, message: valuesCheck.message }
      );
      return;
    }

    const ok = await this._idempotency.forSession(payload.nonce, ctx.sessionId);
    if (!ok) {
      this._emitError(client, 'duplicate_nonce', { nonce: payload.nonce });
      return;
    }

    try {
      const emitter = this._makeEmitter(client, ctx);
      await this._conductor.handleFormSubmit(
        ctx.sessionId,
        { orgId: ctx.orgId, userId: ctx.userId, sessionId: ctx.sessionId },
        payload.replyTo,
        valuesCheck.values,
        emitter
      );
    } catch (err) {
      const { sessionId } = ctx;
      await this._failClaimed(
        client,
        'form:submit',
        payload.nonce,
        () => this._idempotency.releaseForSession(payload.nonce, sessionId),
        err
      );
    }
  }

  @SubscribeMessage('accept:plan')
  async handleAcceptPlan(
    @ConnectedSocket() client: Socket,
    @MessageBody() raw: unknown
  ) {
    const ctx = await this._gate(client, 'accept:plan');
    if (!ctx) {
      return;
    }
    if (!ctx.sessionId) {
      this._emitError(client, 'no_session');
      return;
    }

    const payload = await validatePayload(AiDesignerAcceptPlanDto, raw);
    if (!payload) {
      this._emitError(client, 'invalid_payload');
      return;
    }

    const ok = await this._idempotency.forSession(payload.nonce, ctx.sessionId);
    if (!ok) {
      this._emitError(client, 'duplicate_nonce', { nonce: payload.nonce });
      return;
    }

    try {
      const emitter = this._makeEmitter(client, ctx);
      await this._conductor.handleAcceptPlan(
        ctx.sessionId,
        { orgId: ctx.orgId, userId: ctx.userId, sessionId: ctx.sessionId },
        payload.replyTo,
        payload.variantId,
        payload.saveTemplate,
        emitter
      );
    } catch (err) {
      const { sessionId } = ctx;
      await this._failClaimed(
        client,
        'accept:plan',
        payload.nonce,
        () => this._idempotency.releaseForSession(payload.nonce, sessionId),
        err
      );
    }
  }

  @SubscribeMessage('revise')
  async handleRevise(
    @ConnectedSocket() client: Socket,
    @MessageBody() raw: unknown
  ) {
    const ctx = await this._gate(client, 'revise');
    if (!ctx) {
      return;
    }
    if (!ctx.sessionId) {
      this._emitError(client, 'no_session');
      return;
    }

    const payload = await validatePayload(AiDesignerReviseDto, raw);
    if (!payload) {
      this._emitError(client, 'invalid_payload');
      return;
    }

    const ok = await this._idempotency.forSession(payload.nonce, ctx.sessionId);
    if (!ok) {
      this._emitError(client, 'duplicate_nonce', { nonce: payload.nonce });
      return;
    }

    try {
      // Input guardrails before dispatch — the conductor relies on every path
      // into handleRevise being checked here or on the message/form handlers.
      const instructionCheck = await this._policy.check(
        { values: {}, instruction: payload.instruction },
        ctx.orgId
      );
      if (instructionCheck.ok === false) {
        // Nothing was dispatched — release the nonce (see form:submit).
        await this._idempotency.releaseForSession(
          payload.nonce,
          ctx.sessionId
        );
        this._emitError(
          client,
          instructionCheck.reason === 'guardrail_blocked'
            ? 'guardrail_blocked'
            : 'invalid_payload',
          { nonce: payload.nonce, message: instructionCheck.message }
        );
        return;
      }
      const instruction = instructionCheck.instruction as string;

      const emitter = this._makeEmitter(client, ctx);
      await this._conductor.handleRevise(
        ctx.sessionId,
        { orgId: ctx.orgId, userId: ctx.userId, sessionId: ctx.sessionId },
        {
          instruction,
          targetDesignId: payload.targetDesignId,
          nonce: payload.nonce,
        },
        emitter
      );
    } catch (err) {
      const { sessionId } = ctx;
      await this._failClaimed(
        client,
        'revise',
        payload.nonce,
        () => this._idempotency.releaseForSession(payload.nonce, sessionId),
        err
      );
    }
  }

  @SubscribeMessage('cancel')
  async handleCancel(@ConnectedSocket() client: Socket) {
    const ctx = await this._gate(client, 'cancel');
    if (!ctx) {
      return;
    }
    if (!ctx.sessionId) {
      this._emitError(client, 'no_session');
      return;
    }

    // The cancel state machine lives in the conductor (it owns the pipeline
    // states) — the gateway only authenticates and relays.
    const emitter = this._makeEmitter(client, ctx);
    try {
      const found = await this._conductor.handleCancel(
        ctx.sessionId,
        { orgId: ctx.orgId, userId: ctx.userId, sessionId: ctx.sessionId },
        emitter
      );
      if (!found) {
        this._emitError(client, 'session_not_found');
      }
    } catch (err) {
      this.logger.warn(
        `cancel failed: ${(err as Error)?.message ?? err}`,
        AiDesignerGateway.name
      );
      this._emitError(client, 'internal_error');
    }
  }

  /**
   * Socket-handshake auth resolution. The framework-neutral JWT → user → org
   * logic lives in AuthContextResolver (shared with the HTTP AuthMiddleware);
   * the gateway keeps only socket-specific concerns (CSRF, disconnect codes,
   * context building). Sliding token re-issue and header/API-key auth are not
   * applicable to a socket handshake.
   */
  private async _authenticate(client: Socket): Promise<{
    ctx: SocketContext;
    requestedSessionId?: string;
  } | null> {
    const handshake = client.handshake;
    const cookies = this._parseCookies(handshake.headers.cookie ?? '');

    const token = cookies.auth;
    if (!token) {
      this._disconnect(client, 'missing_auth');
      return null;
    }

    // CSRF before any DB work — it needs only the handshake, and a cross-site
    // attacker must be rejected without spending user/org lookups. This is the
    // one check NOT_SECURED may bypass — matching HTTP, where the dev toggle
    // relaxes CSRF/helmet but never RBAC or billing.
    if (!process.env.NOT_SECURED) {
      const csrfCookie = cookies[CSRF_COOKIE];
      const csrfToken = (handshake.auth as any)?.csrfToken as
        | string
        | undefined;

      if (!this._csrfMatches(csrfCookie, csrfToken)) {
        this._disconnect(client, 'csrf_failed');
        return null;
      }
    }

    const result: AuthContextResult = await this._authContext.resolve({
      jwt: token,
      showOrgId:
        cookies[ORG_HEADER] ??
        (handshake.headers[ORG_HEADER] as string | undefined),
      impersonateOrgUserId:
        cookies[IMPERSONATE_COOKIE] ??
        (handshake.headers[IMPERSONATE_HEADER] as string | undefined),
    });

    if (result.ok === false) {
      // Collapse account-state reasons into one generic code to avoid
      // enumerating whether a user exists / is activated / has an org.
      this._disconnect(client, 'auth_failed');
      return null;
    }

    const { user, org, isSuperAdmin, roleKey } = result.context;

    const ctx: SocketContext = {
      userId: user.id,
      orgId: org.id,
      isSuperAdmin,
      roleKey,
      orgCreatedAt: org.createdAt,
      sessionId: undefined,
      lastAcked: this._readLastAcked(handshake),
      lastAuthzAt: 0,
    };

    if (!(await this._authorize(client, ctx))) {
      return null;
    }

    // Post-auth per-user connect budget — the per-IP bucket is only a pre-auth
    // backstop; this is what actually stops authenticated reconnect loops.
    if (!this._userConnectRateLimit(ctx.userId)) {
      this._disconnect(client, 'rate_limited');
      return null;
    }

    const sessionIdFromAuth = (handshake.auth as any)?.sessionId as
      | string
      | undefined;

    return {
      ctx,
      requestedSessionId: sessionIdFromAuth,
    };
  }

  /**
   * Membership + RBAC + billing. Runs at connect and again (at most every
   * REAUTHZ_INTERVAL_MS) before mutating events, so a member removed from the
   * org, a role losing media:create, or a lapsed subscription loses AI
   * Designer access within a minute instead of on the next reconnect.
   * Unconditional — NOT_SECURED does not bypass it (parity with HTTP guards).
   */
  private async _authorize(
    client: Socket,
    ctx: SocketContext
  ): Promise<boolean> {
    if (!ctx.isSuperAdmin) {
      const effective = await this._roles.getEffectivePermissions(
        ctx.orgId,
        ctx.userId
      );
      if (!effective) {
        this._disconnect(client, 'rbac_membership');
        return false;
      }
      if (
        !effective.permissions.includes('media:create') &&
        !effective.permissions.includes('media:manage')
      ) {
        this._disconnect(client, 'rbac_media_create');
        return false;
      }
    }

    ctx.lastAuthzAt = Date.now();
    return true;
  }

  /**
   * Common front door for every mutating event: context present, per-user
   * fixed-window rate limit, and a (cached) re-authorization.
   */
  private async _gate(
    client: Socket,
    event: string
  ): Promise<SocketContext | null> {
    const ctx = this._requireCtx(client);
    if (!ctx) {
      this._emitError(client, 'not_ready');
      return null;
    }

    if (!this._rateLimit(ctx.userId, event)) {
      this._emitError(client, 'rate_limited');
      return null;
    }

    if (Date.now() - ctx.lastAuthzAt >= REAUTHZ_INTERVAL_MS) {
      if (!(await this._authorize(client, ctx))) {
        return null;
      }
    }

    return ctx;
  }

  /**
   * Per-IP budget on connection attempts, checked before any JWT/DB work.
   * `TRUST_PROXY_HOPS` opts into using the Nth-from-right entry of
   * `x-forwarded-for`; when unset we key on `handshake.address` so a client
   * cannot mint a fresh bucket by spoofing XFF. Shares `_rateBuckets` (and
   * its sweep) with the per-event limits.
   */
  private _connectRateLimit(client: Socket): boolean {
    const ip = this._clientIpForConnectRateLimit(client);

    const now = Date.now();
    this._sweepExpiredBuckets(now);
    const key = `ip:${ip}:connect`;
    let bucket = this._rateBuckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + CONNECT_RATE_LIMIT.windowMs };
      this._rateBuckets.set(key, bucket);
    }
    bucket.count += 1;
    return bucket.count <= CONNECT_RATE_LIMIT.limit;
  }

  private _userConnectRateLimit(userId: string): boolean {
    const now = Date.now();
    this._sweepExpiredBuckets(now);
    const key = `user:${userId}:connect`;
    let bucket = this._rateBuckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + USER_CONNECT_RATE_LIMIT.windowMs };
      this._rateBuckets.set(key, bucket);
    }
    bucket.count += 1;
    return bucket.count <= USER_CONNECT_RATE_LIMIT.limit;
  }

  private _clientIpForConnectRateLimit(client: Socket): string {
    // Shared TRUST_PROXY_HOPS (Nth-from-right XFF) resolution — identical to
    // the HTTP throttler and the MCP rate limits. See utils/client-ip.ts.
    return resolveClientIp(
      client.handshake.headers['x-forwarded-for'],
      client.handshake.address
    );
  }

  private _rateLimit(userId: string, event: string): boolean {
    const conf = RATE_LIMITS[event];
    if (!conf) {
      return true;
    }
    const now = Date.now();
    this._sweepExpiredBuckets(now);
    const key = `${userId}:${event}`;
    let bucket = this._rateBuckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + conf.windowMs };
      this._rateBuckets.set(key, bucket);
    }
    bucket.count += 1;
    return bucket.count <= conf.limit;
  }

  /**
   * Sweep expired buckets once the map grows past the sweep size. Runs on
   * both the per-event path and the connect path — connect attempts are
   * unauthenticated, so they must not be able to grow the map unswept.
   */
  private _sweepExpiredBuckets(now: number) {
    if (this._rateBuckets.size <= RATE_BUCKET_SWEEP_SIZE) {
      return;
    }
    for (const [key, bucket] of this._rateBuckets) {
      if (now >= bucket.resetAt) {
        this._rateBuckets.delete(key);
      }
    }
  }

  private _csrfMatches(cookie: unknown, token: unknown): boolean {
    if (typeof cookie !== 'string' || typeof token !== 'string') {
      return false;
    }
    if (!cookie || !token || cookie.length !== token.length) {
      return false;
    }
    try {
      return crypto.timingSafeEqual(Buffer.from(cookie), Buffer.from(token));
    } catch {
      return false;
    }
  }

  private _readLastAcked(handshake: Socket['handshake']): number {
    const fromAuth = Number((handshake.auth as any)?.lastAcked);
    return Number.isFinite(fromAuth) ? fromAuth : 0;
  }

  private async _joinSessionRoom(
    client: Socket,
    sessionId: string,
    ctx: SocketContext
  ) {
    const session = await this._service.getSessionForUser(
      sessionId,
      ctx.orgId,
      ctx.userId
    );
    if (!session) {
      this._disconnect(client, 'session_not_found');
      return;
    }

    const recovered = await this._recoverStuckSessionIfNeeded(
      client,
      ctx,
      session
    );

    // Only now is the handshake sessionId trusted on the socket context.
    ctx.sessionId = sessionId;
    await client.join(`session:${sessionId}`);
    await this._emitSessionState(client, ctx, recovered);
  }

  private async _recoverStuckSessionIfNeeded(
    client: Socket,
    ctx: SocketContext,
    session: any
  ): Promise<any> {
    if (session.state !== 'planning' && session.state !== 'executing') {
      return session;
    }

    const rawMinutes = Number(process.env.AI_DESIGNER_STUCK_SESSION_MINUTES);
    const minutes =
      Number.isFinite(rawMinutes) && rawMinutes > 0
        ? rawMinutes
        : DEFAULT_STUCK_SESSION_MINUTES;
    const thresholdMs = minutes * 60_000;

    if (Date.now() - new Date(session.updatedAt).getTime() < thresholdMs) {
      return session;
    }

    const recovered = await this._service.updateSession(
      session.id,
      ctx.orgId,
      ctx.userId,
      { state: 'awaiting_plan' }
    );

    this.server.to(`session:${session.id}`).emit('message', {
      id: 'stuck-recovery',
      seq: -1,
      role: 'system',
      kind: 'markdown',
      content: {
        kind: 'markdown',
        md: 'Generation was interrupted — accept a plan to retry.',
      },
    });

    return recovered;
  }

  private async _emitSessionState(
    client: Socket,
    ctx: SocketContext,
    session?: any
  ): Promise<void> {
    if (!ctx.sessionId) {
      client.emit('session:state', { session: null, messages: [] });
      return;
    }

    let resolved =
      session ??
      (await this._service.getSessionForUser(
        ctx.sessionId,
        ctx.orgId,
        ctx.userId
      ));
    if (!resolved) {
      client.emit('session:state', { session: null, messages: [] });
      return;
    }

    resolved = await this._recoverStuckSessionIfNeeded(client, ctx, resolved);

    const messages = await this._service.getMessagesAfterSeq(
      ctx.sessionId,
      ctx.lastAcked
    );
    client.emit('session:state', {
      session: toAiDesignerSessionDto(resolved),
      messages,
    });
  }

  private _makeEmitter(client: Socket, ctx: SocketContext) {
    const room = `session:${ctx.sessionId}`;
    return {
      toSession: (event: string, payload: unknown) => {
        this.server.to(room).emit(event, payload);
      },
      progress: (
        agent: string,
        phase: string,
        pct?: number,
        note?: string
      ) => {
        this.server
          .to(room)
          .emit('agent:progress', { kind: 'progress', agent, phase, pct, note });
      },
      preview: (result: any) => {
        this.server.to(room).emit('preview', result);
      },
      error: (code: string, message?: string, nonce?: string) => {
        this.server.to(room).emit('error', {
          code,
          message: message ?? ERROR_MESSAGES[code] ?? code,
          ...(nonce ? { nonce } : {}),
        });
      },
    };
  }

  private _requireCtx(client: Socket): SocketContext | null {
    return (client.data.ctx as SocketContext | undefined) ?? null;
  }

  /**
   * Tail of every mutating handler's unexpected-throw path: the nonce was
   * claimed but the operation died before completing, so release it (an
   * idempotent retry must not stay locked out for the full TTL) and emit the
   * documented `error` channel — Nest's own fallback emits a generic
   * `exception` event the client does not listen for.
   */
  private async _failClaimed(
    client: Socket,
    event: string,
    nonce: string,
    release: () => Promise<unknown>,
    err: unknown
  ) {
    try {
      await release();
    } catch {
      /* best-effort — the idempotency TTL is the backstop */
    }
    this.logger.warn(
      `${event} failed after nonce claim: ${(err as Error)?.message ?? err}`,
      AiDesignerGateway.name
    );
    this._emitError(client, 'internal_error', { nonce });
  }

  private _emitError(
    client: Socket,
    code: string,
    opts?: { message?: string; nonce?: string }
  ) {
    client.emit('error', {
      code,
      message: opts?.message ?? ERROR_MESSAGES[code] ?? code,
      ...(opts?.nonce ? { nonce: opts.nonce } : {}),
    });
  }

  private _disconnect(client: Socket, reason: string) {
    try {
      this._emitError(client, reason);
    } catch {
      /* socket may already be closing */
    }
    client.disconnect(true);
  }

  private _parseCookies(cookieHeader: string): Record<string, string> {
    const cookies: Record<string, string> = {};
    if (!cookieHeader) {
      return cookies;
    }
    for (const part of cookieHeader.split(';')) {
      const trimmed = part.trim();
      const eq = trimmed.indexOf('=');
      if (eq === -1) {
        continue;
      }
      const key = trimmed.slice(0, eq);
      const value = trimmed.slice(eq + 1);
      try {
        cookies[key] = decodeURIComponent(value);
      } catch {
        cookies[key] = value;
      }
    }
    return cookies;
  }
}
