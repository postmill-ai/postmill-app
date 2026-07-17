import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * §13 surface-drift invariant (RELEASE_v3.4.0.md).
 *
 * A single grep-able test asserting that no raw OpenAI / CopilotKit construction
 * literal survives outside the pluggable-adapter layer + the env-OpenAI fallback path.
 *
 * - `new ChatOpenAI(` and `new DallEAPIWrapper(` may ONLY appear inside `/ai/adapters/`.
 * - `new OpenAI(` and `new OpenAIAdapter(` may ONLY appear inside `/ai/adapters/`,
 *   in the AI module's adapter-registry wiring (`/ai/ai.module.ts`, which constructs the
 *   project's own provider adapter classes), or in the CopilotKit env-OpenAI fallback
 *   path (`apps/backend/src/api/routes/copilot.controller.ts`).
 *
 * Any other occurrence is surface drift and fails the test, naming the offending file.
 */

// __dirname here is `.../libraries/nestjs-libraries/src/ai`.
const LIB_ROOT = path.resolve(__dirname, '..', '..'); // .../libraries/nestjs-libraries
const BACKEND_ROOT = path.resolve(__dirname, '../../../../apps/backend/src');

const SCAN_ROOTS = [path.join(LIB_ROOT, 'src'), BACKEND_ROOT];

function collectTsFiles(root: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(root)) {
    return out;
  }
  const stack: string[] = [root];
  while (stack.length) {
    const current = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') {
          continue;
        }
        stack.push(full);
      } else if (
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.spec.ts')
      ) {
        out.push(full);
      }
    }
  }
  return out;
}

// Normalize to forward slashes so allowlist checks are platform-independent.
const toPosix = (p: string) => p.split(path.sep).join('/');

const isInAdapters = (file: string) => toPosix(file).includes('/ai/adapters/');
const isAiModule = (file: string) => toPosix(file).endsWith('/ai/ai.module.ts');
const isCopilotController = (file: string) =>
  toPosix(file).endsWith('/apps/backend/src/api/routes/copilot.controller.ts');

const ALL_FILES = SCAN_ROOTS.flatMap(collectTsFiles);

describe('AI surface-drift invariant (§13)', () => {
  it('scans at least one source root (path resolution sanity check)', () => {
    expect(ALL_FILES.length).toBeGreaterThan(0);
  });

  it('no `new ChatOpenAI(` outside /ai/adapters/', () => {
    const offenders: string[] = [];
    for (const file of ALL_FILES) {
      if (isInAdapters(file)) continue;
      const src = fs.readFileSync(file, 'utf8');
      if (src.includes('new ChatOpenAI(')) offenders.push(file);
    }
    expect(
      offenders,
      `\`new ChatOpenAI(\` must only appear inside /ai/adapters/. Offenders:\n${offenders.join(
        '\n'
      )}`
    ).toEqual([]);
  });

  it('no `new DallEAPIWrapper(` outside /ai/adapters/', () => {
    const offenders: string[] = [];
    for (const file of ALL_FILES) {
      if (isInAdapters(file)) continue;
      const src = fs.readFileSync(file, 'utf8');
      if (src.includes('new DallEAPIWrapper(')) offenders.push(file);
    }
    expect(
      offenders,
      `\`new DallEAPIWrapper(\` must only appear inside /ai/adapters/. Offenders:\n${offenders.join(
        '\n'
      )}`
    ).toEqual([]);
  });

  it('`new OpenAI(` only in /ai/adapters/, ai.module.ts, or copilot.controller.ts', () => {
    const offenders: string[] = [];
    for (const file of ALL_FILES) {
      if (isInAdapters(file) || isAiModule(file) || isCopilotController(file)) {
        continue;
      }
      const src = fs.readFileSync(file, 'utf8');
      if (src.includes('new OpenAI(')) offenders.push(file);
    }
    expect(
      offenders,
      `\`new OpenAI(\` may only appear inside /ai/adapters/, /ai/ai.module.ts, or the CopilotKit env-fallback (copilot.controller.ts). Offenders:\n${offenders.join(
        '\n'
      )}`
    ).toEqual([]);
  });

  it('`new OpenAIAdapter(` only in /ai/adapters/, ai.module.ts, or copilot.controller.ts', () => {
    const offenders: string[] = [];
    for (const file of ALL_FILES) {
      if (isInAdapters(file) || isAiModule(file) || isCopilotController(file)) {
        continue;
      }
      const src = fs.readFileSync(file, 'utf8');
      if (src.includes('new OpenAIAdapter(')) offenders.push(file);
    }
    expect(
      offenders,
      `\`new OpenAIAdapter(\` may only appear inside /ai/adapters/, /ai/ai.module.ts, or the CopilotKit env-fallback (copilot.controller.ts). Offenders:\n${offenders.join(
        '\n'
      )}`
    ).toEqual([]);
  });
});
