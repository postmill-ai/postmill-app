import { INestApplication, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { FeatureFlagsService } from '@gitroom/nestjs-libraries/feature-flags';
import { MastraService } from '@gitroom/nestjs-libraries/chat/mastra.service';
import { LoadToolsService } from '@gitroom/nestjs-libraries/chat/load.tools.service';
import { MCPServer } from '@mastra/mcp';
import { randomUUID, createHash } from 'crypto';
import { OAuthService } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service';
import { ApiKeysService } from '@gitroom/nestjs-libraries/database/prisma/api-keys/api-keys.service';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { AiSettingsManager } from '@gitroom/nestjs-libraries/ai/ai-settings.manager';
import { IdempotencyFactory } from '@gitroom/nestjs-libraries/ai/governance/idempotency.factory';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { resolveClientIp } from '@gitroom/nestjs-libraries/utils/client-ip';
import { runWithContext } from './async.storage';
import { createOAuthMiddleware } from './oauth-middleware';
import type { AuthStrategy, AuthResult, AuthContext } from '@reaatech/a2a-reference-auth';
// Two-layer auth:
// 1. Custom middleware resolves pos_/api-key tokens (backward compatible)
// 2. @reaatech/a2a-reference-auth AuthStrategy enforces scopes on the resolved identity
//
// @reaatech/agent-auth-proxy-server (Fastify plugin, ESM-only @ v2.0.0):
// Future enhancement — run as a separate Fastify proxy in front of MCP for
// API-key/JWT/OAuth2 auth with built-in rate limiting and scope enforcement.
// Currently deferred because it's ESM+Fastify and this app is Express/NestJS.
// For now, scope enforcement via AuthStrategy above fulfills the requirement.

declare module 'express' {
  interface Request {
    auth?: any;
  }
}

const logger = new Logger('startMcp');

const fixAcceptHeader = (req: Request) => {
  const value = 'application/json, text/event-stream';
  req.headers.accept = value;
  const idx = req.rawHeaders.findIndex((h) => h.toLowerCase() === 'accept');
  if (idx !== -1) {
    req.rawHeaders[idx + 1] = value;
  } else {
    req.rawHeaders.push('Accept', value);
  }
};

// Log the Redis-down fallback exactly once so a dead Redis is visible in logs
// instead of being masked by a silent `catch {}` on every request.
let redisFallbackLogged = false;
function noteRedisFallback(err: unknown) {
  if (redisFallbackLogged) return;
  redisFallbackLogged = true;
  logger.warn(
    `[startMcp] Redis unavailable for MCP rate-limit/idempotency — using in-memory fallback: ${(err as Error)?.message ?? err}`,
  );
}

async function checkMcpAccess(
  subscriptionService: SubscriptionService,
  organizationId: string
): Promise<{ allowed: boolean; reason?: string }> {
  if (!process.env.STRIPE_PUBLISHABLE_KEY) {
    return { allowed: true };
  }
  const subscription =
    await subscriptionService.getSubscriptionByOrganizationId(organizationId);
  // Reached only when Stripe IS configured (self-host returned above), so a
  // subscription-less hosted org must fail closed to STARTER (mcp:false) — mirrors
  // permissions.service.ts and users.controller.ts. Do NOT fall back to SELF_HOST_PLAN
  // here or every subscription-less hosted org would get free AGENCY-tier MCP access.
  const tier = subscription?.subscriptionTier || 'STARTER';
  const plan = pricing[tier];
  if (!plan) {
    return { allowed: false, reason: 'Unknown subscription tier' };
  }
  if (!plan.mcp) {
    return {
      allowed: false,
      reason: 'AI-assistant access is not included in this plan. Please upgrade.',
    };
  }
  return { allowed: true };
}

// ── Rate limiter (Redis-backed with in-memory fallback) ──
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 200;

// Opportunistic prune so the fallback maps can't grow unbounded when Redis is
// down (one expired entry swept per call is enough to bound them under load).
function pruneExpired<T extends { resetAt?: number; expiresAt?: number }>(
  map: Map<string, T>,
  now: number,
) {
  for (const [k, v] of map) {
    const exp = v.resetAt ?? v.expiresAt ?? 0;
    if (now > exp) {
      map.delete(k);
      break;
    }
  }
}

async function checkRateLimit(key: string): Promise<boolean> {
  const now = Date.now();
  // Try Redis first
  try {
    const redisKey = `ratelimit:mcp:${key}`;
    const count = await ioRedis.incr(redisKey);
    if (count === 1) {
      await ioRedis.pexpire(redisKey, RATE_LIMIT_WINDOW_MS);
    }
    if (count > RATE_LIMIT_MAX) return false;
    return true;
  } catch (err) {
    // Redis unavailable — fall through to in-memory
    noteRedisFallback(err);
  }
  // In-memory fallback
  pruneExpired(rateLimitMap, now);
  const record = rateLimitMap.get(key);
  if (!record || now > record.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (record.count >= RATE_LIMIT_MAX) return false;
  record.count++;
  return true;
}

// F9/D4: key MCP rate limits on the real client IP, resolved exactly like the
// HTTP throttler and the WS gateway (TRUST_PROXY_HOPS, Nth-from-right XFF;
// unset/invalid → socket peer). Bare req.ip behind a proxy is the proxy's
// address — one shared bucket for every MCP client. Exported for unit tests.
export const mcpRateLimitKey = (prefix: string, req: Request): string =>
  `${prefix}:${resolveClientIp(req.headers['x-forwarded-for'], req.ip ?? 'unknown')}`;

// ── In-memory idempotency cache (24h TTL) — fallback when IdempotencyFactory is unavailable ──
const idempotencyCache = new Map<string, { expiresAt: number }>();
const IDEMPOTENCY_TTL_MS = 86_400_000;

function checkIdempotencyFallback(key: string): boolean {
  const now = Date.now();
  pruneExpired(idempotencyCache, now);
  const existing = idempotencyCache.get(key);
  if (existing && now < existing.expiresAt) return false;
  idempotencyCache.set(key, { expiresAt: now + IDEMPOTENCY_TTL_MS });
  return true;
}

// ── CORS helper ──
// Restricts Access-Control-Allow-Origin to the configured frontend URL.
// In development (NODE_ENV=development) a fallback of '*' is used.
// If the request Origin does not match the allowed origin, no CORS
// headers are set so the browser enforces same-origin policy.
const ALLOWED_ORIGINS = (() => {
  const fe = process.env.FRONTEND_URL;
  if (!fe) return new Set<string>();
  return new Set([fe.replace(/\/+$/, '')]);
})();

const DEV_MODE = process.env.NODE_ENV === 'development';

function setCorsHeaders(res: Response, req?: Request) {
  let origin: string | undefined;
  if (DEV_MODE) {
    origin = '*';
  } else if (req) {
    const reqOrigin = req.headers.origin;
    if (reqOrigin && ALLOWED_ORIGINS.has(reqOrigin)) {
      origin = reqOrigin;
    }
  }
  if (!origin) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', '*');
}

interface McpSettings {
  enabled?: boolean;
  allowedScopes?: string[];
  mediaEnabled?: boolean;
}

interface ResolvedMcpAuth {
  auth: any;
  scopes: string[];
  userId?: string;
  role?: string;
}

const DEFAULT_MCP_SCOPES = ['mcp:read'];
const ORG_API_KEY_MCP_SCOPES = ['mcp:read', 'mcp:posts:write'];
const KNOWN_MCP_SCOPES = ['mcp:read', 'mcp:posts:write', 'mcp:admin'];

// Map a persisted OAuth `scope` string (space/comma separated) to the MCP scope
// set, intersecting with the known scopes and flooring at DEFAULT_MCP_SCOPES so
// legacy rows (empty/absent scope) keep working. Without this, granted write
// scopes were ignored and every pos_ token was read-only.
export function mapPersistedScopes(scope: string | null | undefined): string[] {
  const granted = (scope ?? '')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => KNOWN_MCP_SCOPES.includes(s));
  return Array.from(new Set([...DEFAULT_MCP_SCOPES, ...granted]));
}

function requiredMcpScopes(
  mcpSettings: McpSettings | null,
  defaults = DEFAULT_MCP_SCOPES,
): string[] {
  const configured = Array.isArray(mcpSettings?.allowedScopes)
    ? mcpSettings!.allowedScopes!.filter((scope) => typeof scope === 'string' && scope.trim())
    : [];
  return Array.from(new Set([...defaults, ...configured]));
}

// ── Typed scope enforcement via AuthStrategy ──
export function createMcpScopeStrategy(
  resolveAuthFn: (token: string) => Promise<ResolvedMcpAuth | null>,
  mcpSettings: McpSettings | null,
): AuthStrategy {
  return {
    async authenticate(context: AuthContext): Promise<AuthResult> {
      const authHeader = context.headers['authorization'];
      const raw = Array.isArray(authHeader) ? authHeader[0] : authHeader;
      if (!raw) {
        return { authenticated: false, reason: 'Missing Authorization header' };
      }
      const token = raw.replace(/^Bearer\s+/i, '');
      const resolved = await resolveAuthFn(token);
      if (!resolved) {
        return { authenticated: false, reason: 'Invalid API Key or OAuth token' };
      }
      const scopes = resolved.scopes.filter((scope) => typeof scope === 'string' && scope.trim());
      const required = requiredMcpScopes(mcpSettings);
      return {
        authenticated: requireScopes({ authenticated: true, scopes }, required),
        principal: resolved.auth.id ?? token,
        scopes,
        reason: requireScopes({ authenticated: true, scopes }, required)
          ? undefined
          : `Requires ${required.join(', ')}`,
      };
    },
  };
}

export function requireScopes(authResult: AuthResult, required: string[]): boolean {
  if (!authResult.scopes) return required.length === 0;
  return required.every((s) => authResult.scopes!.includes(s));
}

export const startMcp = async (app: INestApplication) => {
  try {
    const flags = app.get(FeatureFlagsService, { strict: false });
    if (flags?.isDisabled('mcp')) {
      new Logger('startMcp').log('MCP is disabled via DEV_DISABLE_MCP; skipping MCP/A2A startup');
      return;
    }
    if (flags?.isDisabled('agent')) {
      new Logger('startMcp').log('Agent is disabled via DEV_DISABLE_AGENT; skipping MCP/A2A agent surface');
      return;
    }
  } catch {
    // FeatureFlagsService may not be available in some test contexts — proceed normally.
  }

  const mastraService = app.get(MastraService, { strict: false });
  const oauthService = app.get(OAuthService, { strict: false });
  const apiKeysService = app.get(ApiKeysService, { strict: false });
  const aiSettingsManager = app.get(AiSettingsManager, { strict: false });

  // IdempotencyFactory is not registered in every Nest context. app.get() throws
  // UnknownElementException (even with strict:false) when a provider is absent, so
  // resolve it defensively and fall back to the in-memory idempotency cache below —
  // the design already guards every `if (idempotencyMiddleware)` usage for this case.
  let idempotencyFactory: IdempotencyFactory | null = null;
  try {
    idempotencyFactory = app.get(IdempotencyFactory, { strict: false });
  } catch {
    idempotencyFactory = null;
  }
  const idempotencyMiddleware = idempotencyFactory?.getMiddleware() ?? null;
  const subscriptionService = app.get(SubscriptionService, { strict: false });

  let mcpSettings: McpSettings | null = null;
  try {
    const settings = await aiSettingsManager.getSettings();
    if (settings?.mcpSettings) {
      mcpSettings = settings.mcpSettings;
    }
  } catch {
    // MCP settings unavailable — fall back to defaults (enabled, scope mcp:read)
    mcpSettings = { enabled: true, allowedScopes: ['mcp:read'], mediaEnabled: false };
  }

  const mcpEnabled = mcpSettings?.enabled !== false;

  // Server-side backend URL. NEXT_PUBLIC_BACKEND_URL is a frontend (build-time)
  // var; prefer a dedicated server var and fail loudly at boot if neither is set
  // (a bare `!` would only NPE later, mid-request, on the first URL construction).
  const backendUrl = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!backendUrl) {
    throw new Error(
      'startMcp: BACKEND_URL (or NEXT_PUBLIC_BACKEND_URL) must be set to mount the MCP/A2A surface',
    );
  }

  const resolveAuthContext = async (token: string): Promise<ResolvedMcpAuth | null> => {
    if (token.startsWith('pos_')) {
      const authorization = await oauthService.getOrgByOAuthToken(token);
      if (!authorization) return null;
      return {
        auth: authorization.organization,
        userId: (authorization as any).user?.id,
        scopes: mapPersistedScopes((authorization as any).scope),
      };
    }
    const hash = createHash('sha256').update(token).digest('hex');
    const apiKey = await apiKeysService.findActiveByHash(hash);
    if (!apiKey) return null;
    const userOrg = apiKey.user.organizations?.find(
      (o) => o.organizationId === apiKey.organizationId,
    );
    const role =
      userOrg?.roleRef?.key ??
      (apiKey.user.isSuperAdmin ? 'owner' : 'member');
    const scopes =
      role === 'owner' || role === 'admin'
        ? ORG_API_KEY_MCP_SCOPES
        : DEFAULT_MCP_SCOPES;
    return {
      auth: apiKey.organization,
      userId: apiKey.user.id,
      role,
      scopes,
    };
  };

  const resolveAuth = async (token: string) => {
    const ctx = await resolveAuthContext(token);
    if (!ctx) return null;
    return { org: ctx.auth, userId: ctx.userId, role: ctx.role };
  };

  // ── Boot-time tool snapshot (hot provider/model changes are OK; tool-set changes need restart) ──
  const mastra = await mastraService.mastra();
  const agent = mastra.getAgent('postmill');

  // Build the MCP/A2A tool union from the in-repo inventory (LoadToolsService),
  // NOT by reflecting Mastra's private `__getStaticAgents()`. Under the supervisor
  // topology `agent.listTools()` returns only the supervisor's two tools; the old
  // union depended on a private internal whose `?? {}` fallback would silently
  // collapse the whole MCP surface on a Mastra rename. `loadTools()` is the
  // authoritative flat inventory (every registered tool, firewall-wrapped).
  const loadToolsService = app.get(LoadToolsService, { strict: false });
  const tools = await loadToolsService.loadTools();

  // Agent-resource surface: expose the supervisor plus any registered sub-agents.
  // This only affects the MCP *agents* map (not the tool union above), so the
  // private-internal fallback here is non-load-bearing.
  const staticAgents = ((agent as any).__getStaticAgents?.() ?? {}) as Record<string, any>;
  const mcpAgents: Record<string, any> = { postmill: agent };
  for (const [key, sub] of Object.entries(staticAgents)) {
    mcpAgents[key] = sub;
  }

  const serverConfig = {
    name: 'Postmill MCP',
    version: '1.0.0',
    tools,
    agents: mcpAgents,
  };

  const server = new MCPServer(serverConfig);

  // ── Scope strategy (typed via @reaatech/a2a-reference-auth) ──
  const scopeStrategy = createMcpScopeStrategy(resolveAuthContext, mcpSettings);

  const oauthMiddleware = createOAuthMiddleware({
    oauth: {
      resource: new URL('/mcp-oauth', backendUrl).toString(),
      authorizationServers: [backendUrl],
      validateToken: async (token: string) => {
        const org = await resolveAuth(token);
        if (!org) {
          return { valid: false, error: 'invalid_token', errorDescription: 'Invalid API Key or OAuth token' };
        }
        return { valid: true, subject: token };
      },
    },
    mcpPath: '/mcp-oauth',
  });

  if (process.env.OPENAI_APP_CHALLENGE) {
    app.use('/.well-known/openai-apps-challenge', (req: Request, res: Response) => {
      res.setHeader('Content-Type', 'text/plain');
      res.send(process.env.OPENAI_APP_CHALLENGE);
    });
  }

  app.use('/.well-known/oauth-protected-resource', async (req: Request, res: Response) => {
    setCorsHeaders(res, req);

    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }

    const url = new URL('/.well-known/oauth-protected-resource', backendUrl);
    const result = await oauthMiddleware(req, res, url);
    if (result?.tokenValidation?.subject) {
      const authResult = await scopeStrategy.authenticate({
        headers: { authorization: `Bearer ${result.tokenValidation.subject}` },
      });
      if (authResult.authenticated && !requireScopes(authResult, ['mcp:read'])) {
        res.status(403).json({ error: 'insufficient_scope', error_description: 'Requires mcp:read' });
        return;
      }
    }
  });

  app.use('/.well-known/oauth-authorization-server', async (req: Request, res: Response) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.writeHead(204);
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'max-age=3600');
    res.json({
      issuer: backendUrl,
      authorization_endpoint: `${process.env.FRONTEND_URL}/oauth/authorize`,
      token_endpoint: `${process.env.NEXT_PUBLIC_OVERRIDE_BACKEND_URL || backendUrl}/oauth/token`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      // 3.3: no tool enforces mcp:admin, so advertising it overstates the grant.
      // mapPersistedScopes still accepts it (via KNOWN_MCP_SCOPES) for back-compat
      // with already-granted rows; re-advertise here only if real admin tools land.
      scopes_supported: ['mcp:read', 'mcp:posts:write'],
    });
  });

  // ── Entrypoint 1: /mcp-oauth (OAuth2-protected MCP) ──
  app.use('/mcp-oauth', async (req: Request, res: Response, next: () => void) => {
    if (req.path !== '/' && req.path !== '') {
      next();
      return;
    }

    if (!mcpEnabled) {
      res.status(403).json({ error: 'mcp_disabled', error_description: 'MCP server is disabled' });
      return;
    }

    const rateLimitKey = mcpRateLimitKey('mcp-oauth', req);
    if (!(await checkRateLimit(rateLimitKey))) {
      res.status(429).json({ error: 'too_many_requests', error_description: 'Rate limit exceeded' });
      return;
    }

    const mcpOauthIdempotencyKey = (req.headers['x-idempotency-key'] as string) || '';
    if (mcpOauthIdempotencyKey) {
      if (idempotencyMiddleware) {
        let idempRejected = false;
        await new Promise<void>((resolve, reject) => {
          idempotencyMiddleware(req, res, (err?: any) => {
            if (err) { idempRejected = true; reject(err); } else { resolve(); }
          });
        });
        if (idempRejected) return;
      } else if (!checkIdempotencyFallback(mcpOauthIdempotencyKey)) {
        res.status(409).json({ error: 'idempotency_conflict', error_description: 'Duplicate request' });
        return;
      }
    }

    const url = new URL('/mcp-oauth', backendUrl);

    const result = await oauthMiddleware(req, res, url);
    if (!result.proceed) return;

    const token = result.tokenValidation?.subject;
    if (!token) {
      res.status(401).json({ error: 'invalid_token', error_description: 'Could not extract token' });
      return;
    }

    const auth = await resolveAuth(token);
    if (!auth) {
      res.status(401).json({ error: 'invalid_token', error_description: 'Could not resolve organization' });
      return;
    }

    const authResult = await scopeStrategy.authenticate({
      headers: { authorization: `Bearer ${token}` },
    });
    if (!authResult.authenticated) {
      res.status(403).json({ error: 'insufficient_scope', error_description: authResult.reason });
      return;
    }
    if (!requireScopes(authResult, ['mcp:read'])) {
      res.status(403).json({ error: 'insufficient_scope', error_description: 'Requires mcp:read' });
      return;
    }

    const mcpAccess = await checkMcpAccess(subscriptionService, auth.org.id);
    if (!mcpAccess.allowed) {
      res.status(402).json({
        statusCode: 402,
        error: 'PaymentRequired',
        message: mcpAccess.reason,
      });
      return;
    }

    fixAcceptHeader(req);
    await runWithContext(
      {
        requestId: token,
        auth: auth.org,
        userId: auth.userId,
        access: { mode: 'mcp', scopes: authResult.scopes },
      },
      async () => {
        await server.startHTTP({
          url: url,
          httpPath: url.pathname,
          options: {
            sessionIdGenerator: () => {
              return randomUUID();
            },
            enableJsonResponse: true,
          },
          req,
          res,
        });
      }
    );
  });

  // ── Entrypoint 2: /mcp (Bearer token via Authorization header) ──
  // MCP rate limiting: a separate Express middleware (e.g. express-rate-limit) must be
  // mounted before these routes. The Nest @nestjs/throttler guard does not apply here.
  app.use('/mcp', async (req: Request, res: Response, next: () => void) => {
    if (req.path !== '/' && req.path !== '') {
      next();
      return;
    }

    setCorsHeaders(res, req);

    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }

    if (!mcpEnabled) {
      res.status(403).json({ error: 'mcp_disabled', error_description: 'MCP server is disabled' });
      return;
    }

    // Idempotency check (Redis-backed via IdempotencyFactory, fallback to in-memory)
    const idempotencyKey = (req.headers['x-idempotency-key'] as string) || '';
    if (idempotencyKey) {
      if (idempotencyMiddleware) {
        let middlewareRejected = false;
        await new Promise<void>((resolve, reject) => {
          idempotencyMiddleware(req, res, (err?: any) => {
            if (err) {
              middlewareRejected = true;
              reject(err);
            } else {
              resolve();
            }
          });
        });
        if (middlewareRejected) return;
      } else if (!checkIdempotencyFallback(idempotencyKey)) {
        res.status(409).json({ error: 'idempotency_conflict', error_description: 'Duplicate request' });
        return;
      }
    }

    const rateLimitKey = mcpRateLimitKey('mcp', req);
    if (!(await checkRateLimit(rateLimitKey))) {
      res.status(429).json({ error: 'too_many_requests', error_description: 'Rate limit exceeded' });
      return;
    }

    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      res.status(401).json({ error: 'unauthorized', error_description: 'Missing Authorization header' });
      return;
    }

    const authResult = await scopeStrategy.authenticate({
      headers: { authorization: `Bearer ${token}` },
    });
    if (!authResult.authenticated) {
      res.status(403).send(authResult.reason || 'Insufficient scope');
      return;
    }
    if (!requireScopes(authResult, requiredMcpScopes(mcpSettings))) {
      res.status(403).json({
        error: 'insufficient_scope',
        error_description: `Requires ${requiredMcpScopes(mcpSettings).join(', ')}`,
      });
      return;
    }

    req.auth = await resolveAuth(token);
    if (!req.auth) {
      res.status(401).send('Invalid API Key or OAuth token');
      return;
    }

    const mcpAccess = await checkMcpAccess(subscriptionService, req.auth.org.id);
    if (!mcpAccess.allowed) {
      res.status(402).json({
        statusCode: 402,
        error: 'PaymentRequired',
        message: mcpAccess.reason,
      });
      return;
    }

    const url = new URL('/mcp', backendUrl);

    fixAcceptHeader(req);
    await runWithContext(
      {
        requestId: token,
        auth: req.auth.org,
        userId: req.auth.userId,
        access: { mode: 'mcp', scopes: authResult.scopes },
      },
      async () => {
        await server.startHTTP({
          url,
          httpPath: url.pathname,
          options: {
            sessionIdGenerator: () => {
              return randomUUID();
            },
            enableJsonResponse: true,
          },
          req,
          res,
        });
      }
    );
  });

  // ── Entrypoint 3: /mcp/:id (API key in path param) ──
  app.use('/mcp/:id', async (req: Request, res: Response) => {
    setCorsHeaders(res, req);

    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }

    if (!mcpEnabled) {
      res.status(403).json({ error: 'mcp_disabled', error_description: 'MCP server is disabled' });
      return;
    }

    const rateLimitKey = `mcp-id:${req.params.id}`;
    if (!(await checkRateLimit(rateLimitKey))) {
      res.status(429).json({ error: 'too_many_requests', error_description: 'Rate limit exceeded' });
      return;
    }

    const mcpIdIdempotencyKey = (req.headers['x-idempotency-key'] as string) || '';
    if (mcpIdIdempotencyKey) {
      if (idempotencyMiddleware) {
        let idempRejected = false;
        await new Promise<void>((resolve, reject) => {
          idempotencyMiddleware(req, res, (err?: any) => {
            if (err) { idempRejected = true; reject(err); } else { resolve(); }
          });
        });
        if (idempRejected) return;
      } else if (!checkIdempotencyFallback(mcpIdIdempotencyKey)) {
        res.status(409).json({ error: 'idempotency_conflict', error_description: 'Duplicate request' });
        return;
      }
    }

    const id = req.params.id as string;
    const hash = createHash('sha256').update(id).digest('hex');
    const apiKey = await apiKeysService.findActiveByHash(hash);
    if (!apiKey) {
      res.status(401).json({ error: 'unauthorized', error_description: 'Invalid API Key' });
      return;
    }
    const userOrg = apiKey.user.organizations?.find(
      (o) => o.organizationId === apiKey.organizationId,
    );
    const role =
      userOrg?.roleRef?.key ??
      (apiKey.user.isSuperAdmin ? 'owner' : 'member');
    req.auth = { org: apiKey.organization, userId: apiKey.user.id, role };

    // NOTE: The raw API key from the URL param is passed as `Bearer ${id}` to
    // scopeStrategy.authenticate(). This works correctly for long API keys, but
    // the key will appear as a "bearer token" in auth logs — this is a cosmetic
    // logging concern only, not a functional issue.
    const authResult = await scopeStrategy.authenticate({
      headers: { authorization: `Bearer ${id}` },
    });
    if (!authResult.authenticated) {
      res.status(403).send(authResult.reason || 'Insufficient scope');
      return;
    }
    if (!requireScopes(authResult, ['mcp:read'])) {
      res.status(403).json({ error: 'insufficient_scope', error_description: 'Requires mcp:read' });
      return;
    }

    const mcpAccess = await checkMcpAccess(subscriptionService, req.auth.org.id);
    if (!mcpAccess.allowed) {
      res.status(402).json({
        statusCode: 402,
        error: 'PaymentRequired',
        message: mcpAccess.reason,
      });
      return;
    }

    const url = new URL(
      `/mcp/${id}`,
      backendUrl
    );

    fixAcceptHeader(req);
    await runWithContext(
      {
        requestId: id,
        auth: req.auth.org,
        userId: req.auth.userId,
        access: { mode: 'mcp', scopes: authResult.scopes },
      },
      async () => {
        await server.startHTTP({
          url,
          httpPath: url.pathname,
          options: {
            sessionIdGenerator: () => {
              return randomUUID();
            },
            enableJsonResponse: true,
          },
          req,
          res,
        });
      }
    );
  });

  // ── Entrypoints 4 & 5: /sse/:id and /message/:id (SSE transport with API key in param) ──
  app.use(['/sse/:id', '/message/:id'], async (req: Request, res: Response) => {
    setCorsHeaders(res, req);

    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }

    if (!mcpEnabled) {
      res.status(403).json({ error: 'mcp_disabled', error_description: 'MCP server is disabled' });
      return;
    }

    const id = req.params.id as string;
    const rateLimitKey = `sse:${id}`;
    if (!(await checkRateLimit(rateLimitKey))) {
      res.status(429).json({ error: 'too_many_requests', error_description: 'Rate limit exceeded' });
      return;
    }

    // Idempotency check (Redis-backed via IdempotencyFactory, fallback to in-memory)
    const idempotencyKey = (req.headers['x-idempotency-key'] as string) || '';
    if (idempotencyKey) {
      if (idempotencyMiddleware) {
        let middlewareRejected = false;
        await new Promise<void>((resolve, reject) => {
          idempotencyMiddleware(req, res, (err?: any) => {
            if (err) {
              middlewareRejected = true;
              reject(err);
            } else {
              resolve();
            }
          });
        });
        if (middlewareRejected) return;
      } else if (!checkIdempotencyFallback(idempotencyKey)) {
        res.status(409).json({ error: 'idempotency_conflict', error_description: 'Duplicate request' });
        return;
      }
    }

    const hash = createHash('sha256').update(id).digest('hex');
    const apiKey = await apiKeysService.findActiveByHash(hash);
    if (!apiKey) {
      res.status(401).json({ error: 'unauthorized', error_description: 'Invalid API Key' });
      return;
    }
    const sseUserOrg = apiKey.user.organizations?.find(
      (o) => o.organizationId === apiKey.organizationId,
    );
    const sseRole =
      sseUserOrg?.roleRef?.key ??
      (apiKey.user.isSuperAdmin ? 'owner' : 'member');
    req.auth = { org: apiKey.organization, userId: apiKey.user.id, role: sseRole };

    const authResult = await scopeStrategy.authenticate({
      headers: { authorization: `Bearer ${id}` },
    });
    if (!authResult.authenticated) {
      res.status(403).send(authResult.reason || 'Insufficient scope');
      return;
    }
    if (!requireScopes(authResult, ['mcp:read'])) {
      res.status(403).json({ error: 'insufficient_scope', error_description: 'Requires mcp:read' });
      return;
    }

    const mcpAccess = await checkMcpAccess(subscriptionService, req.auth.org.id);
    if (!mcpAccess.allowed) {
      res.status(402).json({
        statusCode: 402,
        error: 'PaymentRequired',
        message: mcpAccess.reason,
      });
      return;
    }

    const url = new URL(req.originalUrl, backendUrl);

    await runWithContext(
      {
        requestId: id,
        auth: req.auth.org,
        userId: req.auth.userId,
        access: { mode: 'mcp', scopes: authResult.scopes },
      },
      async () => {
        await server.startSSE({
          url,
          ssePath: `/sse/${id}`,
          messagePath: `/message/${id}`,
          req,
          res,
        });
      }
    );
  });

  // ── Media MCP server (§2.4/§8) — second MCP surface for media operations ──
  const mediaEnabled = mcpSettings?.mediaEnabled === true;

  if (mediaEnabled) {
    try {
      const {
        MCPServer: MediaMCPServer,
        ProviderRegistry: MediaProviderRegistry,
        loadConfig,
      } = await import('@reaatech/media-pipeline-mcp-server' as any).catch(() => null as any);
      const {
        createRBACMiddleware,
        createRateLimiter,
        createAuditLogger,
      } = await import('@reaatech/media-pipeline-mcp-security' as any).catch(() => null as any);

      if (MediaMCPServer && MediaProviderRegistry) {
        const mediaRegistry = new MediaProviderRegistry();
        const mediaServerConfig = loadConfig?.({
          port: 0,
          host: '0.0.0.0',
          features: {
            idempotency: true,
            budgetCaps: true,
            multiTenant: true,
            provenance: false,
            streaming: true,
            safetyGate: true,
            routing: false,
            variants: false,
            batch: false,
            subtitles: false,
            contentCache: false,
            resumablePipelines: false,
            dryRun: false,
            webhooks: false,
            runContext: false,
            mcpResources: false,
            sttStream: false,
          },
          multiTenant: {
            enabled: true,
            resolver: 'header',
            defaultBudgetCaps: { dailyUsd: 10, monthlyUsd: 100 },
            allowAdminOverride: true,
          },
          budget: {
            dailyUsd: 10,
            monthlyUsd: 100,
          },
        }) || {};

        const mediaServer = new MediaMCPServer(mediaServerConfig);

        // Wire up security middleware
        if (createRBACMiddleware && createRateLimiter && createAuditLogger) {
          if (!process.env.JWT_SECRET) {
            throw new Error('JWT_SECRET is required before mounting /media-mcp');
          }

          const rbac = createRBACMiddleware({
            secret: process.env.JWT_SECRET,
            roles: { admin: ['pipeline:run', 'pipeline:define', 'artifact:read', 'cost:read'] },
          });
          const rateLimiter = createRateLimiter({
            windowMs: 60_000,
            maxRequests: 30,
          });
          const auditLogger = createAuditLogger({
            exporters: [{ type: 'file', config: { path: process.env.MEDIA_MCP_AUDIT_LOG_PATH || '/tmp/media-mcp-audit.log' } }],
          });

          app.use('/media-mcp', async (req: Request, res: Response) => {
            setCorsHeaders(res, req);
            if (req.method === 'OPTIONS') {
              res.sendStatus(200);
              return;
            }

            // Auth check via API key (same as /mcp/:id)
            const authHeader = req.headers.authorization;
            if (authHeader) {
              const token = authHeader.replace(/^Bearer\s+/i, '');
              const resolved = await resolveAuth(token);
              if (!resolved) {
                res.status(401).json({ error: 'unauthorized', error_description: 'Invalid token' });
                return;
              }
              (req as any).auth = resolved;

              const authContext = await rbac.authenticate(req.headers);
              if (!authContext.authenticated) {
                res.status(403).json({ error: 'forbidden', error_description: 'Insufficient permissions' });
                return;
              }

              const rateResult = await rateLimiter.checkLimit(resolved.org.id, 'media-mcp');
              if (!rateResult.allowed) {
                res.status(429).json({ error: 'too_many_requests', error_description: 'Rate limit exceeded' });
                return;
              }

              const mcpAccess = await checkMcpAccess(subscriptionService, resolved.org.id);
              if (!mcpAccess.allowed) {
                res.status(402).json({
                  statusCode: 402,
                  error: 'PaymentRequired',
                  message: mcpAccess.reason,
                });
                return;
              }
            } else {
              res.status(401).json({ error: 'unauthorized', error_description: 'Missing Authorization header' });
              return;
            }

            await mediaServer.startHTTP({
              url: new URL('/media-mcp', backendUrl),
              httpPath: '/media-mcp',
              options: { sessionIdGenerator: () => randomUUID(), enableJsonResponse: true },
              req: req as any,
              res: res as any,
            });
          });

          logger.log('[startMcp] Media MCP server mounted at /media-mcp');
        } else {
          logger.warn(
            '[startMcp] Media MCP server packages installed but security middleware unavailable — /media-mcp not mounted',
          );
        }
      } else {
        logger.warn(
          '[startMcp] @reaatech/media-pipeline-mcp-server not available — /media-mcp not mounted',
        );
      }
    } catch (err) {
      logger.warn(
        `[startMcp] Media MCP server init failed (may need package install): ${(err as Error).message}`,
      );
    }
  }

  // ── A2A bridge (§8) — DEFERRED, intentionally not mounted ──
  // The previous `/a2a` mount was dead code: it was written against an
  // `@reaatech/a2a-reference-mcp-bridge` API that does not exist in the installed
  // 0.1.2. Verified against dist/index.d.ts: `McpToolAdapter` takes
  // `{ mcpTransport, agentCardBase }` (it builds its surface from the transport,
  // so the passed agent facade + `{serverName, auth}` arg were inert),
  // `A2aAsMcpServer` takes `{ a2aAgentUrl, ... }` and exposes `run()`/`close()`
  // but NO `handleRequest` — so every `/a2a` request threw
  // `a2aServer.handleRequest is not a function` → a generic 500. No external A2A
  // client could ever have worked against it. Rather than ship a broken route,
  // A2A is tracked as a future feature: a correct build needs an in-process MCP
  // transport pair connected to the existing `MCPServer`, `initialize()`, and an
  // A2A JSON-RPC HTTP layer over `McpToolAdapter.executeTask` — plus a live smoke
  // test against a real A2A consumer. See docs/developer-docs (agent framework)
  // and dev/AI_AGENT_REMEDIATION.md §5.1. The MCP surface (/mcp, /mcp/:id, /sse)
  // is unaffected.
  logger.log('[startMcp] A2A bridge deferred — /a2a not mounted (tracked feature)');
};
