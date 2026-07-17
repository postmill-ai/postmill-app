import {
  IsOptional,
  IsString,
  IsDateString,
  IsNumber,
  Min,
  Max,
  ValidateBy,
  ValidationOptions,
  buildMessage,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// 4.3b: DTO-level belt-and-suspenders for the repo's ~92-day MAX_WINDOW_DAYS clamp
// (posts.repository.ts). Rejects an `endDate` that is more than `maxDays` after the
// sibling `startDate` so an absurd multi-year window is refused at the edge rather
// than silently clamped. The repo clamp stays the runtime enforcer.
const MAX_WINDOW_DAYS = 92;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

function IsWithinWindowOf(
  property: string,
  maxDays: number,
  validationOptions?: ValidationOptions
) {
  return ValidateBy(
    {
      name: 'isWithinWindowOf',
      constraints: [property, maxDays],
      validator: {
        validate(value: any, args): boolean {
          const [relatedPropertyName, days] = args!.constraints as [
            string,
            number
          ];
          const start = (args!.object as any)[relatedPropertyName];
          // Presence/format is @IsDateString's job — only enforce the window when
          // both ends parse to a real date.
          if (value == null || start == null) {
            return true;
          }
          const startMs = Date.parse(start);
          const endMs = Date.parse(value);
          if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
            return true;
          }
          return (endMs - startMs) / MS_PER_DAY <= days;
        },
        defaultMessage: buildMessage(
          (eachPrefix) =>
            `${eachPrefix}$property must not be more than ${maxDays} days after ${property}`,
          validationOptions
        ),
      },
    },
    validationOptions
  );
}

export class GetPostsDto {
  @ApiProperty({
    description: 'Inclusive start of the publish-date window (ISO 8601).',
    example: '2026-01-01T00:00:00.000Z',
  })
  @IsDateString()
  startDate: string;

  @ApiProperty({
    description: 'Inclusive end of the publish-date window (ISO 8601).',
    example: '2026-01-31T23:59:59.000Z',
  })
  @IsDateString()
  @IsWithinWindowOf('startDate', MAX_WINDOW_DAYS)
  endDate: string;

  @ApiPropertyOptional({
    description: 'Filter to a single customer/group id.',
  })
  @IsOptional()
  @IsString()
  customer: string;

  // ── Public-API pagination (J2) ─────────────────────────────────────────────
  // The public `/posts` route otherwise returns every post in the window. These
  // bound the response: the controller caps at `limit` (default+hard-max) and
  // returns a `cursor` for the next page. Omitting them keeps the existing
  // response shape, just capped at the default. The internal calendar never
  // sends them, so its behaviour is unchanged.
  @ApiPropertyOptional({
    description:
      'Max posts to return (public API). Defaults to 100 and is hard-capped at 100.',
    minimum: 1,
    maximum: 100,
    default: 100,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  @Transform(({ value }) => parseInt(value, 10))
  limit?: number;

  @ApiPropertyOptional({
    description:
      'Opaque offset cursor returned by a previous page (public API). Start of the next slice.',
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) => parseInt(value, 10))
  cursor?: number;

  // The calendar always sends `display` (week/month/day/list) on /posts — without a
  // decorator the global forbidNonWhitelisted pipe rejects it ("property display should
  // not exist") and the entire calendar data view 400s → no post cards render.
  // See apps/frontend/src/components/launches/calendar.context.tsx (loadData).
  @IsOptional()
  @IsString()
  display?: string;
}
