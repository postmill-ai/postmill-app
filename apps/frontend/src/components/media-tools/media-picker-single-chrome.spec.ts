import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * The picker renders its own dialog. Wrapping it in `useModals().openModal`
 * stacks a second, differently-titled chrome around it — which is exactly how
 * the app came to look like it had several different file selectors.
 *
 * This is a static guard rather than a convention, because a convention is what
 * failed: seven call sites had drifted into their own wrappers, five of which
 * passed `removeLayout` and so rendered a title nobody could see.
 *
 * It also catches the second half of the rule: nothing outside the picker module
 * may render `<MediaSelectorModal>` directly — go through `useMediaPicker()`.
 */
const COMPONENTS = join(__dirname, '..');
const ALLOWED = ['media-selector-modal.tsx', 'use-media-picker.tsx'];

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry) && !/\.spec\.tsx?$/.test(entry) ? [full] : [];
  });

/** Source of each `openModal({...})` call, brace-matched so nesting is handled. */
const openModalCalls = (source: string): string[] => {
  const calls: string[] = [];
  const re = /openModal\(\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    let depth = 0;
    let i = match.index + match[0].length - 1;
    const start = i;
    for (; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    calls.push(source.slice(start, i + 1));
  }
  return calls;
};

describe('the media picker has exactly one chrome', () => {
  const files = walk(COMPONENTS);

  it('finds component files to scan', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('is never wrapped in openModal', () => {
    const offenders = files.flatMap((file) =>
      openModalCalls(readFileSync(file, 'utf8'))
        .filter((call) => /MediaSelectorModal|useMediaPicker/.test(call))
        .map(() => file.replace(COMPONENTS, ''))
    );

    expect(offenders).toEqual([]);
  });

  it('is only rendered from the picker module', () => {
    const offenders = files
      .filter((file) => !ALLOWED.some((name) => file.endsWith(name)))
      .filter((file) => /<MediaSelectorModal[\s/>]/.test(readFileSync(file, 'utf8')))
      .map((file) => file.replace(COMPONENTS, ''));

    expect(offenders).toEqual([]);
  });
});
