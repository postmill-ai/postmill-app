import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { METRIC_REGISTRY } from '@gitroom/nestjs-libraries/integrations/social/analytics.metrics';

const KNOWN_METRICS = Object.keys(METRIC_REGISTRY);
const COMPARATORS = ['gte', 'lte', 'change_pct'] as const;
const DIRECTIONS = ['up', 'down'] as const;

// 7.3 — user-defined analytics alert rules.
//
// `comparator` semantics (evaluated daily against the same channel snapshots the
// anomaly detector loads):
//   - `gte` / `lte`: compare the metric's LATEST snapshot value against
//     `threshold` (e.g. "tell me when followers >= 10000").
//   - `change_pct`: trailing-7-day SUM vs the prior-7-day SUM; fires when the
//     signed percentage change crosses `threshold` in `direction` (`up` →
//     change >= threshold, `down` → change <= -threshold). Same window math for
//     every metric (e.g. "when impressions drop 30% week-over-week" =
//     comparator change_pct, threshold 30, direction down).
// `integrationId` null = the rule applies to every channel.
export class CreateAlertRuleDto {
  // Integration.id is a cuid (not a uuid) — length-bound string here; the
  // service's org-ownership check (assertIntegrationInOrg) is the real gate.
  @IsOptional()
  @IsString()
  @Length(1, 64)
  integrationId?: string;

  @IsString()
  @IsIn(KNOWN_METRICS, {
    message: `metric must be one of: ${KNOWN_METRICS.join(', ')}`,
  })
  metric!: string;

  @IsString()
  @IsIn(COMPARATORS, {
    message: `comparator must be one of: ${COMPARATORS.join(', ')}`,
  })
  comparator!: string;

  @IsNumber()
  @Min(0)
  @Max(1_000_000_000)
  threshold!: number;

  @IsOptional()
  @IsString()
  @IsIn(DIRECTIONS, { message: 'direction must be up or down' })
  direction?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateAlertRuleDto {
  // Integration.id is a cuid (not a uuid) — length-bound string here; the
  // service's org-ownership check (assertIntegrationInOrg) is the real gate.
  @IsOptional()
  @IsString()
  @Length(1, 64)
  integrationId?: string;

  @IsOptional()
  @IsString()
  @IsIn(KNOWN_METRICS, {
    message: `metric must be one of: ${KNOWN_METRICS.join(', ')}`,
  })
  metric?: string;

  @IsOptional()
  @IsString()
  @IsIn(COMPARATORS, {
    message: `comparator must be one of: ${COMPARATORS.join(', ')}`,
  })
  comparator?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000_000)
  threshold?: number;

  @IsOptional()
  @IsString()
  @IsIn(DIRECTIONS, { message: 'direction must be up or down' })
  direction?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

// 7.6 — org-level public share config. `integrations` scopes the shared report
// to a subset of channels (empty/absent = all); `rangePreset` picks a rolling
// window ('7d' | '30d' | '90d', default 30d) resolved to from/to at read time.
export class AnalyticsShareDto {
  // Bounded: stored verbatim in the share config JSON — cap count and id
  // length so an oversized payload can't bloat the row.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Length(1, 64, { each: true })
  integrations?: string[];

  @IsOptional()
  @IsIn(['7d', '30d', '90d'])
  rangePreset?: string;
}
