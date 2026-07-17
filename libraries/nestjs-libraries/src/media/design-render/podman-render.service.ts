import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
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
   */
  async run(workDir: string, spec: RenderJobSpec): Promise<void> {
    const cfg = getPodmanRenderConfig();
    fs.writeFileSync(path.join(workDir, 'job.json'), JSON.stringify(spec));
    fs.mkdirSync(path.join(workDir, 'out'), { recursive: true });

    await this.ensurePool(cfg);

    const args = ['run', '--rm'];
    if (this.poolEnsured && !this.splitMode) {
      // Aggregate cap lives on the shared pod cgroup; the pod owns networking.
      args.push('--pod', cfg.pod);
    } else {
      // Degraded: per-container even-split caps + per-container network.
      const split = Math.max(1, getRenderConcurrency());
      args.push(
        '--cpus',
        (cfg.cpus / split).toFixed(2),
        '--memory',
        this.splitMemory(cfg.memory, split),
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

    const res = await this.exec(cfg.bin, args, cfg.timeoutMs);
    if (res.timedOut) {
      throw new Error(`Podman render timed out after ${cfg.timeoutMs}ms`);
    }
    if (res.code !== 0) {
      throw new Error(`Podman render exited ${res.code}: ${res.stderr.slice(-800)}`);
    }
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
    for (const key of ['NEXT_PUBLIC_BACKEND_URL', 'FRONTEND_URL', 'SSRF_ALLOWED_PRIVATE_CIDRS']) {
      const val = process.env[key];
      if (val) out.push('-e', `${key}=${val}`);
    }
    return out;
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
