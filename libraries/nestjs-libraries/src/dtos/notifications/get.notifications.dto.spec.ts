import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { GetNotificationsDto } from './get.notifications.dto';

const validate = (query: Record<string, unknown>) => {
  const dto = plainToInstance(GetNotificationsDto, query);
  return { dto, errors: validateSync(dto) };
};

describe('GetNotificationsDto', () => {
  it('accepts zero-based and maximum supported pages', () => {
    expect(validate({ page: '0' }).errors).toHaveLength(0);
    expect(validate({ page: '1000000' }).errors).toHaveLength(0);
  });

  it('rejects the oversized page observed in production', () => {
    const { errors } = validate({ page: '999999999999999999999' });

    expect(errors.map((error) => error.property)).toContain('page');
  });

  it('rejects fractional pages', () => {
    const { errors } = validate({ page: '1.5' });

    expect(errors.map((error) => error.property)).toContain('page');
  });
});
