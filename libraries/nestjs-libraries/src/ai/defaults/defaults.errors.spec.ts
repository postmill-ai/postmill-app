import { describe, it, expect } from 'vitest';
import {
  DefaultNotConfiguredError,
  DefaultOperationNotImplementedError,
} from './defaults.errors';

describe('defaults errors', () => {
  it('DefaultNotConfiguredError carries the category and a readable message', () => {
    const err = new DefaultNotConfiguredError('text-to-image');
    expect(err).toBeInstanceOf(Error);
    expect(err.category).toBe('text-to-image');
    expect(err.name).toBe('DefaultNotConfiguredError');
    expect(err.message).toContain('text-to-image');
  });

  it('DefaultOperationNotImplementedError carries the category and a readable message', () => {
    const err = new DefaultOperationNotImplementedError('image-slide');
    expect(err).toBeInstanceOf(Error);
    expect(err.category).toBe('image-slide');
    expect(err.name).toBe('DefaultOperationNotImplementedError');
    expect(err.message).toContain('image-slide');
  });
});
