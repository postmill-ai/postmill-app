import { HttpException, HttpStatus } from '@nestjs/common';

export type PostValidationError = {
  provider: string;
  name: string;
  error: string;
};

export class PostValidationException extends HttpException {
  constructor(message: PostValidationError) {
    super(message, HttpStatus.BAD_REQUEST);
  }
}
