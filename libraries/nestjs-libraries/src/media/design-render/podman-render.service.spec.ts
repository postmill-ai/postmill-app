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
      kill: () => {},
    };
    const code = shared.codes.shift() ?? 0;
    process.nextTick(() => handlers.close && handlers.close(code));
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
      '--network',
      'bridge',
    ]);

    const runArgs = argv[2];
    expect(runArgs[0]).toBe('run');
    expect(runArgs).toContain('--rm');
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
});
