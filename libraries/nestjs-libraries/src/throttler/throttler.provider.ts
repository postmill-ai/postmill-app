import { ThrottlerGuard } from '@nestjs/throttler';
import { ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { resolveClientIp } from '@gitroom/nestjs-libraries/utils/client-ip';

@Injectable()
export class ThrottlerBehindProxyGuard extends ThrottlerGuard {
  public override async canActivate(
    context: ExecutionContext
  ): Promise<boolean> {
    // 1G: throttle every route by default. The base ThrottlerGuard applies the
    // global default limit unless @SkipThrottle is present, and honors any
    // per-route @Throttle override automatically. (Previously this guard
    // returned true for all non-decorated routes, making the global throttle —
    // and every @Throttle added by 3Q/3AC — inert.)
    const req = context.switchToHttp().getRequest<Request>();
    if (req.url?.indexOf('/api/inngest') === 0) {
      return true;
    }
    return super.canActivate(context);
  }

  protected override async getTracker(
    req: Record<string, any>
  ): Promise<string> {
    // F9: behind a reverse proxy req.ip is the socket peer (the proxy's
    // address, identical for every client), so pre-auth routes shared one
    // platform-wide bucket. Resolve the real client IP from XFF via
    // TRUST_PROXY_HOPS (Nth-from-right); unset/invalid falls back to req.ip
    // (never blanket-trust XFF, and do NOT set Express `trust proxy`).
    const clientIp = resolveClientIp(
      req.headers?.['x-forwarded-for'],
      req.ip || 'anon'
    );
    const orgId = req.org?.id || clientIp;
    return (
      orgId + '_' + (req.url.indexOf('/posts') > -1 ? 'posts' : 'other')
    );
  }
}
