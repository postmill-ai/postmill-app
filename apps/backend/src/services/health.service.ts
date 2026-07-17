import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InngestService } from '@gitroom/nestjs-libraries/inngest/inngest.service';
import { InngestRunRepository } from '@gitroom/nestjs-libraries/database/prisma/inngest-runs/inngest-run.repository';
import { HealthRepository } from '@gitroom/nestjs-libraries/database/prisma/health/health.repository';
import { RedisService } from '@gitroom/nestjs-libraries/redis/redis.service';
import { safeFetch } from '@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch';
import { isInngestEnabled } from '@gitroom/nestjs-libraries/inngest/inngest.client';

const EVENT_API_TIMEOUT_MS = 5_000;
const INNGEST_CLOUD_EVENT_API = 'https://inn.gs/';
const INNGEST_DEV_BASE_URL = 'http://localhost:8288';

@Injectable()
export class HealthService {
  constructor(
    private readonly inngestService: InngestService,
    private readonly inngestRunRepository: InngestRunRepository,
    private readonly healthRepository: HealthRepository,
    private readonly redisService: RedisService
  ) {}

  // Liveness: cheap, dependency-free, always 200. Used by the container HEALTHCHECK and
  // orchestrator liveness probe — answering it only proves the process is up and serving.
  getLive() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  // Readiness: verifies the hard dependencies (DB + Redis) before the instance should
  // receive traffic. Any failure → 503 with per-dependency status.
  async getReady() {
    const [database, redis] = await Promise.all([
      this.checkDependency(() => this.healthRepository.ping()),
      this.checkDependency(async () => {
        await this.redisService.ping();
        return true;
      }),
    ]);

    const dependencies = { database, redis };
    const ready = database.ok && redis.ok;

    if (!ready) {
      throw new ServiceUnavailableException({
        status: 'unavailable',
        timestamp: new Date().toISOString(),
        dependencies,
      });
    }

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      dependencies,
    };
  }

  private async checkDependency(
    fn: () => Promise<unknown>
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      await fn();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async getHealth() {
    const inngestHealth = await this.checkInngest();

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      inngest: inngestHealth,
    };
  }

  private async checkInngest() {
    const useInngest = isInngestEnabled();
    const devMode = process.env.INNGEST_DEV === '1';
    const eventKey = process.env.INNGEST_EVENT_KEY;
    const signingKey = process.env.INNGEST_SIGNING_KEY;
    const fallbackKey = process.env.INNGEST_SIGNING_KEY_FALLBACK;

    const eventKeyPresent = !!eventKey && eventKey.length > 0;
    const signingKeyPresent = !!signingKey && signingKey.length > 0;
    const fallbackKeyPresent = !!fallbackKey && fallbackKey.length > 0;

    // Lightweight local reachability: ensure the serve handler has functions registered.
    // This avoids an external network call that could fail spuriously.
    let functionsRegistered = 0;
    try {
      functionsRegistered = this.inngestService.getFunctions().length;
    } catch {
      functionsRegistered = 0;
    }
    const serveHandlerRegistered = functionsRegistered > 0;

    const signingKeyRequired = !devMode;
    const signingKeyValid = signingKeyRequired ? signingKeyPresent : true;

    const { reachable: eventApiReachable, latencyMs: eventApiLatencyMs } =
      await this.checkEventApiReachability(devMode);

    const lastRuns = await this.getLastRuns();

    const healthy =
      serveHandlerRegistered &&
      (!useInngest || devMode || (eventKeyPresent && signingKeyValid));

    return {
      useInngest,
      devMode,
      eventKeyPresent,
      signingKeyPresent,
      signingKeyRequired,
      fallbackKeyPresent,
      serveHandlerRegistered,
      functionsRegistered,
      eventApiReachable,
      eventApiLatencyMs,
      lastRuns,
      healthy,
    };
  }

  // Latest run timing/status per cron function (one row each). Never fails the health
  // check — an unreachable DB just yields an empty list.
  private async getLastRuns() {
    try {
      return await this.inngestRunRepository.getAllLatest();
    } catch {
      return [];
    }
  }

  private async checkEventApiReachability(
    devMode: boolean
  ): Promise<{ reachable: boolean; latencyMs: number | null }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EVENT_API_TIMEOUT_MS);
    const startedAt = Date.now();

    try {
      if (devMode) {
        // Dev-only: targets the operator's local Inngest dev server (INNGEST_BASE_URL,
        // e.g. http://localhost:8288). Intentionally a bare fetch — safeFetch enforces
        // isSafePublicHttpsUrl and would reject this private/non-HTTPS localhost URL by
        // design. Only reachable when devMode (INNGEST_DEV) is set. The production branch
        // below uses safeFetch.
        const baseUrl = process.env.INNGEST_BASE_URL || INNGEST_DEV_BASE_URL;
        const response = await fetch(baseUrl, {
          method: 'HEAD',
          signal: controller.signal,
        });
        return { reachable: response.ok, latencyMs: Date.now() - startedAt };
      }

      const response = await safeFetch(INNGEST_CLOUD_EVENT_API, {
        method: 'HEAD',
        signal: controller.signal,
      });
      return { reachable: response.ok, latencyMs: Date.now() - startedAt };
    } catch {
      return { reachable: false, latencyMs: null };
    } finally {
      clearTimeout(timeout);
    }
  }
}
