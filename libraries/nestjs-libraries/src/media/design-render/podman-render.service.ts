import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { randomBytes } from 'crypto';
import {
  getPodmanRenderConfig,
  getRenderConcurrency,
  PodmanRenderConfig,
} from './render-config';
import { RenderJobSpec } from './render-job-spec';
import * as fs from 'fs';
import * as path from 'path';

interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

@Injectable()
export class PodmanRenderService {
  private readonly logger = new Logger(PodmanRenderService.name);
  private poolEnsured = false;
  // Set when pod creation failed and we degraded to per-container even-split caps.
  private splitMode = false;

  /**
   * Run one render job inside a Podman container. The caller owns `workDir` (writes any
   * input files there); this writes `job.json`, runs the container with the workdir mounted
   * at /work, and leaves the artifact(s) under `workDir/out`. Throws on non-zero exit/timeout.
   * `timeoutMs` overrides the default wall-clock cap (callers scale it with frame count).
   *
   * The container gets a deterministic-per-job name (`--name`) so a timeout can
   * kill it: SIGKILLing the podman CLI client leaves the container running
   * detached, and the caller's workdir cleanup would yank /work from under it —
   * the worker's final artifact copy then crashes ENOENT and the container exits
   * 1, producing a second spurious error after the timeout (observed in
   * production). On timeout we best-effort `podman kill <name>` before throwing;
   * `--rm` then removes the killed container.
   */
  async run(workDir: string, spec: RenderJobSpec, timeoutMs?: number): Promise<void> {
    const cfg = getPodmanRenderConfig();
    const budgetMs = timeoutMs ?? cfg.timeoutMs;
    fs.writeFileSync(path.join(workDir, 'job.json'), JSON.stringify(spec));
    fs.mkdirSync(path.join(workDir, 'out'), { recursive: true });
    // The container runs as the unprivileged `render` user, which maps to a
    // subuid that cannot write this host-owned dir. Open up the workdir so the
    // worker can drop the artifact in /work/out (contents are unguessable-id
    // scoped and removed after the render).
    fs.chmodSync(workDir, 0o777);
    fs.chmodSync(path.join(workDir, 'out'), 0o777);

    await this.ensurePool(cfg);

    const name = this.containerName(workDir);
    const args = ['run', '--rm', '--name', name];
    if (this.poolEnsured && !this.splitMode) {
      // Aggregate cap lives on the shared pod cgroup; the pod owns networking.
      args.push('--pod', cfg.pod);
    } else {
      // Degraded: per-container even-split caps + per-container network.
      const split = Math.max(1, getRenderConcurrency());
      const splitMem = this.splitMemory(cfg.memory, split);
      args.push(
        '--cpus',
        (cfg.cpus / split).toFixed(2),
        '--memory',
        splitMem,
        // memory-swap is the memory+swap TOTAL (cgroup v2), so equal to
        // --memory means zero swap: a runaway render cannot push the host
        // into swap thrash.
        '--memory-swap',
        splitMem,
        '--network',
        cfg.network,
      );
    }

    args.push(
      '-v',
      `${workDir}:/work:Z`,
      ...this.passthroughEnv(),
      cfg.image,
      '/work/job.json',
    );

    const res = await this.exec(cfg.bin, args, budgetMs);
    if (res.timedOut) {
      // Best-effort: the detached container may still be capturing; kill it so
      // it is gone (via --rm) before the caller deletes the workdir.
      try {
        await this.exec(cfg.bin, ['kill', name], 10000);
      } catch {
        /* never mask the timeout error */
      }
      throw new Error(`Podman render timed out after ${budgetMs}ms`);
    }
    if (res.code !== 0) {
      throw new Error(`Podman render exited ${res.code}: ${this.errorDetail(res.stderr)}`);
    }
  }

  /**
   * Deterministic-per-job container name (`postmill-render-<jobId>-<suffix>`; the
   * workdir basename IS the job id for both design and merge renders). The short
   * random suffix keeps a retried job from colliding with a still-running
   * container of a previous attempt.
   */
  private containerName(workDir: string): string {
    const base = path.basename(workDir).replace(/[^a-zA-Z0-9_.-]/g, '-');
    return `postmill-render-${base}-${randomBytes(3).toString('hex')}`;
  }

