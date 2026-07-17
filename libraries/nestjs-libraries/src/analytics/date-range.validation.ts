// Shared date-range validation for every analytics date route (authed v2,
// campaign, and public-API). Lives here — not in a controller — so the
// campaigns/public controllers don't import helpers from a sibling controller.

import { BadRequestException } from '@nestjs/common';
import dayjs from 'dayjs';

export function validateDateRange(from: string, to: string) {
  if (!from || !to) {
    throw new BadRequestException('from and to query parameters are required');
  }
  if (!dayjs(from).isValid() || !dayjs(to).isValid()) {
    throw new BadRequestException('from and to must be valid dates');
  }
}

export function validateToGteFrom(from: string, to: string) {
  if (dayjs(to).isBefore(dayjs(from))) {
    throw new BadRequestException('to must be greater than or equal to from');
  }
}

// Aggregation iterates day-by-day over the window (buildFilledDayMap and
// friends), so an unbounded range is a single-request CPU sink. Every date
// route must cap the window; 400 days comfortably covers "past year +
// comparison" while bounding query cost.
export const MAX_RANGE_DAYS = 400;

export function validateWindowCap(
  from: string,
  to: string,
  maxDays: number = MAX_RANGE_DAYS
) {
  if (dayjs(to).diff(dayjs(from), 'day') > maxDays) {
    throw new BadRequestException(`date range must not exceed ${maxDays} days`);
  }
}
