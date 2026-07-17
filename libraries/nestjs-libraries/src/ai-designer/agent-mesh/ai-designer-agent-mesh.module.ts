import '@gitroom/nestjs-libraries/ai-designer/agent-mesh/agent-mesh-env.shim';
import {
  Logger,
  Module,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { setSessionStore } from '@reaatech/agent-mesh-session';
import { setBreakerStore } from '@reaatech/agent-mesh-utils';
import {
  AgentRegistrySchema,
  loadRegistry,
  registryState,
} from '@reaatech/agent-mesh-registry';
import { AI_DESIGNER_AGENTS } from './agent-registry.data';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import {
  RedisSessionStore,
  RedisBreakerStore,
} from '@reaatech/agent-mesh-redis';

/**
 * Loads the AI Designer agent registry and wires the v-next pluggable backends:
 * - Redis session/breaker stores (`AI_DESIGNER_MESH_STORE=postgres` opts into
 *   the Postgres stores instead — that path runs third-party DDL on a second
 *   connection pool, so it is never the default; see `_wireStores`)
 *
 * (The package's LLM classifier is never invoked — the conductor routes agents
 * explicitly by id — so no classifier wiring exists here.)
 *
 * Every step is non-fatal: a failure degrades AI Designer (logged), it never
 * blocks backend boot.
 *
 * Individual agents register their in-process handlers in their own
 * `OnModuleInit` via `registerInProcessAgent` from `@reaatech/agent-mesh-router`.
 */
@Module({})
export class AiDesignerAgentMeshModule
  implements OnModuleInit, OnModuleDestroy
{
  private _logger = new Logger(AiDesignerAgentMeshModule.name);
  private _pgPool: { end(): Promise<void> } | null = null;

  async onModuleInit() {
    // None of these may throw: this module sits on AppModule, so an
    // onModuleInit rejection would crash-loop the whole backend for a feature
    // subsystem. Failures log and degrade instead.
    await this._step('registry', () => this._loadRegistry());
    await this._step('stores', () => this._wireStores());
  }

  async onModuleDestroy() {
    // Close the dedicated agent-mesh Postgres pool (opt-in path only) so the
    // process can shut down cleanly and release connections back to the DB.
    if (this._pgPool) {
      await this._pgPool.end();
      this._pgPool = null;
    }
  }

  private async _step(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
    } catch (err) {
      this._logger.error(
        `AI Designer agent-mesh ${name} setup failed: ${
          (err as Error).message
        } — AI Designer will be degraded until this is resolved`
      );
    }
  }

  private async _loadRegistry() {
    // Operator override: a directory of per-agent YAML files (the
    // agent-mesh-registry format — one agent per file). `agent-mesh-env.stash`
    // already maps `AI_DESIGNER_AGENT_REGISTRY` to `AGENT_REGISTRY_DIR` before
    // the package import; honor either source here.
    const overrideDir =
      process.env.AI_DESIGNER_AGENT_REGISTRY || process.env.AGENT_REGISTRY_DIR;
    if (overrideDir) {
      try {
        const registry = await loadRegistry();
        registryState.swap(registry);
        return;
      } catch (err) {
        this._logger.warn(
          `AI Designer agent registry override (${overrideDir}) failed to load: ${
            (err as Error).message
          } — falling back to the bundled registry`
        );
      }
    }

    // Default: the bundled registry. TS data, not a YAML asset — `nest build`
    // copies no assets into dist, so a file read here would break production.
    const parsed = AgentRegistrySchema.safeParse(AI_DESIGNER_AGENTS);
    if (!parsed.success) {
      throw new Error(
        `bundled agent registry invalid: ${parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`
      );
    }
    registryState.swap(parsed.data);
  }

  private async _wireStores() {
    if (process.env.AI_DESIGNER_MESH_STORE === 'postgres') {
      // Opt-in only: ensureSchema runs raw DDL outside the committed Prisma
      // migrations and the Pool adds connections on top of Prisma's. Lazy
      // imports keep `pg` out of the default boot path. A DEDICATED database
      // URL is required — third-party DDL must never run against the Prisma
      // DATABASE_URL, where it would fail the CI schema-drift gate.
      const { Pool } = await import('pg');
      const { PostgresSessionStore, PostgresBreakerStore, ensureSchema } =
        await import('@reaatech/agent-mesh-postgres');
      const databaseUrl = process.env.AI_DESIGNER_MESH_DATABASE_URL;
      if (!databaseUrl) {
        throw new Error(
          'AI_DESIGNER_MESH_STORE=postgres requires AI_DESIGNER_MESH_DATABASE_URL ' +
            '(a dedicated database/schema — never the Prisma DATABASE_URL)'
        );
      }
      const pool = new Pool({
        connectionString: databaseUrl,
        max: this._pgPoolMax(),
      });
      await ensureSchema(pool);
      this._pgPool = pool;
      setSessionStore(new PostgresSessionStore(pool));
      setBreakerStore(new PostgresBreakerStore(pool));
      return;
    }

    setSessionStore(
      new RedisSessionStore(ioRedis, { keyPrefix: 'ai-designer:mesh:' })
    );
    setBreakerStore(
      new RedisBreakerStore(ioRedis, { keyPrefix: 'ai-designer:mesh:' })
    );
  }

  private _pgPoolMax(): number {
    // Prefer the mesh-specific limit; fall back to the main Prisma pool limit
    // for backward compatibility.
    const env =
      process.env.AI_DESIGNER_MESH_CONNECTION_LIMIT ||
      process.env.DATABASE_CONNECTION_LIMIT;
    const parsed = env ? parseInt(env, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
  }
}
