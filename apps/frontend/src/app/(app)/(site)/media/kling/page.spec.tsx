import { beforeEach, describe, expect, it, vi } from 'vitest';

const { redirectMock } = vi.hoisted(() => ({ redirectMock: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

import LegacyKlingPage from './page';

describe('legacy fal-backed Kling route', () => {
  beforeEach(() => redirectMock.mockClear());

  it('redirects to the canonical fal.ai studio', () => {
    LegacyKlingPage();
    expect(redirectMock).toHaveBeenCalledWith('/media/fal');
  });
});
