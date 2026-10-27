import { describe, expect, it } from 'vitest';
import { hasCompactStudio } from './compact-registry';

describe('hasCompactStudio', () => {
  it('retains HeyGen for avatar dialogs and excludes it from ordinary video', () => {
    expect(hasCompactStudio('heygen', 'avatar')).toBe(true);
    expect(hasCompactStudio('heygen', 'video')).toBe(false);
    expect(hasCompactStudio('heygen')).toBe(false);
  });
});
