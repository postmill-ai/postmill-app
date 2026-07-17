import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
} from '@nestjs/common';
import { PostValidationException } from '@gitroom/nestjs-libraries/errors/post-validation.exception';

export type PostValidationError = {
  provider: string;
  name: string;
  error: string;
};

export { PostValidationException };

@Catch(PostValidationException)
export class PostValidationExceptionFilter implements ExceptionFilter {
  catch(exception: PostValidationException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const status = exception.getStatus();
    const { provider, name, error } =
      exception.getResponse() as PostValidationError;

    // Unified error envelope: { statusCode, error, message, ...context }.
    // `provider`/`name` (which channel/post failed) are preserved as extra
    // context fields. `error` here is the HTTP reason phrase; the validation
    // detail rides in `message`.
    response.status(status).json({
      statusCode: status,
      error: 'Bad Request',
      message: error,
      provider,
      name,
    });
  }
}
