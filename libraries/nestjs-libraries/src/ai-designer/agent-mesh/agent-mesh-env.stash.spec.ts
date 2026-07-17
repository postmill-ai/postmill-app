import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const AGENT_MESH_CJS = resolve(
  __dirname,
  '../../../../../node_modules/@reaatech/agent-mesh/dist/index.cjs'
);
const AGENT_MESH_PKG = resolve(
  __dirname,
  '../../../../../node_modules/@reaatech/agent-mesh/package.json'
);

const packageVersion = JSON.parse(readFileSync(AGENT_MESH_PKG, 'utf8')).version;

/**
 * Extract the keys declared in `EnvironmentSchema` from the package's CJS dist.
 * This avoids importing `@reaatech/agent-mesh` (which would run `loadEnv()` and
 * potentially `process.exit(1)`) just to inspect the schema shape.
 */
function schemaKeysFromDist(): string[] {
  const source = readFileSync(AGENT_MESH_CJS, 'utf8');
  const match = source.match(
    /EnvironmentSchema\s*=\s*import_zod\d+\.z\.object\(\{([^]*?)\}\)/
  );
  if (!match) {
    throw new Error('Could not locate EnvironmentSchema in agent-mesh dist');
  }
  const keys: string[] = [];
  const propRe = /^\s+(\w+):/gm;
  let m: RegExpExecArray | null;
  while ((m = propRe.exec(match[1])) !== null) {
    keys.push(m[1]);
  }
  return keys;
}

describe('agent-mesh-env stash/shim', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let exitStub: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Prevent a schema failure from killing the test runner while still
    // making such a failure observable.
    exitStub = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('agent-mesh called process.exit');
    });
    vi.resetModules();
  });

  afterEach(() => {
    exitStub.mockRestore();
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
    vi.resetModules();
  });

  it('pins the neutralization list to the installed package version', () => {
    // The implementation is expected to carry a comment naming the version it
    // was verified against. This test forces an explicit update on bumps.
    const stashSrc = readFileSync(
      resolve(__dirname, './agent-mesh-env.stash.ts'),
      'utf8'
    );
    expect(stashSrc).toContain(`// v${packageVersion}`);
  });

  it('lists every constrained key declared by the installed agent-mesh package', async () => {
    const schemaKeys = schemaKeysFromDist();
    expect(schemaKeys.length).toBeGreaterThan(0);

    const { watchedEnvKeys } = await import('./agent-mesh-env.stash');

    for (const key of schemaKeys) {
      expect(watchedEnvKeys).toContain(key);
    }
  });

  it('maps AI_DESIGNER_AGENT_REGISTRY to AGENT_REGISTRY_DIR pre-import and persists it', async () => {
    process.env.AI_DESIGNER_AGENT_REGISTRY = '/tmp/postmill-agents';

    await import('./agent-mesh-env.stash');
    expect(process.env.AGENT_REGISTRY_DIR).toBe('/tmp/postmill-agents');

    await import('./agent-mesh-env.shim');
    expect(process.env.AGENT_REGISTRY_DIR).toBe('/tmp/postmill-agents');
  });

  it('caps MCP_MAX_RETRIES and restores out-of-range values after import', async () => {
    process.env.MCP_MAX_RETRIES = '10';
    process.env.SESSION_TTL_MINUTES = '999999';

    const { stashedEnv } = await import('./agent-mesh-env.stash');
    expect(stashedEnv).toContainEqual(['MCP_MAX_RETRIES', '10']);
    expect(stashedEnv).toContainEqual(['SESSION_TTL_MINUTES', '999999']);
    expect(process.env.MCP_MAX_RETRIES).toBe('5');
    expect(process.env.SESSION_TTL_MINUTES).toBeUndefined();

    await import('./agent-mesh-env.shim');
    expect(process.env.MCP_MAX_RETRIES).toBe('10');
    expect(process.env.SESSION_TTL_MINUTES).toBe('999999');
  });

  it('deletes seeded placeholders and restores ENABLE_CIRCUIT_BREAKER', async () => {
    process.env.ENABLE_CIRCUIT_BREAKER = 'true';
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.API_KEY;

    await import('./agent-mesh-env.stash');
    expect(process.env.ENABLE_CIRCUIT_BREAKER).toBe('');

    await import('./agent-mesh-env.shim');
    expect(process.env.GOOGLE_CLOUD_PROJECT).toBeUndefined();
    expect(process.env.API_KEY).toBeUndefined();
    expect(process.env.ENABLE_CIRCUIT_BREAKER).toBe('true');
  });

  it('survives an otherwise fatal env without crashing the process', async () => {
    process.env.LOG_LEVEL = 'verbose';
    process.env.NODE_ENV = 'staging';
    process.env.PORT = 'abc';
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'not-a-url';

    await expect(import('./agent-mesh-env.shim')).resolves.toBeDefined();
    expect(process.exit).not.toHaveBeenCalled();

    expect(process.env.LOG_LEVEL).toBe('verbose');
    expect(process.env.NODE_ENV).toBe('staging');
    expect(process.env.PORT).toBe('abc');
    expect(process.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe('not-a-url');
  });
});
