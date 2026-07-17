import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

/**
 * Regression guard: after the subscription revamp, the only credit dimension
 * that remains is `video_export`. This spec fails if any forbidden AI-credit
 * string surfaces in non-test application source.
 *
 * Excluded from the scan:
 * - `*.spec.ts` and `*.int-spec.ts` test files
 * - Lines containing the marker words "historical" or "legacy" (old-behavior comments)
 */

const FORBIDDEN = [
  'ai_images',
  'ai_videos',
  'image_generation_count',
  'generate_videos',
  'checkCredits',
];

const ROOTS = [
  path.resolve(process.cwd(), 'apps'),
  path.resolve(process.cwd(), 'libraries'),
];

function* walkTsFiles(dir: string): Generator<string> {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      yield* walkTsFiles(full);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      yield full;
    }
  }
}

function collectViolations(): Array<{ file: string; line: number; text: string }> {
  const violations: Array<{ file: string; line: number; text: string }> = [];

  for (const root of ROOTS) {
    if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) continue;
    for (const file of walkTsFiles(root)) {
      const relative = path.relative(process.cwd(), file);
      if (relative.includes('/node_modules/')) continue;
      if (relative.endsWith('.spec.ts') || relative.endsWith('.int-spec.ts')) continue;

      const content = readFileSync(file, 'utf-8');
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/\b(historical|legacy)\b/i.test(line)) continue;
        for (const pattern of FORBIDDEN) {
          if (line.includes(pattern)) {
            violations.push({ file: relative, line: i + 1, text: line.trim() });
          }
        }
      }
    }
  }

  return violations;
}

describe('Regression — no AI credit paths remain', () => {
  it('has no forbidden ai_images / ai_videos / checkCredits strings in non-test source', () => {
    const violations = collectViolations();

    if (violations.length > 0) {
      const formatted = violations
        .map((v) => `${v.file}:${v.line}: ${v.text}`)
        .join('\n');
      throw new Error(
        `Found forbidden AI-credit strings in non-test source:\n${formatted}`
      );
    }

    expect(violations).toHaveLength(0);
  });
});
