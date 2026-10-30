import 'reflect-metadata';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { RenderVideoDesignDto } from './render-video.design.dto';

const dtoWithPosterTime = (posterTimeMs: number) => {
  const dto = new RenderVideoDesignDto();
  dto.composition = {};
  dto.posterTimeMs = posterTimeMs;
  return dto;
};

describe('RenderVideoDesignDto posterTimeMs', () => {
  it.each([0, 1250, 180000])('accepts an integer timestamp within the render cap: %s', async (value) => {
    expect(await validate(dtoWithPosterTime(value))).toHaveLength(0);
  });

  it.each([-1, 1.5, 180001])('rejects an invalid timestamp: %s', async (value) => {
    const errors = await validate(dtoWithPosterTime(value));
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('posterTimeMs');
  });
});
