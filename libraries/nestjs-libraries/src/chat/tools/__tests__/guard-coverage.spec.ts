import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

/**
 * Invariant: every tool registered in `tool.list.ts` carries an in-`execute`
 * access guard (`requireRead(` or `requireWrite(`). Over MCP/A2A the HTTP-layer
 * scope check is not enough — a tool with no in-tool guard executes for any
 * authenticated caller regardless of scope/mode (this is exactly how the
 * unguarded generateImage/generateVideo/designerDesign spend tools shipped).
 * This test fails the moment a guard is deleted from any registered tool, or a
 * new tool is registered without one.
 *
 * PLACEMENT check, not just presence. For each tool we slice source from the
 * `execute` keyword to end of file (fine for these single-tool files), strip
 * comments, then require that a `requireRead`/`requireWrite` call appears AND
 * that it precedes the first `await this._<work>` call. This catches the two
 * false-green cases a plain "file contains require(Read|Write)(" match missed:
 *   1. a guard that was commented out (`// requireRead(...)`), and
 *   2. a guard placed AFTER the spend/work (post-spend — the caller is charged
 *      before the scope is ever checked).
 * It is a HEURISTIC — a lexical scan, not a control-flow analysis. It assumes
 * the guarded work is invoked as `await this._…`, which is the convention every
 * current tool follows; a tool that guards correctly but reaches its work
 * through a differently-shaped call could still trip it (adjust the convention
 * or allowlist with justification if that ever happens).
 */

/**
 * Strip `//` line comments and `/* *\/` block comments so a commented-out guard
 * (or a guard mentioned inside a comment) does not count as real placement.
 * Edge cases NOT handled (acceptable for these source files): `//` or `/*`
 * appearing inside a string/regex/template literal would be wrongly stripped.
 * None of the tool files place such sequences inside literals before their
 * guard/work, so this simple regex strip is sufficient and kept deliberately
 * dumb.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments first
    .replace(/\/\/.*$/gm, ''); // then line comments
}

const TOOLS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOOL_LIST_SRC = readFileSync(join(TOOLS_DIR, 'tool.list.ts'), 'utf8');

// Tools that are intentionally guard-free (static, no org data, no spend).
// Keep EMPTY — every current tool has a guard. Adding an entry must be justified.
const ALLOWLIST = new Set<string>([]);

/** class name -> module basename, parsed from the import statements. */
function buildClassToBasename(): Record<string, string> {
  const map: Record<string, string> = {};
  const importRe = /import\s*\{\s*([A-Za-z0-9_]+)\s*\}\s*from\s*'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(TOOL_LIST_SRC))) {
    const className = m[1];
    const importPath = m[2];
    const basename = importPath.split('/').pop()!;
    map[className] = basename;
  }
  return map;
}

/** class names inside the `export const toolList = [ ... ]` array. */
function registeredClassNames(): string[] {
  const arrayMatch = TOOL_LIST_SRC.match(/export const toolList\s*=\s*\[([\s\S]*?)\]/);
  if (!arrayMatch) throw new Error('Could not locate toolList array');
  return arrayMatch[1]
    .split(',')
    .map((s) => s.replace(/\/\/.*$/gm, '').trim())
    .filter((s) => /^[A-Za-z0-9_]+$/.test(s));
}

describe('tool guard coverage', () => {
  const classToBasename = buildClassToBasename();
  const registered = registeredClassNames();

  it('registers a non-trivial set of tools', () => {
    expect(registered.length).toBeGreaterThanOrEqual(30);
  });

  it.each(registered)('%s guards before it works', (className) => {
    if (ALLOWLIST.has(className)) return;
    const basename = classToBasename[className];
    // Fail loud when an import mapping is missing (unchanged behavior).
    expect(basename, `no import mapping for ${className}`).toBeTruthy();
    const rawSrc = readFileSync(join(TOOLS_DIR, `${basename}.ts`), 'utf8');

    // Slice from the `execute` keyword to end of file (single-tool files).
    const execIdx = rawSrc.indexOf('execute');
    expect(
      execIdx,
      `${basename} (${className}) has no execute()`
    ).toBeGreaterThanOrEqual(0);
    const body = stripComments(rawSrc.slice(execIdx));

    const readIdx = body.indexOf('requireRead');
    const writeIdx = body.indexOf('requireWrite');
    const guardIdx = [readIdx, writeIdx].filter((i) => i !== -1).sort((a, b) => a - b)[0] ?? -1;
    expect(
      guardIdx,
      `${basename} (${className}) is registered but has no requireRead/requireWrite guard in execute`
    ).not.toBe(-1);

    // The first `await this._…` is the tool's guarded work; the guard must precede it.
    const workIdx = body.search(/await\s+this\._/);
    if (workIdx !== -1) {
      expect(
        guardIdx,
        `${basename} (${className}) calls its guard AFTER the first \`await this._\` (post-spend / unguarded work)`
      ).toBeLessThan(workIdx);
    }
  });
});
