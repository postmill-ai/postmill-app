import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const shared = vi.hoisted(() => ({
  calls: [] as Array<{ bin: string; args: string[] }>,
  codes: [] as number[],
}));

vi.mock('child_process', () => ({
  spawn: vi.fn((bin: string, args: string[]) => {
    shared.calls.push({ bin, args });
    const handlers: Record<string, (arg?: any) => void> = {};
    const proc = {
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (event: string, cb: (arg?: any) => void) => {
        handlers[event] = cb;
      },
      // SIGKILL (e.g. the exec timeout) terminates the process asynchronously.
      kill: () => {
        process.nextTick(() => handlers.close && handlers.close(null));
      },
    };
    const code = shared.codes.shift() ?? 0;
    // Sentinel -1: the process hangs — only the kill() above ever closes it.
    if (code !== -1) {
      process.nextTick(() => handlers.close && handlers.close(code));
    }
    return proc as any;
  }),
}));

import { PodmanRenderService } from './podman-render.service';
import { DesignRenderJobSpec } from './render-job-spec';

function makeWorkDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'podman-spec-'));
}

const designSpec: DesignRenderJobSpec = {
  op: 'design',
  composition: { width: 100, height: 100, durationMs: 1000 },
  options: {
    fps: 30,
    bitrateKbps: 8000,
    format: 'mp4',
    quality: 0.8,
    jobId: 'job-1',
    orgId: 'org-1',
    renderToken: 'tok',
  },
  baseUrl: 'http://localhost:3000',
};

describe('PodmanRenderService', () => {
  beforeEach(() => {
    shared.calls.length = 0;
    shared.codes.length = 0;
    delete process.env.VIDEO_RENDER_PODMAN_ENABLED;
    for (const k of [
      'VIDEO_RENDER_CPUS',
      'VIDEO_RENDER_MEMORY',
      'VIDEO_RENDER_POD',
      'VIDEO_RENDER_IMAGE',
      'VIDEO_RENDER_NETWORK',
    ]) {
      delete process.env[k];
    }
  });

  it('creates the pool with the aggregate cpu/memory cap, then runs the job in that pod', async () => {
    // pod exists -> code 1 (absent); pod create -> 0; run -> 0
    shared.codes.push(1, 0, 0);
    const workDir = makeWorkDir();
    const svc = new PodmanRenderService();

    await svc.run(workDir, designSpec);

    const argv = shared.calls.map((c) => c.args);
    expect(argv[0]).toEqual(['pod', 'exists', 'postmill-render']);
    expect(argv[1]).toEqual([
      'pod',
      'create',
      '--name',
      'postmill-render',
      '--cpus',
      '4',
      '--memory',
      '8g',
      // Zero swap allowance (memory-swap is the memory+swap total on cgroup
      // v2): a render pod cannot push the host into swap thrash.
      '--memory-swap',
      '8g',
      '--network',
      'bridge',
    ]);

    const runArgs = argv[2];
    expect(runArgs[0]).toBe('run');
    expect(runArgs).toContain('--rm');
    expect(runArgs).toContain('--name');
    expect(runArgs[runArgs.indexOf('--name') + 1]).toMatch(/^postmill-render-/);
    expect(runArgs).toContain('--pod');
    expect(runArgs).toContain('postmill-render');
    // No per-container cpu/memory limits when the aggregate pod is in use.
    expect(runArgs).not.toContain('--cpus');
    expect(runArgs).toContain('-v');
    expect(runArgs).toContain(`${workDir}:/work:Z`);
    expect(runArgs).toContain('localhost/postmill-render:latest');
    expect(runArgs[runArgs.length - 1]).toBe('/work/job.json');

    // job.json + out dir were materialised in the workdir.
    expect(fs.existsSync(path.join(workDir, 'job.json'))).toBe(true);
    expect(fs.existsSync(path.join(workDir, 'out'))).toBe(true);
    // World-writable so the container's unprivileged render user (a subuid)
    // can write the artifact into /work/out.
    expect(fs.statSync(workDir).mode & 0o777).toBe(0o777);
    expect(fs.statSync(path.join(workDir, 'out')).mode & 0o777).toBe(0o777);
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('degrades to per-container even-split caps when the pod cannot be created', async () => {
    // pod exists -> 1 (absent); pod create -> 125 (fails); run -> 0
    shared.codes.push(1, 125, 0);
    process.env.VIDEO_RENDER_CONCURRENCY = '4';
    const workDir = makeWorkDir();
    const svc = new PodmanRenderService();

    await svc.run(workDir, designSpec);

    const runArgs = shared.calls[shared.calls.length - 1].args;
    expect(runArgs).not.toContain('--pod');
    expect(runArgs).toContain('--cpus');
    // 4 CPU total / 4 concurrency = 1.00 per container
    expect(runArgs[runArgs.indexOf('--cpus') + 1]).toBe('1.00');
    // 8g total / 4 concurrency = 2g per container, and memory-swap pinned to
    // the same value so the degraded path also gets zero swap allowance.
    expect(runArgs[runArgs.indexOf('--memory') + 1]).toBe('2g');
    expect(runArgs[runArgs.indexOf('--memory-swap') + 1]).toBe('2g');
    expect(runArgs).toContain('--network');
    fs.rmSync(workDir, { recursive: true, force: true });
    delete process.env.VIDEO_RENDER_CONCURRENCY;
  });

  it('throws on a non-zero container exit', async () => {
    shared.codes.push(0, 1); // pod exists -> ok; run -> 1
    const workDir = makeWorkDir();
    const svc = new PodmanRenderService();

    await expect(svc.run(workDir, designSpec)).rejects.toThrow(/exited 1/);
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('kills the named container when the run times out, then throws', async () => {
    shared.codes.push(0, -1); // pod exists -> ok; run -> hangs until SIGKILLed
    const workDir = makeWorkDir();
    const svc = new PodmanRenderService();

    await expect(svc.run(workDir, designSpec, 20)).rejects.toThrow(
      /timed out after 20ms/,
    );

    const runArgs = shared.calls.find((c) => c.args[0] === 'run')!.args;
    expect(runArgs).toContain('--rm');
    const name = runArgs[runArgs.indexOf('--name') + 1];
    expect(name).toMatch(/^postmill-render-/);
    // The detached container is killed by name before the timeout error is
    // thrown, so the caller's workdir cleanup can't yank /work from under it
    // (the late ENOENT + spurious second "exited 1" from production).
    const killCall = shared.calls.find((c) => c.args[0] === 'kill');
    expect(killCall?.args).toEqual(['kill', name]);
    fs.rmSync(workDir, { recursive: true, force: true });
  });
});
