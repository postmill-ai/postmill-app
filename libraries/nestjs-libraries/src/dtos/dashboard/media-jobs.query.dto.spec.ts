import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { MediaJobsQueryDto } from './media-jobs.query.dto';

/**
 * `GET /dashboard/media-jobs` is called two ways: bare by the dashboard widget,
 * and with filters + a cursor by /media/queue. The global validation pipe
 * rejects unknown fields, so everything the queue sends must be declared here —
 * and validated against what the database actually produces.
 */
const validate = (query: Record<string, unknown>) => {
  const dto = plainToInstance(MediaJobsQueryDto, query);
  return { dto, errors: validateSync(dto) };
};

describe('MediaJobsQueryDto', () => {
  it('accepts the widget’s bare call', () => {
    const { errors } = validate({});
    expect(errors).toHaveLength(0);
  });

  it('accepts a cuid cursor', () => {
    // Prisma ids here are cuids, not uuids. Validating as a uuid rejected every
    // real "Load more" with a 400.
    const { dto, errors } = validate({ cursor: 'cmsap7bv2002hp3ia0vlampaf' });
    expect(errors).toHaveLength(0);
    expect(dto.cursor).toBe('cmsap7bv2002hp3ia0vlampaf');
  });

  it('coerces the limit and holds it to the page bounds', () => {
    expect(validate({ limit: '20' }).dto.limit).toBe(20);
    expect(validate({ limit: '0' }).errors).not.toHaveLength(0);
    expect(validate({ limit: '500' }).errors).not.toHaveLength(0);
  });

  it('only accepts statuses the queue can filter by', () => {
    expect(validate({ status: 'failed' }).errors).toHaveLength(0);
    expect(validate({ status: 'completed' }).errors).toHaveLength(0);
    expect(validate({ status: 'not-a-status' }).errors).not.toHaveLength(0);
  });

  it('rejects an unbounded cursor', () => {
    expect(validate({ cursor: 'x'.repeat(65) }).errors).not.toHaveLength(0);
  });
});
