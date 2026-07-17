import {
  PipeTransform,
  Injectable,
  BadRequestException,
} from '@nestjs/common';

/**
 * Postmill primary keys are Prisma `cuid()` / `cuid2()` values (e.g.
 * `cmpz4vjqd0000ol7p9t6ofk10`), NOT UUIDs. Validating route `:id` params with
 * Nest's `ParseUUIDPipe` therefore rejected every real id with
 * `400 "Validation failed (uuid is expected)"` — which silently broke the post
 * detail modal, post analytics, and the whole social-comments feature. Use this
 * instead to validate ids in the actual format without breaking them.
 */
export const isCuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z0-9]{20,40}$/i.test(value);

@Injectable()
export class ParseCuidPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!isCuid(value)) {
      throw new BadRequestException('Validation failed (cuid is expected)');
    }
    return value;
  }
}
