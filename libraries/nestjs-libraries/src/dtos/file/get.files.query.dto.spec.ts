import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { GetFilesQueryDto } from './get.files.query.dto';

const validate = (query: Record<string, unknown>) => {
  const dto = plainToInstance(GetFilesQueryDto, query);
  return { dto, errors: validateSync(dto) };
};

describe('GetFilesQueryDto', () => {
  it('accepts the existing page-0 and 1000-item client requests', () => {
    const { dto, errors } = validate({ page: '0', limit: '1000' });

    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(0);
    expect(dto.limit).toBe(1000);
  });

  it('rejects the oversized limit observed in production', () => {
    const { errors } = validate({ page: '1', limit: '999999999999999999999' });

    expect(errors.map((error) => error.property)).toContain('limit');
  });

  it('rejects pages whose computed database offset is unsafe', () => {
    const { errors } = validate({ page: '1000001', limit: '24' });

    expect(errors.map((error) => error.property)).toContain('page');
  });
});
