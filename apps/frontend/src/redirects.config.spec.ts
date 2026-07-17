import { describe, it, expect } from 'vitest';
import { redirects, redirectsList } from './redirects.config';

describe('redirects.config', () => {
  describe('redirectsList', () => {
    it('redirects /launches to /posts permanently', () => {
      expect(redirectsList).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: '/launches',
            destination: '/posts',
            permanent: true,
          }),
        ])
      );
    });

    it('redirects legacy /schedule (and sub-paths) to /posts permanently', () => {
      expect(redirectsList).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: '/schedule',
            destination: '/posts',
            permanent: true,
          }),
          expect.objectContaining({
            source: '/schedule/:path*',
            destination: '/posts/:path*',
            permanent: true,
          }),
        ])
      );
    });

    it('redirects /api/uploads/:path* to /uploads/:path* permanently', () => {
      expect(redirectsList).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: '/api/uploads/:path*',
            destination: '/uploads/:path*',
            permanent: true,
          }),
        ])
      );
    });
  });

  describe('redirects()', () => {
    it('returns the redirects list', async () => {
      const result = await redirects();
      expect(result).toEqual(redirectsList);
    });
  });
});
