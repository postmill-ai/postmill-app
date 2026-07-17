import { describe, it, expect } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { BulkCreatePostsDto } from './bulk.create.posts.dto';
import { CreatePostDto, PostContent } from './create.post.dto';
import { ValidatePostsDto } from './validate.posts.dto';
import { CreateCommentDto } from './create.comment.dto';
import { SeparatePostsDto } from './separate.posts.dto';
import { ShouldShortlinkDto } from './should.shortlink.dto';
import { GetPostsDto } from './get.posts.dto';

const errFor = (errors: any[], property: string) =>
  errors.find((e) => e.property === property);

describe('BulkCreatePostsDto (task 1.5 — array caps)', () => {
  const row = () => ({
    content: 'hi',
    channels: ['a'],
    scheduleAt: '2026-02-01T12:00:00.000Z',
  });

  it('accepts a small batch', async () => {
    const dto = plainToInstance(BulkCreatePostsDto, { rows: [row()] });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects > 100 rows (@ArrayMaxSize)', async () => {
    const dto = plainToInstance(BulkCreatePostsDto, {
      rows: Array.from({ length: 101 }, row),
    });
    const errors = await validate(dto);
    expect(errFor(errors, 'rows')?.constraints).toHaveProperty('arrayMaxSize');
  });

  it('rejects > 50 channels on a row (@ArrayMaxSize)', async () => {
    const dto = plainToInstance(BulkCreatePostsDto, {
      rows: [{ ...row(), channels: Array.from({ length: 51 }, () => 'a') }],
    });
    const errors = await validate(dto);
    // nested row error carries a children error for `channels`
    const rowsErr = errFor(errors, 'rows');
    const childChannels = rowsErr?.children?.[0]?.children?.find(
      (c: any) => c.property === 'channels'
    );
    expect(childChannels?.constraints).toHaveProperty('arrayMaxSize');
  });
});

describe('PostContent.delay (task 1.7 — bounds)', () => {
  it('accepts delay within 0..1440', async () => {
    const dto = plainToInstance(PostContent, { content: 'x', image: [], delay: 10 });
    const errors = await validate(dto);
    expect(errFor(errors, 'delay')).toBeUndefined();
  });

  it('rejects delay -5 (@Min)', async () => {
    const dto = plainToInstance(PostContent, { content: 'x', image: [], delay: -5 });
    const errors = await validate(dto);
    expect(errFor(errors, 'delay')?.constraints).toHaveProperty('min');
  });

  it('rejects delay 1e7 (@Max)', async () => {
    const dto = plainToInstance(PostContent, { content: 'x', image: [], delay: 1e7 });
    const errors = await validate(dto);
    expect(errFor(errors, 'delay')?.constraints).toHaveProperty('max');
  });
});

describe('CreatePostDto (tasks 4.1d/4.1e)', () => {
  it('validates nested tags (task 4.1d — @Type wired)', async () => {
    const dto = plainToInstance(CreatePostDto, {
      type: 'draft',
      shortLink: false,
      date: '2026-02-01T12:00:00.000Z',
      tags: [{ label: 'x' }], // missing `value`
      posts: [],
    });
    const errors = await validate(dto);
    const tagsErr = errFor(errors, 'tags');
    // @Type(() => Tags) means the missing `value` surfaces as a nested child error
    expect(tagsErr?.children?.length).toBeGreaterThan(0);
  });

  it('rejects > 50 top-level posts (task 4.1e — @ArrayMaxSize)', async () => {
    const dto = plainToInstance(CreatePostDto, {
      type: 'schedule',
      shortLink: false,
      date: '2026-02-01T12:00:00.000Z',
      tags: [],
      posts: Array.from({ length: 51 }, () => ({})),
    });
    const errors = await validate(dto);
    expect(errFor(errors, 'posts')?.constraints).toHaveProperty('arrayMaxSize');
  });
});

describe('ValidatePostsDto (task 4.1e — @ArrayMaxSize)', () => {
  it('rejects > 50 posts', async () => {
    const dto = plainToInstance(ValidatePostsDto, {
      posts: Array.from({ length: 51 }, () => ({ integration: { id: 'x' } })),
    });
    const errors = await validate(dto);
    expect(errFor(errors, 'posts')?.constraints).toHaveProperty('arrayMaxSize');
  });
});

describe('CreateCommentDto (task 4.1c)', () => {
  it('accepts a normal comment', async () => {
    const dto = plainToInstance(CreateCommentDto, { comment: 'looks good' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects an empty comment (@MinLength)', async () => {
    const dto = plainToInstance(CreateCommentDto, { comment: '' });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('rejects a > 5000 char comment (@MaxLength)', async () => {
    const dto = plainToInstance(CreateCommentDto, { comment: 'a'.repeat(5001) });
    expect(errFor(await validate(dto), 'comment')?.constraints).toHaveProperty(
      'maxLength'
    );
  });
});

describe('SeparatePostsDto (task 4.1f)', () => {
  it('accepts bounded content + len', async () => {
    const dto = plainToInstance(SeparatePostsDto, { content: 'hi', len: 280 });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects len 0 (@Min)', async () => {
    const dto = plainToInstance(SeparatePostsDto, { content: 'hi', len: 0 });
    expect(errFor(await validate(dto), 'len')?.constraints).toHaveProperty('min');
  });

  it('rejects over-long content (@MaxLength)', async () => {
    const dto = plainToInstance(SeparatePostsDto, {
      content: 'a'.repeat(100001),
      len: 280,
    });
    expect(errFor(await validate(dto), 'content')?.constraints).toHaveProperty(
      'maxLength'
    );
  });
});

describe('GetPostsDto window bound (task 4.3b)', () => {
  const base = {
    startDate: '2026-01-01T00:00:00.000Z',
    customer: '',
    display: 'week',
  };

  it('accepts a 30-day window', async () => {
    const dto = plainToInstance(GetPostsDto, {
      ...base,
      endDate: '2026-01-31T00:00:00.000Z',
    });
    expect(errFor(await validate(dto), 'endDate')).toBeUndefined();
  });

  it('rejects an endDate 200 days after startDate', async () => {
    const dto = plainToInstance(GetPostsDto, {
      ...base,
      endDate: '2026-07-20T00:00:00.000Z',
    });
    expect(errFor(await validate(dto), 'endDate')?.constraints).toHaveProperty(
      'isWithinWindowOf'
    );
  });
});

describe('ShouldShortlinkDto (task 4.1f)', () => {
  it('accepts a small message list', async () => {
    const dto = plainToInstance(ShouldShortlinkDto, { messages: ['hello'] });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects > 50 messages (@ArrayMaxSize)', async () => {
    const dto = plainToInstance(ShouldShortlinkDto, {
      messages: Array.from({ length: 51 }, () => 'x'),
    });
    expect(errFor(await validate(dto), 'messages')?.constraints).toHaveProperty(
      'arrayMaxSize'
    );
  });
});
