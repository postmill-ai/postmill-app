import { describe, it, expect, vi } from 'vitest';
import { PublicApiModule } from './public.api.module';

/**
 * J4 — Idempotency-Key on public mutations. We drive requests through the
 * module's idempotency middleware with a fake store that mirrors the real
 * @reaatech/idempotency-middleware-express contract (key = method+path+key,
 * replay-on-hit, capture-on-miss). The "create post" is modelled by the
 * downstream `next()` handler; we assert two identical calls run it once.
 */
describe('PublicApiModule — idempotency middleware (J4)', () => {
  const makeFakeFactory = () => {
    const store = new Map<string, { status: number; body: any }>();
    const middleware = (req: any, res: any, next: () => void) => {
      const key = `${req.method}:${req.path}:${req.headers['idempotency-key']}`;
      const cached = store.get(key);
      if (cached) {
        res.status(cached.status);
        res.json(cached.body);
        return;
      }
      const originalJson = res.json.bind(res);
      res.json = (body: any) => {
        store.set(key, { status: 201, body });
        return originalJson(body);
      };
      next();
    };
    return { getMiddleware: () => middleware } as any;
  };

  const makeReqRes = (key: string, orgId: string, method = 'POST') => {
    const req: any = {
      method,
      path: '/public/v1/posts',
      headers: { 'idempotency-key': key },
      org: { id: orgId },
    };
    const res: any = {
      status: vi.fn(function (this: any) {
        return this;
      }),
      json: vi.fn(),
    };
    return { req, res };
  };

  it('runs the create handler once for two identical keyed requests', async () => {
    const testModule = new PublicApiModule(makeFakeFactory());
    const mw = (testModule as any)._idempotency;
    const handler = vi.fn();

    const a = makeReqRes('KEY-1', 'org-1');
    mw(a.req, a.res, () => {
      handler();
      a.res.json({ id: 'post-1' });
    });

    const b = makeReqRes('KEY-1', 'org-1');
    mw(b.req, b.res, () => {
      handler();
      b.res.json({ id: 'post-2' });
    });

    expect(handler).toHaveBeenCalledTimes(1);
    // the repeat replays the first response
    expect(b.res.json).toHaveBeenCalledWith({ id: 'post-1' });
  });

  it('isolates the same key across orgs (no cross-tenant replay)', () => {
    const testModule = new PublicApiModule(makeFakeFactory());
    const mw = (testModule as any)._idempotency;
    const handler = vi.fn();

    const a = makeReqRes('SHARED', 'org-1');
    mw(a.req, a.res, () => {
      handler();
      a.res.json({ id: 'a' });
    });

    const b = makeReqRes('SHARED', 'org-2');
    mw(b.req, b.res, () => {
      handler();
      b.res.json({ id: 'b' });
    });

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('passes through when no Idempotency-Key header is present', () => {
    const testModule = new PublicApiModule(makeFakeFactory());
    const mw = (testModule as any)._idempotency;
    const next = vi.fn();
    const req: any = { method: 'POST', path: '/public/v1/posts', headers: {}, org: { id: 'o' } };
    const res: any = { status: vi.fn(), json: vi.fn() };
    mw(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('restores the real verb for DELETE on a cache miss', () => {
    const testModule = new PublicApiModule(makeFakeFactory());
    const mw = (testModule as any)._idempotency;
    let methodInHandler: string | undefined;
    const { req, res } = makeReqRes('DEL-1', 'org-1', 'DELETE');
    req.path = '/public/v1/posts/p1';
    mw(req, res, () => {
      methodInHandler = req.method;
      res.json({ ok: true });
    });
    expect(methodInHandler).toBe('DELETE');
  });
});
