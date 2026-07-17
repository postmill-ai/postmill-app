import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

/**
 * Structural guard that verifies the request has already been authenticated by
 * {@link AuthMiddleware}. This lets individual route handlers declare auth
 * protection explicitly with `@UseGuards(AuthGuard)` rather than relying only on
 * the global middleware group, making the security boundary visible at the
 * handler definition.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    // AuthMiddleware populates req.user after validating the JWT/session.
    return !!request.user;
  }
}
