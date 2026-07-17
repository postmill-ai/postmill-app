import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
} from '@nestjs/common';
import { Response } from 'express';
import { removeAuth } from '@gitroom/backend/services/auth/auth.middleware';

export class HttpForbiddenException extends HttpException {
  constructor() {
    super('Forbidden', 403);
  }
}

@Catch(HttpForbiddenException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpForbiddenException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    removeAuth(response);

    // Unified error envelope: { statusCode, error, message, ...context }.
    // NOTE: status is intentionally 401, NOT 403. Despite the class name, this
    // exception is the auth-middleware's *unauthenticated* rejection (missing /
    // invalid / expired token — 6 call sites in auth.middleware.ts +
    // public.auth.middleware.ts) and it clears the auth cookie via removeAuth().
    // 401 is the correct signal for "session invalid, re-authenticate" and the
    // frontend keys on 401 to redirect to login. The plan's J1 401→403 flip was
    // based on the (incorrect) assumption that this was an authorization failure;
    // flipping it would break the login-redirect contract. Envelope unified; code
    // preserved at 401 deliberately.
    return response.status(401).json({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Unauthorized',
    });
  }
}
