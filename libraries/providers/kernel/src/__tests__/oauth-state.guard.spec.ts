import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * F11 grep-guard — the OAuth `state` (and OIDC `nonce`) is simultaneously the
 * CSRF token and the Redis capability key (`organization:` / `login:`) binding
 * a connect flow to an org. Every social adapter must derive it from
 * `makeOauthState()` (128-bit) or a legacy `makeId(>=32)` — `makeId(n)` yields
 * only n*4 bits, and the pre-fix code shipped brute-forceable makeId(6)=24-bit
 * and makeId(17)=68-bit states (which a `makeId(<8)` check would have missed).
 */

const providersRoot = path.resolve(__dirname, '../../..');

const collectSocialAdapterSources = (): string[] => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === 'node_modules' || entry === 'dist') continue;
        walk(full);
        continue;
      }
      if (entry === 'social.adapter.ts') {
        files.push(full);
      }
    }
  };
  walk(providersRoot);

  // Kernel base classes implementing generateAuthUrl for whole provider families.
  const families = path.join(providersRoot, 'kernel/src/domains/social-families');
  for (const entry of readdirSync(families)) {
    if (entry.endsWith('-base.ts')) {
      files.push(path.join(families, entry));
    }
  }
  return files.sort();
};

// `const state = ...;` / `const nonce = ...;` (single-line declarations).
const DECLARATION = /const\s+(state|nonce)\s*=\s*([^;]+);/;
// Inline `'state', makeId(n)` (e.g. formData.append('state', makeId(32))).
const INLINE_STATE = /['"]state['"]\s*,\s*makeId\((\d+)\)/;

const isAllowedRhs = (rhs: string): boolean => {
  if (rhs === 'makeOauthState()') return true;
  const legacy = rhs.match(/^makeId\((\d+)\)$/);
  return !!legacy && Number(legacy[1]) >= 32;
};

describe('F11 grep-guard — every social adapter OAuth state/nonce is >= 128-bit', () => {
  it('derives every state/nonce from makeOauthState() or makeId(>=32)', () => {
    const files = collectSocialAdapterSources();
    // Guard against the collector silently matching nothing.
    expect(files.length).toBeGreaterThan(30);

    const violations: string[] = [];
    for (const file of files) {
      const rel = path.relative(providersRoot, file);
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          const decl = line.match(DECLARATION);
          if (decl && !isAllowedRhs(decl[2].trim())) {
            violations.push(`${rel}:${index + 1} ${line.trim()}`);
          }
          const inline = line.match(INLINE_STATE);
          if (inline && Number(inline[1]) < 32) {
            violations.push(`${rel}:${index + 1} ${line.trim()}`);
          }
        });
    }

    expect(violations).toEqual([]);
  });

  it('is not vacuous — the 128-bit helper is present across the adapters', () => {
    const files = collectSocialAdapterSources();
    const withHelper = files.filter((file) =>
      readFileSync(file, 'utf8').includes('makeOauthState()')
    );
    // 29 adapters + 3 kernel family bases at the time of writing.
    expect(withHelper.length).toBeGreaterThanOrEqual(30);
  });
});