  /** Idempotently create the shared resource pool (aggregate cgroup cap). */
  private async ensurePool(cfg: PodmanRenderConfig): Promise<void> {
    if (this.poolEnsured) return;

    const exists = await this.exec(cfg.bin, ['pod', 'exists', cfg.pod], 15000);
    if (exists.code === 0) {
      this.poolEnsured = true;
      return;
    }

    const create = await this.exec(
      cfg.bin,
      [
        'pod',
        'create',
        '--name',
        cfg.pod,
        '--cpus',
        String(cfg.cpus),
        '--memory',
        cfg.memory,
        // memory-swap is the memory+swap TOTAL (cgroup v2), so equal to
        // --memory means zero swap for the pod cgroup — render jobs cannot
        // push the host into swap thrash.
        '--memory-swap',
        cfg.memory,
        '--network',
        cfg.network,
      ],
      30000,
    );

    if (create.code === 0) {
      this.poolEnsured = true;
      this.logger.log(
        `Created render pod '${cfg.pod}' (aggregate cap: ${cfg.cpus} CPU / ${cfg.memory})`,
      );
      return;
    }

    if (cfg.splitFallback) {
      this.splitMode = true;
      this.poolEnsured = true;
      this.logger.warn(
        `Render pod '${cfg.pod}' could not be created (${create.stderr.slice(-300)}); ` +
          `degrading to per-container even-split caps. cgroup v2 is required for an aggregate pool.`,
      );
      return;
    }

    throw new Error(`Failed to create render pod '${cfg.pod}': ${create.stderr.slice(-300)}`);
  }

  private passthroughEnv(): string[] {
    const out: string[] = [];
    for (const key of ['NEXT_PUBLIC_BACKEND_URL', 'FRONTEND_URL', 'SSRF_ALLOWED_PRIVATE_CIDRS', 'VIDEO_RENDER_CAPTURE_PAGES', 'VIDEO_RENDER_FRAME_TIMEOUT_MS']) {
      const val = process.env[key];
      if (val) out.push('-e', `${key}=${val}`);
    }
    return out;
  }

  /**
   * The stderr detail for a failed render container. A raw tail-slice truncates
   * mid-token and buries the actual error — a prod Sentry alert read
   * "exited 1: ode_modules/puppeteer-core/lib/puppeteer/api/Page.js:832:20)",
   * the tail of a stack trace with the real error line cut off. Surface the
   * first stderr line that looks like a thrown error ("Error: …",
   * "TimeoutError: …" — the worker's uncaught rejections print the error name
   * first); fall back to the tail when no such line exists (a bare podman
   * failure has none). Capped so the job row's 1000-char error column holds it.
   */
  private errorDetail(stderr: string): string {
    const line = stderr
      .split('\n')
      .map((l) => l.trim())
      .find((l) => /^[A-Za-z]*Error(:| )/.test(l));
    const detail = line || stderr.trim().slice(-800);
    return detail.slice(0, 800);
  }

  private splitMemory(memory: string, split: number): string {
    const match = /^(\d+(?:\.\d+)?)\s*([a-zA-Z]*)$/.exec(memory.trim());
    if (!match) return memory;
    const value = parseFloat(match[1]) / split;
    const unit = match[2] || 'b';
    return `${value.toFixed(0)}${unit}`;
  }

  private exec(bin: string, args: string[], timeoutMs: number): Promise<ExecResult> {
    return new Promise((resolve) => {
      const proc = spawn(bin, args, { stdio: 'pipe' });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGKILL');
      }, timeoutMs);

      proc.stdout?.on('data', (d) => (stdout += d.toString()));
      proc.stderr?.on('data', (d) => (stderr += d.toString()));
      proc.on('error', (err) => {
        clearTimeout(timer);
        resolve({ code: null, stdout, stderr: stderr + String(err), timedOut });
      });
      proc.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr, timedOut });
      });
    });
  }
}
